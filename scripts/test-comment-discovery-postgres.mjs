// Explicit opt-in PostgreSQL integration tests. No application dependency is added.
// Connects ONLY to localhost, creates a NEW throwaway database, and removes it.
// The original schema is used only as a baseline fixture in that new database;
// it is never reapplied to an existing AziCe? database.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

if(!process.env.AZICE_TEST_PG_MODULE)throw Error('Set AZICE_TEST_PG_MODULE to a temporary pg driver file. See supabase/COMMENT_DISCOVERY.md.');
const {default:pg}=await import(pathToFileURL(process.env.AZICE_TEST_PG_MODULE).href);
const settings={host:'127.0.0.1',port:Number(process.env.AZICE_TEST_PG_PORT||55439),user:'azice_test_owner',connectionTimeoutMillis:5000};
const database=`azice_comment_test_${process.pid}_${Date.now()}`;
const admin=new pg.Client({...settings,database:'postgres'});await admin.connect();
const sessions=[];let created=false,passed=0;
const read=async path=>(await fs.readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^\uFEFF/,'');
const migration=await read('supabase/migrations/20261023012201_comment_author_discovery.sql');
const regression=await read('supabase/tests/comment_discovery.sql');
const schema=await read('supabase/schema.sql');
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const D='ff000000-0000-4000-8000-000000000004',POST='dd000000-0000-4000-8000-000000000001',COMMENT='ee000000-0000-4000-8000-000000000001',OWN='ee000000-0000-4000-8000-000000000005';
const check=async(name,fn)=>{await fn();passed++;console.log(`PASS PostgreSQL: ${name}`);};
const connect=async()=>{const c=new pg.Client({...settings,database});await c.connect();sessions.push(c);await c.query("SET statement_timeout='10s'");return c;};
const asUser=async(c,user)=>{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);};
const send=(c,comment=COMMENT)=>c.query('SELECT public.send_comment_friend_request($1) AS id',[comment]);
const blocked=async(owner,client)=>{
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const {rows}=await owner.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[client.processID]);
  if(rows[0]?.wait_event_type==='Lock')return;
  await new Promise(r=>setTimeout(r,25));
 }
 throw Error('Expected a database lock wait, not timing-dependent success');
};
try{
 await admin.query(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='azice_migration_other') THEN CREATE ROLE azice_migration_other NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='azice_default_grantee') THEN CREATE ROLE azice_default_grantee NOLOGIN; END IF;
 END $$;`);
 await admin.query(`CREATE DATABASE ${database}`);created=true;
 const owner=await connect();
 await owner.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,azice_migration_other,azice_default_grantee;`);
 await owner.query(schema.slice(0,schema.indexOf('-- Storage:')));
 await owner.query(`CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT ON storage.objects TO authenticated;
  GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
 await owner.query(schema.slice(schema.indexOf('create policy avatar_select'),schema.indexOf('create policy avatar_remove')));
 await owner.query(schema.slice(schema.indexOf('-- Access controls on functions')));
 await check('pre-existing private schema aborts without changing its ACL',async()=>{
  await owner.query('CREATE SCHEMA azice_private;GRANT USAGE ON SCHEMA azice_private TO authenticated');
  await assert.rejects(owner.query(migration),/azice_private already exists/);await owner.query('ROLLBACK');
  assert.equal((await owner.query("SELECT has_schema_privilege('authenticated','azice_private','USAGE') AS allowed")).rows[0].allowed,true);
  await owner.query('DROP SCHEMA azice_private');
 });
 await check('wrong migration owner fails atomically',async()=>{
  await owner.query('SET ROLE azice_migration_other');
  await assert.rejects(owner.query(migration),/Run as the existing owner/);await owner.query('ROLLBACK');await owner.query('RESET ROLE');
  assert.equal((await owner.query("SELECT to_regnamespace('azice_private') AS schema")).rows[0].schema,null);
 });
 // Deliberately hostile default grants must not survive on new migration objects.
 await owner.query(`ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO azice_default_grantee;
  ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO azice_default_grantee;
  CREATE SCHEMA unrelated_acl;
  CREATE FUNCTION public.azice_unrelated_acl_sentinel() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;`);
 await check('migration executes on PostgreSQL 15',async()=>{await owner.query(migration);});
 await check('new ACLs/owners are exact and unrelated default grants survive',async()=>{
  const {rows:[r]}=await owner.query(`SELECT
   has_function_privilege('authenticated','public.pending_friend_request_profiles()','EXECUTE') AS pending_allowed,
   has_function_privilege('anon','public.comment_author_card(uuid)','EXECUTE') AS anon_allowed,
   has_function_privilege('azice_default_grantee','public.comment_author_card(uuid)','EXECUTE') AS default_allowed,
   has_function_privilege('azice_default_grantee','azice_private.create_friend_request(uuid,uuid)','EXECUTE') AS helper_allowed,
   has_schema_privilege('azice_default_grantee','azice_private','USAGE') AS schema_allowed,
   has_function_privilege('azice_default_grantee','public.azice_unrelated_acl_sentinel()','EXECUTE') AS unrelated_function,
   has_schema_privilege('azice_default_grantee','unrelated_acl','USAGE') AS unrelated_schema,
   (SELECT count(DISTINCT proowner) FROM pg_proc WHERE oid=ANY(ARRAY[
    'public.send_friend_request(text)'::regprocedure,'public.comment_author_card(uuid)'::regprocedure,
    'public.pending_friend_request_profiles()'::regprocedure,'azice_private.create_friend_request(uuid,uuid)'::regprocedure])) AS owners`);
  assert.deepEqual(r,{pending_allowed:true,anon_allowed:false,default_allowed:false,helper_allowed:false,schema_allowed:false,unrelated_function:true,unrelated_schema:true,owners:'1'});
 });
 await check('SQL privacy, avatar RLS, arbitrary IDs, invitations, quotas and deletion regression script',async()=>{await owner.query(regression);});
 // Reload only synthetic fixtures, committed for independent concurrent sessions.
 await owner.query(regression.slice(0,regression.indexOf('-- New RPCs'))+'\nCOMMIT;');
 const left=await connect(),right=await connect();
 const reset=async()=>{
  await left.query('ROLLBACK');await right.query('ROLLBACK');
  await owner.query(`TRUNCATE public.friend_requests;
   INSERT INTO public.friendships(user_a,user_b) VALUES ('${A}','${B}') ON CONFLICT DO NOTHING;
   UPDATE public.posts SET status='published',published_at=now() WHERE id='${POST}';
   INSERT INTO public.comments(id,post_id,author_id,body) VALUES ('${COMMENT}','${POST}','${C}','C comments on B') ON CONFLICT DO NOTHING;`);
 };
 for(const [kind,revoke] of [
  ['friendship',`DELETE FROM public.friendships WHERE user_a='${A}' AND user_b='${B}'`],
  ['post visibility',`UPDATE public.posts SET status='draft' WHERE id='${POST}'`],
  ['comment deletion',`DELETE FROM public.comments WHERE id='${COMMENT}'`]
 ]){
  await check(`send-first holds ${kind} revocation until request commit`,async()=>{
   await reset();await asUser(left,A);await send(left);
   await right.query('BEGIN');const revoking=right.query(revoke);await blocked(owner,right);
   await left.query('COMMIT');await revoking;await right.query('COMMIT');
   assert.equal((await owner.query('SELECT count(*) FROM public.friend_requests')).rows[0].count,'1');
   await asUser(left,A);await assert.rejects(send(left),/User unavailable/);await left.query('ROLLBACK');
  });
  await check(`revoke-first ${kind} denies an already-started request after lock wait`,async()=>{
   await reset();await right.query('BEGIN');await right.query(revoke);
   await asUser(left,A);const rejected=assert.rejects(send(left),/User unavailable/);await blocked(owner,left);
   await right.query('COMMIT');await rejected;await left.query('ROLLBACK');
   assert.equal((await owner.query('SELECT count(*) FROM public.friend_requests')).rows[0].count,'0');
  });
 }
 await check('concurrent same-direction requests return exactly one pending ID',async()=>{
  await reset();await asUser(left,A);const first=(await send(left)).rows[0].id;
  await asUser(right,A);const second=send(right);await blocked(owner,right);
  await left.query('COMMIT');assert.equal((await second).rows[0].id,first);await right.query('COMMIT');
  assert.equal((await owner.query('SELECT count(*) FROM public.friend_requests')).rows[0].count,'1');
 });
 await check('concurrent opposite-direction request is rejected after pair lock wait',async()=>{
  await reset();await asUser(left,A);await send(left);
  await asUser(right,C);const rejected=assert.rejects(send(right,OWN),/A request is already pending/);await blocked(owner,right);
  await left.query('COMMIT');await rejected;await right.query('ROLLBACK');
  assert.equal((await owner.query('SELECT count(*) FROM public.friend_requests')).rows[0].count,'1');
 });
 await check('concurrent invitation/comment creation shares the 30-per-hour quota',async()=>{
  await reset();await owner.query(`INSERT INTO auth.users(id,email) VALUES ('${D}','azice-d@example.invalid');
   INSERT INTO public.profiles(id,display_name,username,is_18_plus_confirmed) VALUES ('${D}','Test D','azice_discovery_d',true);
   INSERT INTO public.invites(user_id,token) VALUES ('${D}','azice-test-d');
   INSERT INTO public.friend_requests(sender_id,receiver_id,status) SELECT '${A}','${C}','declined' FROM generate_series(1,29);`);
  await asUser(left,A);await send(left);await asUser(right,A);
  const rejected=assert.rejects(right.query("SELECT public.send_friend_request('azice-test-d')"),/Too many friend requests/);await blocked(owner,right);
  await left.query('COMMIT');await rejected;await right.query('ROLLBACK');
  assert.equal((await owner.query('SELECT count(*) FROM public.friend_requests')).rows[0].count,'30');
 });
 console.log(`PostgreSQL integration checks passed: ${passed}`);
}finally{
 for(const c of sessions){await c.query('ROLLBACK').catch(()=>{});await c.end().catch(()=>{});}
 if(created)await admin.query(`DROP DATABASE ${database}`);
 await admin.end();
}
