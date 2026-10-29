// Disposable PostgreSQL engine, using the existing ignored PGlite tooling only.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[],role='authenticated')=>{
 await db.exec('begin;set local role '+role);
 try{await q("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const rows=await q(sql,args);await db.exec('commit');return rows;}
 catch(error){await db.exec('rollback');throw error;}
};
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
const migration=await read('supabase/migrations/20261024171206_restrict_friendship_helper.sql');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 const base=await read('supabase/schema.sql');await db.exec(base.slice(0,base.indexOf('-- Storage:')));await db.exec(base.slice(base.indexOf('-- Access controls on functions')));
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select on storage.objects to authenticated');
 await db.exec(base.slice(base.indexOf('create policy avatar_select'),base.indexOf('create policy avatar_remove')));
 await db.exec("create policy post_image_select on storage.objects for select to authenticated using(bucket_id='post-images' and exists(select 1 from public.post_photos pp where pp.path=storage.objects.name and public.can_view_post(pp.post_id)))");
 for(const file of [
  '20261023012201_comment_author_discovery.sql','20261023175105_web_push_notifications.sql',
  '20261023193752_in_app_activity.sql','20261023202526_remove_push_quiet_hours.sql',
  '20261023210942_add_friend_by_username.sql','20261024112734_daily_posting_cap.sql'
 ])await db.exec(await read('supabase/migrations/'+file));
 for(const [i,user] of [A,B,C].entries()){
  await q('insert into auth.users values($1)',[user]);
  await q('insert into public.profiles(id,username,display_name,bio,avatar_path,is_18_plus_confirmed) values($1,$2,$3,$4,$5,true)',[user,'f02_'+i,'User '+i,'Private bio '+i,user+'/avatar.jpg']);
 }
 await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
 await check('reproduces pre-fix anonymous and unrelated authenticated arbitrary-pair disclosure',async()=>{
  for(const [user,role] of [[null,'anon'],[C,'authenticated']]){
   assert.equal((await as(user,'select public.are_friends($1,$2) ok',[A,B],role))[0].ok,true);
   assert.equal((await as(user,'select public.are_friends($1,$2) ok',[A,C],role))[0].ok,false);
  }
  assert.equal((await as(C,'select * from public.friendships')).length,0);
 });
 const acl=()=>q("select oid,proacl from pg_proc where oid='public.are_friends(uuid,uuid)'::regprocedure");
 const policy=()=>q("select pg_get_expr(polqual,polrelid) expression from pg_policy where polrelid='public.profiles'::regclass and polname='profiles_confirmed_read_guard'");
 const originalAcl=await acl(),originalPolicy=await policy();
 const failedMigration=async(sql,pattern)=>{
  await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');
  assert.deepEqual(await acl(),originalAcl);assert.deepEqual(await policy(),originalPolicy);
 };
 if(process.env.AZICE_F02_BEFORE_FIX!=='1'){
  await check('wrong migration role fails closed and leaves the existing owner and permissions intact',async()=>{
   await failedMigration(migration.replace('begin;','begin;set local role service_role;'),/Run as the existing owner/);
  });
  await check('unexpected RLS configuration aborts without partial policy or ACL changes',async()=>{
   await db.exec('create policy f02_unexpected on public.friendships for select to authenticated using(false)');
   await failedMigration(migration,/Unexpected friendships RLS/);
   await db.exec('drop policy f02_unexpected on public.friendships');
  });
  await check('inherited custom EXECUTE is detected and rolls back without revoking unrelated roles',async()=>{
   await db.exec('create role f02_custom;grant execute on function public.are_friends(uuid,uuid) to f02_custom;grant f02_custom to authenticated');
   const before=await acl();await assert.rejects(db.exec(migration),/retain inherited EXECUTE/);await db.exec('rollback');
   assert.deepEqual(await acl(),before);assert.deepEqual(await policy(),originalPolicy);
   await db.exec('revoke f02_custom from authenticated;revoke execute on function public.are_friends(uuid,uuid) from f02_custom;drop role f02_custom');
  });
  await check('failure after revocation atomically restores grants and restrictive policy',async()=>{
   await failedMigration(migration.replace(/commit;\s*$/,'select 1/0;\ncommit;'),/division by zero/);
  });
 }
 const otherAcls=await q("select oid,proacl from pg_proc where oid<>'public.are_friends(uuid,uuid)'::regprocedure order by oid");
 const otherPolicies=await q("select oid,polqual::text,polwithcheck::text from pg_policy where polname<>'profiles_confirmed_read_guard' order by oid");
 const definition=await q("select oid,proowner,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid='public.are_friends(uuid,uuid)'::regprocedure");
 if(process.env.AZICE_F02_BEFORE_FIX!=='1')await db.exec(migration);
 await check('anonymous and authenticated direct calls are denied, including own pairs',async()=>{
  for(const [user,role] of [[null,'anon'],[C,'authenticated'],[A,'authenticated']]){
   await assert.rejects(as(user,'select public.are_friends($1,$2)',[A,B],role),error=>error.code==='42501');
   assert.equal((await q("select has_function_privilege($1,'public.are_friends(uuid,uuid)','execute') ok",[role]))[0].ok,false);
  }
 });
 await check('function identity, body, owner, search_path, other ACLs and policies are unchanged; rerun is safe',async()=>{
  assert.deepEqual(await q("select oid,proowner,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid='public.are_friends(uuid,uuid)'::regprocedure"),definition);
  assert.deepEqual(await q("select oid,proacl from pg_proc where oid<>'public.are_friends(uuid,uuid)'::regprocedure order by oid"),otherAcls);
  assert.deepEqual(await q("select oid,polqual::text,polwithcheck::text from pg_policy where polname<>'profiles_confirmed_read_guard' order by oid"),otherPolicies);
  const after=await acl(),guard=await policy();await db.exec(migration);assert.deepEqual(await acl(),after);assert.deepEqual(await policy(),guard);
 });
 const post=(await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Private reason','published',now()) returning id",[A]))[0].id;
 const path=A+'/'+post+'/1.jpg';await q('insert into public.post_photos(post_id,slot,path) values($1,1,$2)',[post,path]);
 await q("insert into storage.objects(bucket_id,name) values('post-images',$1),('avatars',$2)",[path,A+'/avatar.jpg']);
 await check('own and confirmed-friend private profiles, posts, photo metadata and Storage reads still work',async()=>{
  for(const user of [A,B]){
   assert.equal((await as(user,'select bio from public.profiles where id=$1',[A]))[0].bio,'Private bio 0');
   assert.equal((await as(user,'select id from public.posts where id=$1',[post])).length,1);
   assert.equal((await as(user,'select path from public.post_photos where post_id=$1',[post]))[0].path,path);
   assert.equal((await as(user,'select * from storage.objects')).length,2);
  }
  assert.equal((await as(B,'select * from public.friendships')).length,1);
 });
 await check('normal profile updates and authenticated draft publishing retain their existing authorization',async()=>{
  await as(A,"update public.profiles set bio='Updated private bio' where id=$1",[A]);
  assert.equal((await as(B,'select bio from public.profiles where id=$1',[A]))[0].bio,'Updated private bio');
  assert.equal((await as(C,"update public.profiles set bio='Unauthorized' where id=$1 returning id",[A])).length,0);
  await as(A,"select public.get_daily_posting_status('UTC')");
  // Match src/cloud.js: client supplies the UUID and inserts without RETURNING.
  const draft=crypto.randomUUID();await as(A,"insert into public.posts(id,author_id,kind,reason) values($1,$2,'sober','Another valid post')",[draft,A]);
  await as(A,'select public.publish_post($1)',[draft]);
  assert.equal((await as(B,'select id from public.posts where id=$1',[draft])).length,1);
 });
 let request;
 await check('invitation requests remain functional; pending requests do not grant private profile or post access',async()=>{
  const token=(await as(A,'select public.rotate_invite() token'))[0].token;
  request=(await as(C,'select public.send_friend_request($1) id',[token]))[0].id;
  assert.equal((await as(C,'select public.send_friend_request($1) id',[token]))[0].id,request);
  for(const sql of ['select * from public.profiles where id=$1','select * from public.posts where author_id=$1'])assert.equal((await as(C,sql,[A])).length,0);
  assert.equal((await as(C,'select * from public.post_photos')).length,0);assert.equal((await as(C,'select * from storage.objects')).length,0);
  const minimal=(await as(C,'select * from public.pending_friend_request_profiles()'))[0];
  assert.equal(minimal.id,A);assert.equal(minimal.avatar_path,null);assert.equal('bio' in minimal,false);
  await assert.rejects(as(C,"insert into public.comments(post_id,author_id,body) values($1,$2,'No access')",[post,C]),/row-level security/);
  await assert.rejects(as(C,"insert into public.reactions(post_id,user_id,emoji) values($1,$2,'🔥')",[post,C]),/row-level security/);
 });
 await as(A,"select public.save_notification_preferences('{\"enabled\":true}')");
 await as(null,'select public.push_register($1,$2,$3)',[A,{endpoint:'https://fcm.googleapis.com/fcm/send/f02',keys:{p256dh:'test',auth:'test'}},'a'.repeat(64)],'service_role');
 let comment,batch;
 await check('comments, reactions and Activity capture retain trusted helper access',async()=>{
  comment=(await as(B,"insert into public.comments(post_id,author_id,body) values($1,$2,'Private comment') returning id",[post,B]))[0].id;
  await as(B,"insert into public.reactions(post_id,user_id,emoji) values($1,$2,'🔥')",[post,B]);
  const activity=(await as(A,'select public.get_activity() data'))[0].data;assert.equal(activity.items.length,2);
  assert.doesNotMatch(JSON.stringify(activity),/Private comment|Private reason/);
  await as(B,"update public.reactions set emoji='❤️' where post_id=$1",[post]);
  assert.equal((await as(A,'select public.get_activity() data'))[0].data.items.length,2);
 });
 await check('minimal comment discovery works without granting unrelated private information',async()=>{
  await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,C]);
  const card=(await as(C,'select * from public.comment_author_card($1)',[comment]))[0];
  assert.equal(card.id,B);assert.equal(card.relationship,'none');assert.equal(card.avatar_path,null);assert.equal('bio' in card,false);
  const id=(await as(C,'select public.send_comment_friend_request($1) id',[comment]))[0].id;
  assert.equal((await as(C,'select public.send_comment_friend_request($1) id',[comment]))[0].id,id);
  await as(C,"select public.handle_friend_request($1,'cancel')",[id]);
  await as(C,'select public.remove_friend($1)',[A]);
  await assert.rejects(as(C,'select public.comment_author_card($1)',[comment]),/User unavailable/);
  await assert.rejects(as(C,'select public.send_comment_friend_request($1)',[comment]),/User unavailable/);
 });
 await check('username requests, accept, decline and removal continue to enforce confirmed friendship access',async()=>{
  // remove_friend in the preceding case already cleaned the old pending invite.
  assert.equal((await as(C,"select public.send_username_friend_request('f02_0') status"))[0].status,'sent');
  let id=(await q("select id from public.friend_requests where sender_id=$1 and receiver_id=$2 and status='pending'",[C,A]))[0].id;
  await as(A,"select public.handle_friend_request($1,'decline')",[id]);
  assert.equal((await as(C,'select * from public.profiles where id=$1',[A])).length,0);
  await as(C,"select public.send_username_friend_request('f02_0')");
  id=(await q("select id from public.friend_requests where sender_id=$1 and receiver_id=$2 and status='pending'",[C,A]))[0].id;
  await as(A,"select public.handle_friend_request($1,'accept')",[id]);assert.equal((await as(C,'select * from public.profiles where id=$1',[A])).length,1);
  await as(A,'select public.remove_friend($1)',[C]);assert.equal((await as(C,'select * from public.profiles where id=$1',[A])).length,0);
 });
 await check('service-role dispatcher can claim/validate jobs without a user JWT; browser cannot',async()=>{
  assert.equal((await as(null,'select public.are_friends($1,$2) ok',[A,B],'service_role'))[0].ok,true);
  await db.exec('update azice_push.jobs set due_at=now() where batch_id is null');
  batch=(await as(null,'select public.push_claim() batch',[],'service_role'))[0].batch;assert.ok(batch);assert.equal(batch.category,'comments');
  assert.equal((await as(null,'select public.push_validate($1,$2,$3) ok',[batch.id,batch.token,batch.devices[0].id],'service_role'))[0].ok,true);
  assert.equal((await as(A,'select public.resolve_notification($1) target',[batch.id]))[0].target.screen,'post');
  await assert.rejects(as(B,'select public.push_claim()'),/permission denied/);
  await db.exec('select azice_push.reminders();select azice_activity.purge()');
 });
 await check('existing owner-run scheduler dispatches due work using local HTTP/Vault stubs, without exposing internal helpers',async()=>{
  await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
   insert into vault.decrypted_secrets values('azice_push_dispatch_url','https://example.invalid/push-dispatch'),('azice_push_dispatch_secret','synthetic-test-only');
   create schema net;create table net.calls(url text);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.calls values($1) returning 1::bigint$$;`);
  const schedule=await read('supabase/notifications_schedule.sql');
  await db.exec(schedule.slice(schedule.indexOf('create function azice_push.tick()'),schedule.indexOf('select cron.schedule')));
  await db.exec('select azice_push.tick()');assert.equal((await q('select * from net.calls')).length,1);
  await assert.rejects(as(B,'select azice_push.tick()'),/permission denied/);
  await assert.rejects(as(null,'select azice_push.tick()',[],'service_role'),/permission denied/);
 });
 await check('48-hour interaction expiry, removal and push revalidation remain effective',async()=>{
  await q("update public.posts set published_at=now()-interval '3 days' where id=$1",[post]);
  assert.equal((await as(B,'select public.can_view_post($1) ok',[post]))[0].ok,true);
  assert.equal((await as(B,'select public.can_interact_post($1) ok',[post]))[0].ok,false);
  await as(B,'select public.remove_friend($1)',[A]);
  assert.equal((await as(B,'select * from public.profiles where id=$1',[A])).length,0);assert.equal((await as(B,'select * from storage.objects')).length,0);
  assert.equal((await as(B,'select public.can_view_post($1) ok',[post]))[0].ok,false);
  assert.equal((await as(null,'select public.push_validate($1,$2,$3) ok',[batch.id,batch.token,batch.devices[0].id],'service_role'))[0].ok,false);
 });
 await check('account and post deletion cascade existing activity without new dependencies',async()=>{
  await q('delete from auth.users where id=$1',[B]);assert.equal((await q('select * from public.activity_notifications')).length,0);
  await q('delete from public.posts where id=$1',[post]);await q('delete from auth.users where id=$1',[A]);
  assert.equal((await q('select * from public.post_photos')).length,0);assert.equal((await q('select * from public.friendships')).length,0);
 });
 console.log(`PostgreSQL engine: ${passed} F02 regression groups passed (PGlite; no remote SQL).`);
}finally{await db.close();}
