// R03 investigation, not a production migration. Synthetic users/Storage metadata
// only; actual PostgreSQL sessions, RLS, constraints and locks. No HTTP/blob service.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.env.AZICE_TEST_PG_MODULE)throw Error('Set AZICE_TEST_PG_MODULE; see supabase/NATIVE_POSTGRES_TESTS.md');
const {default:pg}=await import(pathToFileURL(process.env.AZICE_TEST_PG_MODULE).href);
const port=Number(process.env.AZICE_TEST_PG_PORT||55439);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid test port');
const settings={host:'127.0.0.1',port,user:'azice_test_owner',connectionTimeoutMillis:5000};
const admin=new pg.Client({...settings,database:'postgres'}),sessions=[];
const database=`azice_deletion_test_${process.pid}_${Date.now()}`;
const read=async path=>(await fs.readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^\uFEFF/,'');
let created=false,passed=0,sequence=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS native R03: '+name);};
const connect=async()=>{const client=new pg.Client({...settings,database});await client.connect();sessions.push(client);await client.query("SET statement_timeout='15s'");return client;};
const begin=async(client,id,role='authenticated')=>{
 await client.query('BEGIN');await client.query('SET LOCAL ROLE '+role);
 await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id||'']);
};
try{
 await admin.connect();const {rows:[env]}=await admin.query("SELECT current_setting('cluster_name') cluster,current_setting('listen_addresses') listens,current_setting('server_version') version");
 if(env.cluster!=='azice_stabilization_disposable'||env.listens!=='127.0.0.1')throw Error('Refusing unmarked or non-loopback cluster');
 console.log('Native PostgreSQL '+env.version+'; fresh disposable database only');
 await admin.query(`DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS;END IF;END $$;`);
 await admin.query(`CREATE DATABASE ${database}`);created=true;
 const owner=await connect(),writer=await connect(),deleter=await connect();
 const q=async(sql,args=[])=>(await owner.query(sql,args)).rows;
 const as=async(id,sql,args=[],role='authenticated')=>{
  await begin(owner,id,role);try{const rows=await q(sql,args);await owner.query('COMMIT');return rows;}catch(error){await owner.query('ROLLBACK');throw error;}
 };
 const blocked=async(waiting,blocking)=>{
  const deadline=Date.now()+5000;while(Date.now()<deadline){
   const {rows:[row]}=await owner.query('SELECT pg_blocking_pids($1) blockers',[waiting.processID]);
   if(row.blockers.includes(blocking.processID))return;await new Promise(resolve=>setTimeout(resolve,20));
  }throw Error('Expected a real PostgreSQL lock wait');
 };
 await q(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);`);
 const base=await read('supabase/schema.sql');
 await q(base.slice(0,base.indexOf('-- Storage:')));await q(base.slice(base.indexOf('-- Access controls on functions')));
 await q('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated');
 await q(base.slice(base.indexOf('create policy post_image_insert'),base.indexOf('-- Note: No UPDATE policies')));
 for(const file of ['20261023012201_comment_author_discovery.sql','20261023175105_web_push_notifications.sql','20261023193752_in_app_activity.sql','20261023202526_remove_push_quiet_hours.sql','20261023210942_add_friend_by_username.sql','20261024112734_daily_posting_cap.sql','20261024171206_restrict_friendship_helper.sql','20261024174419_bound_activity_unread.sql'])await q(await read('supabase/migrations/'+file));
 const user=async()=>{
  const id=crypto.randomUUID();await q('INSERT INTO auth.users VALUES($1)',[id]);
  await q("INSERT INTO public.profiles(id,username,display_name,is_18_plus_confirmed) VALUES($1,$2,'Synthetic user',true)",[id,'r03_'+(++sequence)]);return id;
 };
 const draft=async id=>{const post=crypto.randomUUID();await as(id,"INSERT INTO public.posts(id,author_id,kind,reason) VALUES($1,$2,'drank','Synthetic draft')",[post,id]);return post;};
 const remove=id=>deleter.query('DELETE FROM auth.users WHERE id=$1',[id]);
 const insertObject=(client,id,bucket,path)=>client.query('INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES($1,$2,$3)',[bucket,`${id}/${path}`,id]);

 await check('ordinary writes hold FK locks: deletion waits for a draft insert, then cascades the committed row',async()=>{
  const id=await user();await begin(writer,id);
  const post=crypto.randomUUID();await writer.query("INSERT INTO public.posts(id,author_id,kind,reason) VALUES($1,$2,'sober','Concurrent')",[post,id]);
  const waiting=remove(id);await blocked(deleter,writer);await writer.query('COMMIT');await waiting;
  assert.equal((await q('SELECT * FROM public.posts WHERE id=$1',[post])).length,0);
 });
 await check('deletion first: a competing post insert waits, then fails its FK and cannot recreate personal rows',async()=>{
  const id=await user();await deleter.query('BEGIN');await remove(id);await begin(writer,id);
  const rejected=assert.rejects(writer.query("INSERT INTO public.posts(author_id,kind,reason) VALUES($1,'sober','Late')",[id]),e=>e.code==='23503');
  await blocked(writer,deleter);await deleter.query('COMMIT');await rejected;await writer.query('ROLLBACK');
  await assert.rejects(as(id,"INSERT INTO public.profiles(id,username,display_name,is_18_plus_confirmed) VALUES($1,'gone_user','Gone',true)",[id]),e=>e.code==='23503');
 });
 await check('public relational data including Activity, preferences and quotas cascades; a failed deletion transaction rolls back',async()=>{
  const id=await user(),friend=await user();
  await q('INSERT INTO public.friendships(user_a,user_b) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid))',[id,friend]);
  await as(id,"SELECT public.get_daily_posting_status('UTC')");
  const post=(await q("INSERT INTO public.posts(author_id,kind,reason,status,published_at) VALUES($1,'sober','Synthetic','published',now()) RETURNING id",[id]))[0].id;
  await as(friend,"INSERT INTO public.comments(post_id,author_id,body) VALUES($1,$2,'Synthetic comment')",[post,friend]);
  await as(friend,"INSERT INTO public.reactions(post_id,user_id,emoji) VALUES($1,$2,'🔥')",[post,friend]);
  assert.equal((await q('SELECT * FROM public.activity_notifications WHERE recipient_id=$1',[id])).length,2);
  await deleter.query('BEGIN');await remove(id);await deleter.query('ROLLBACK');assert.equal((await q('SELECT * FROM public.profiles WHERE id=$1',[id])).length,1);
  await remove(id);
  for(const [table,column] of [['profiles','id'],['posts','author_id'],['notification_preferences','user_id'],['activity_notifications','recipient_id']])assert.equal((await q(`SELECT * FROM public.${table} WHERE ${column}=$1`,[id])).length,0);
  assert.equal((await q('SELECT * FROM public.comments WHERE post_id=$1',[post])).length,0);
  assert.equal((await q('SELECT * FROM public.reactions WHERE post_id=$1',[post])).length,0);
  assert.equal((await q('SELECT * FROM azice_private.daily_post_usage WHERE user_id=$1',[id])).length,0);
 });
 await check('R03: post-image INSERT authorized before deletion can commit after cascades and leave metadata',async()=>{
  const id=await user(),post=await draft(id),path=`${post}/late.jpg`;await begin(writer,id);
  await insertObject(writer,id,'post-images',path);await remove(id);await writer.query('COMMIT');
  assert.equal((await q('SELECT * FROM storage.objects WHERE owner_id=$1',[id])).length,1);
  assert.equal((await as(id,'DELETE FROM storage.objects WHERE owner_id=$1 RETURNING id',[id])).length,0);
  await begin(writer,id);await assert.rejects(insertObject(writer,id,'post-images',`${post}/after.jpg`),e=>e.code==='42501');await writer.query('ROLLBACK');
 });
 await check('a comment on a surviving friend post cannot outlive deletion of its concurrent author',async()=>{
  const id=await user(),friend=await user();
  await q('INSERT INTO public.friendships(user_a,user_b) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid))',[id,friend]);
  const post=(await q("INSERT INTO public.posts(author_id,kind,reason,status,published_at) VALUES($1,'sober','Synthetic','published',now()) RETURNING id",[friend]))[0].id;
  await begin(writer,id);await writer.query("INSERT INTO public.comments(post_id,author_id,body) VALUES($1,$2,'Concurrent author')",[post,id]);
  const waiting=remove(id);await blocked(deleter,writer);await writer.query('COMMIT');await waiting;
  assert.equal((await q('SELECT * FROM public.comments WHERE author_id=$1',[id])).length,0);
  assert.equal((await q('SELECT * FROM public.activity_notifications WHERE actor_id=$1',[id])).length,0);
  assert.equal((await q('SELECT * FROM public.posts WHERE id=$1',[post])).length,1);
 });
 await check('R03: avatar prefix policy accepts a stale JWT subject after Auth deletion; other users remain denied',async()=>{
  const id=await user(),other=await user();await remove(id);await begin(writer,id);
  await insertObject(writer,id,'avatars','after.jpg');await writer.query('COMMIT');
  assert.equal((await as(id,'SELECT * FROM storage.objects WHERE owner_id=$1',[id])).length,1);
  await begin(writer,other);await assert.rejects(insertObject(writer,id,'avatars','foreign.jpg'),e=>e.code==='42501');await writer.query('ROLLBACK');
  // Authorization here is actual RLS with a synthetic stale sub, not real JWT verification.
 });
 await check('a modeled owner-existence Auth guard rejects committed objects, preserves public rows, and permits a cleaned retry',async()=>{
  // Supabase documents an ownership rejection. This explicit test-only model is
  // NOT asserted to be the hosted implementation or its exact locking behavior.
  await q(`CREATE FUNCTION auth.r03_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF EXISTS(SELECT 1 FROM storage.objects WHERE owner_id=old.id::text) THEN RAISE EXCEPTION 'Synthetic owner guard';END IF;RETURN old;END$$;
   CREATE TRIGGER r03_owner_guard BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION auth.r03_owner_guard()`);
  const id=await user();await begin(writer,id);await insertObject(writer,id,'avatars','owned.jpg');await writer.query('COMMIT');
  await assert.rejects(remove(id),/Synthetic owner guard/);assert.equal((await q('SELECT * FROM public.profiles WHERE id=$1',[id])).length,1);
  // Test catalog only. Never substitute SQL DELETE for a physical Storage API removal.
  await q('DELETE FROM storage.objects WHERE owner_id=$1',[id]);await remove(id);
 });
 await check('R03: a simple owner-existence guard cannot see an uncommitted upload or prevent a later commit',async()=>{
  const id=await user(),post=await draft(id);await begin(writer,id);await insertObject(writer,id,'post-images',`${post}/inflight.jpg`);
  await remove(id);await writer.query('COMMIT');assert.equal((await q('SELECT * FROM storage.objects WHERE owner_id=$1',[id])).length,1);
 });
 await check('R03: rolling back an upload leaves no metadata; post-delete ordinary writes remain rejected',async()=>{
  const id=await user();await begin(writer,id);await insertObject(writer,id,'avatars','rolled-back.jpg');await writer.query('ROLLBACK');await remove(id);
  assert.equal((await q('SELECT * FROM storage.objects WHERE owner_id=$1',[id])).length,0);
  await assert.rejects(as(id,"SELECT public.get_daily_posting_status('UTC')"),/Profile required/);
  await assert.rejects(as(id,"INSERT INTO public.comments(post_id,author_id,body) VALUES($1,$2,'Late')",[crypto.randomUUID(),id]),e=>e.code==='42501');
 });
 console.log(`Native R03 investigation: ${passed} groups passed. Known-exposure characterization, not a repaired deletion guarantee. No physical Storage/Auth integration.`);
}finally{
 for(const client of sessions){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
 if(created)await admin.query(`DROP DATABASE ${database}`);await admin.end().catch(()=>{});
}
