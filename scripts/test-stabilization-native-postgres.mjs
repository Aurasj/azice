// Opt-in native PostgreSQL only. Requires an approved, isolated loopback cluster.
// Creates/drops a NEW database, never resets an existing application database.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

if(!process.env.AZICE_TEST_PG_MODULE)throw Error('Set AZICE_TEST_PG_MODULE; see docs/testing/postgres.md.');
const {default:pg}=await import(pathToFileURL(process.env.AZICE_TEST_PG_MODULE).href);
const port=Number(process.env.AZICE_TEST_PG_PORT||55439);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local test port');
const settings={host:'127.0.0.1',port,user:'azice_test_owner',connectionTimeoutMillis:5000};
const admin=new pg.Client({...settings,database:'postgres'}),sessions=[];
const database=`azice_stabilization_test_${process.pid}_${Date.now()}`;
const read=async path=>(await fs.readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^\uFEFF/,'');
let created=false,passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS native PostgreSQL: '+name);};
const connect=async()=>{const client=new pg.Client({...settings,database});await client.connect();sessions.push(client);await client.query("SET statement_timeout='15s'");return client;};
const begin=async(client,user,isolation='READ COMMITTED',role='authenticated')=>{
 await client.query('BEGIN ISOLATION LEVEL '+isolation);await client.query('SET LOCAL ROLE '+role);
 await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user||'']);
};
const blockedBy=async(owner,waiting,blocker)=>{
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const {rows:[row]}=await owner.query('SELECT wait_event_type,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[waiting.processID]);
  if(row?.wait_event_type==='Lock'&&row.blockers.includes(blocker.processID))return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('Expected real overlapping sessions blocked by the competing transaction');
};
try{
 await admin.connect();
 const {rows:[environment]}=await admin.query("SELECT current_setting('cluster_name') cluster,current_setting('listen_addresses') listens,current_setting('server_version') version");
 if(environment.cluster!=='azice_stabilization_disposable'||environment.listens!=='127.0.0.1')throw Error('Refusing a cluster without the disposable marker and loopback-only listener');
 console.log('Native PostgreSQL '+environment.version+'; approved disposable loopback cluster only.');
 await admin.query(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$;`);
 await admin.query(`CREATE DATABASE ${database}`);created=true;
 const owner=await connect(),left=await connect(),right=await connect();
 const q=async(sql,args=[])=>(await owner.query(sql,args)).rows;
 const as=async(user,sql,args=[],role='authenticated')=>{
  await begin(owner,user,'READ COMMITTED',role);
  try{const rows=await q(sql,args);await owner.query('COMMIT');return rows;}catch(error){await owner.query('ROLLBACK');throw error;}
 };
 await owner.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
  CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);`);
 const schema=await read('supabase/schema.sql');
 await owner.query(schema.slice(0,schema.indexOf('-- Storage:')));
 await owner.query(schema.slice(schema.indexOf('-- Access controls on functions')));
 await owner.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated');
 await owner.query(schema.slice(schema.indexOf('create policy post_image_insert'),schema.indexOf('-- Note: No UPDATE policies')));
 for(const file of ['20261023012201_comment_author_discovery.sql','20261023175105_web_push_notifications.sql','20261023193752_in_app_activity.sql','20261023202526_remove_push_quiet_hours.sql','20261023210942_add_friend_by_username.sql','20261024112734_daily_posting_cap.sql'])await owner.query(await read('supabase/migrations/'+file));
 let sequence=0;
 const user=async()=>{const id='aa000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');await q('INSERT INTO auth.users(id) VALUES($1)',[id]);await q('INSERT INTO public.profiles(id,username,display_name,bio,is_18_plus_confirmed) VALUES($1,$2,$3,$4,true)',[id,'native_'+sequence,'User '+sequence,'Private bio']);await as(id,"SELECT public.get_daily_posting_status('UTC')");return id;};
 const A=await user(),B=await user(),C=await user();
 await q('INSERT INTO public.friendships(user_a,user_b) VALUES($1,$2)',[A,B]);
 const published=async(id,count=1)=>q("INSERT INTO public.posts(author_id,kind,reason,status,published_at) SELECT $1,'sober','Native fixture','published',clock_timestamp() FROM generate_series(1,$2::integer) RETURNING id",[id,count]);
 const post=(await published(A))[0].id;
 const helper='public.are_friends(uuid,uuid)',activity='public.get_activity()';
 const functionInfo=signature=>q('SELECT oid,proowner,proacl,prosecdef,proconfig,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=$1::regprocedure',[signature]);
 const f02=await read('supabase/migrations/20261024171206_restrict_friendship_helper.sql');
 const f06=await read('supabase/migrations/20261024174419_bound_activity_unread.sql');
 await check('F02 reproduces native arbitrary-pair disclosure and rolls back a post-revoke failure',async()=>{
  for(const role of ['anon','authenticated'])assert.equal((await as(C,'SELECT public.are_friends($1,$2) ok',[A,B],role))[0].ok,true);
  const before=await functionInfo(helper),guard=await q("SELECT pg_get_expr(polqual,polrelid) expression FROM pg_policy WHERE polname='profiles_confirmed_read_guard'");
  await assert.rejects(owner.query(f02.replace(/commit;\s*$/,'SELECT 1/0;COMMIT;')),error=>error.code==='22012');await owner.query('ROLLBACK');
  assert.deepEqual(await functionInfo(helper),before);assert.deepEqual(await q("SELECT pg_get_expr(polqual,polrelid) expression FROM pg_policy WHERE polname='profiles_confirmed_read_guard'"),guard);
  await owner.query(f02);
 });
 await check('F02 denies probing but preserves confirmed-friend RLS, pending privacy and trusted service operations',async()=>{
  for(const role of ['anon','authenticated'])await assert.rejects(as(C,'SELECT public.are_friends($1,$2)',[A,B],role),error=>error.code==='42501');
  assert.equal((await as(B,'SELECT bio FROM public.profiles WHERE id=$1',[A]))[0].bio,'Private bio');assert.equal((await as(B,'SELECT id FROM public.posts WHERE id=$1',[post])).length,1);
  assert.equal((await as(C,'SELECT * FROM public.profiles WHERE id=$1',[A])).length,0);
  assert.equal((await as(C,"SELECT public.send_username_friend_request('native_1') result"))[0].result,'sent');assert.equal((await as(C,'SELECT * FROM public.profiles WHERE id=$1',[A])).length,0);
  assert.equal((await as(C,'SELECT * FROM public.posts WHERE id=$1',[post])).length,0);
  assert.equal((await as(null,'SELECT public.are_friends($1,$2) ok',[A,B],'service_role'))[0].ok,true);
  await as(null,'SELECT public.push_claim()',[],'service_role');
 });
 await check('F06 follows F02, fixes the native 51-event boundary and retains invoker/owner/ACL with transactional rollback',async()=>{
  await q("INSERT INTO public.activity_notifications(event_key,recipient_id,actor_id,category,post_id,created_at,read_at) SELECT 'native:'||n,$1,$2,CASE WHEN n%2=0 THEN 'reaction' ELSE 'comment' END,$3,now()-n*interval '1 second',CASE WHEN n=51 THEN null ELSE now() END FROM generate_series(1,51) n",[A,B,post]);
  const before=await functionInfo(activity),initial=(await as(A,'SELECT public.get_activity() data'))[0].data;assert.equal(initial.items.length,50);assert.equal(initial.unread,true);assert.ok(initial.items.every(item=>item.read_at));
  await assert.rejects(owner.query(f06.replace(/commit;\s*$/,'SELECT 1/0;COMMIT;')),error=>error.code==='22012');await owner.query('ROLLBACK');assert.deepEqual(await functionInfo(activity),before);
  await owner.query(f06);const after=await functionInfo(activity);assert.deepEqual({...after[0],definition:null},{...before[0],definition:null});
  const data=(await as(A,'SELECT public.get_activity() data'))[0].data;assert.equal(data.items.length,50);assert.equal(data.unread,false);
  for(const role of ['anon','service_role'])await assert.rejects(as(null,'SELECT public.get_activity()',[],role),error=>error.code==='42501');
  assert.equal((await as(C,'SELECT public.get_activity() data'))[0].data.items.length,0);assert.equal((await as(C,"SELECT public.mark_activity_read('native:51') ok"))[0].ok,false);
 });
 await check('real overlapping Activity sessions keep a stable snapshot; next refresh sees and clears the new event',async()=>{
  await begin(left,A,'REPEATABLE READ');const before=(await left.query('SELECT public.get_activity() data')).rows[0].data;assert.equal(before.unread,false);
  await begin(right,B);const id=(await right.query("INSERT INTO public.comments(post_id,author_id,body) VALUES($1,$2,'Native concurrent comment') RETURNING id",[post,B])).rows[0].id;await right.query('COMMIT');
  assert.deepEqual((await left.query('SELECT public.get_activity() data')).rows[0].data,before);await left.query('COMMIT');
  const next=(await as(A,'SELECT public.get_activity() data'))[0].data;assert.equal(next.unread,true);assert.equal(next.items[0].event_key,'comment:'+id);
  await as(A,'SELECT public.mark_activity_read($1)',['comment:'+id]);assert.equal((await as(A,'SELECT public.get_activity() data'))[0].data.unread,false);
 });
 const draft=async(id,kind='sober')=>{
  const post=crypto.randomUUID();await as(id,'INSERT INTO public.posts(id,author_id,kind,reason) VALUES($1,$2,$3,$4)',[post,id,kind,'Native draft']);
  if(kind==='drank'){
   const path=`${id}/${post}/1.jpg`;await as(id,'INSERT INTO public.post_photos(post_id,slot,path) VALUES($1,1,$2)',[post,path]);
   // Catalog fixture only, never claimed as a physical Storage API upload.
   await as(id,"INSERT INTO storage.objects(bucket_id,name) VALUES('post-images',$1)",[path]);
  }
  return post;
 };
 const publish=(client,id)=>client.query('SELECT public.publish_post($1)',[id]);
 const count=async id=>(await as(id,'SELECT public.get_daily_posting_status(null) data'))[0].data.count;
 await check('two real sessions compete for the last slot: one mixed-type publish wins and one is rejected after a row-lock wait',async()=>{
  await published(A);assert.equal(await count(A),2);const first=await draft(A),second=await draft(A,'drank');
  await begin(left,A);await publish(left,first);await begin(right,A);
  const rejected=assert.rejects(publish(right,second),error=>error.code==='P0001'&&error.message==='DAILY_POST_LIMIT');await blockedBy(owner,right,left);
  await left.query('COMMIT');await rejected;await right.query('ROLLBACK');assert.equal(await count(A),3);
  assert.equal((await q('SELECT status FROM public.posts WHERE id=$1',[second]))[0].status,'draft');
  await assert.rejects(as(A,'SELECT public.publish_post($1)',[first]),/Draft not found/);assert.equal(await count(A),3);
 });
 await check('rolling back the first publication releases the last slot for an actually blocked competing session',async()=>{
  const id=await user();await published(id,2);const first=await draft(id,'drank'),second=await draft(id);
  await begin(left,id);await publish(left,first);await begin(right,id);const waiting=publish(right,second).then(result=>({result}),error=>({error}));await blockedBy(owner,right,left);
  await left.query('ROLLBACK');assert.ifError((await waiting).error);await right.query('COMMIT');assert.equal(await count(id),3);
  assert.equal((await q('SELECT status FROM public.posts WHERE id=$1',[first]))[0].status,'draft');assert.equal((await q('SELECT status FROM public.posts WHERE id=$1',[second]))[0].status,'published');
 });
 await check('repeatable-read competitor aborts rather than bypassing the daily cap after a real lock wait',async()=>{
  const id=await user();await published(id,2);const first=await draft(id),second=await draft(id);
  await begin(left,id,'REPEATABLE READ');await begin(right,id,'REPEATABLE READ');await right.query('SELECT count(*) FROM public.posts');
  await publish(left,first);const rejected=assert.rejects(publish(right,second),error=>error.code==='40001');await blockedBy(owner,right,left);
  await left.query('COMMIT');await rejected;await right.query('ROLLBACK');assert.equal(await count(id),3);
 });
 await check('native source RLS revokes new comments and private actor profiles without stranding own-post Activity',async()=>{
  await as(A,'SELECT public.remove_friend($1)',[B]);assert.equal((await as(A,'SELECT * FROM public.profiles WHERE id=$1',[B])).length,0);
  await assert.rejects(as(B,"INSERT INTO public.comments(post_id,author_id,body) VALUES($1,$2,'Revoked')",[post,B]),error=>error.code==='42501');
  const data=(await as(A,'SELECT public.get_activity() data'))[0].data;for(const item of data.items)await as(A,'SELECT public.mark_activity_read($1)',[item.event_key]);
  assert.equal((await as(A,'SELECT public.get_activity() data'))[0].data.unread,false);
 });
 console.log(`Native PostgreSQL stabilization: ${passed} groups passed; independent sessions, roles, RLS and locks actually executed. No hosted or physical Storage integration.`);
}finally{
 for(const client of sessions){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
 if(created)await admin.query(`DROP DATABASE ${database}`);
 await admin.end().catch(()=>{});
}
