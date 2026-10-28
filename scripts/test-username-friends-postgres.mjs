// Disposable PostgreSQL engine only; reuses ignored tooling documented in WEB_PUSH.md.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[])=>{await db.exec('begin;set local role authenticated');await q("select set_config('request.jwt.claim.sub',$1,true)",[user]);try{const rows=await q(sql,args);await db.exec('commit');return rows;}catch(error){await db.exec('rollback');throw error;}};
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,service_role;create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);`);
 const base=await read('supabase/schema.sql');await db.exec(base.slice(0,base.indexOf('-- Storage:')));await db.exec(base.slice(base.indexOf('-- Access controls on functions')));
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select on storage.objects to authenticated');
 await db.exec(base.slice(base.indexOf('create policy avatar_select'),base.indexOf('create policy avatar_remove')));
 await db.exec("create policy post_image_select on storage.objects for select to authenticated using(bucket_id='post-images' and exists(select 1 from public.post_photos pp where pp.path=storage.objects.name and public.can_view_post(pp.post_id)))");
 await db.exec(await read('supabase/migrations/20261023012201_comment_author_discovery.sql'));
 await db.exec(await read('supabase/migrations/20261023175105_web_push_notifications.sql'));
 await db.exec(await read('supabase/migrations/20261023193752_in_app_activity.sql'));
 await db.exec(await read('supabase/migrations/20261023202526_remove_push_quiet_hours.sql'));
 await db.exec('create role hostile_defaults;alter default privileges grant execute on functions to hostile_defaults;alter default privileges grant select on tables to hostile_defaults');
 await check('new migration executes without broadening profile, private-schema or custom-role access',async()=>{
  await db.exec(await read('supabase/migrations/20261023210942_add_friend_by_username.sql'));
  for(const role of ['anon','service_role','hostile_defaults'])assert.equal((await q("select has_function_privilege($1,'public.send_username_friend_request(text)','EXECUTE') ok",[role]))[0].ok,false);
  assert.equal((await q("select has_function_privilege('authenticated','public.send_username_friend_request(text)','EXECUTE') ok"))[0].ok,true);
  for(const role of ['anon','authenticated','service_role','hostile_defaults'])assert.equal((await q("select has_table_privilege($1,'azice_private.username_request_limits','SELECT') ok",[role]))[0].ok,false);
  await assert.rejects(as(null,"select public.send_username_friend_request('user_1')"),/Profile required/);
 });
 for(const [i,user] of [A,B,C].entries()){
  await q('insert into auth.users values($1)',[user]);
  await q('insert into public.profiles(id,username,display_name,bio,is_18_plus_confirmed) values($1,$2,$3,$4,true)',[user,'user_'+i,'User '+i,'Private bio']);
 }
 const send=async(user,name)=>(await as(user,'select public.send_username_friend_request($1) status',[name]))[0].status;
 const count=async(table)=>Number((await q('select count(*) n from '+table))[0].n);
 await check('exact username including @ creates one authoritative request and push event, returning status only',async()=>{
  await as(B,"select public.save_notification_preferences('{\"enabled\":true}')");
  await q('select public.push_register($1,$2,$3)',[B,{endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'test',auth:'test'}},'a'.repeat(64)]);
  assert.equal(await send(A,'user'),'not_found');assert.equal(await send(A,'  @user_1  '),'sent');
  assert.equal(await count('public.friend_requests'),1);assert.equal(await count('azice_push.jobs'),1);
  assert.equal((await as(A,'select * from public.profiles where id=$1',[B])).length,0);
  assert.equal(await send(A,'user_1'),'pending');assert.equal(await send(B,'user_0'),'pending');
  assert.equal(await count('public.friend_requests'),1);assert.equal(await count('azice_push.jobs'),1);
 });
 await check('self, invalid syntax and arbitrary UUIDs do not create requests; accepted friendship returns friends',async()=>{
  assert.equal(await send(A,'@user_0'),'self');
  for(const value of ['@@user_1','USER_1','us%','ab',B,null])assert.equal(await send(C,value),'invalid');
  assert.equal(await count('public.friend_requests'),1);
  const id=(await q('select id from public.friend_requests'))[0].id;
  await as(B,"select public.handle_friend_request($1,'accept')",[id]);assert.equal(await send(A,'user_1'),'friends');
 });
 await check('unknown-name attempts persist and throttle after 10, even across committed misses; window resets',async()=>{
  await q('delete from azice_private.username_request_limits where user_id=$1',[C]);
  for(let n=0;n<10;n++)assert.equal(await send(C,'unknown_'+n),'not_found');
  assert.equal(await send(C,'user_0'),'rate_limited');
  assert.equal((await q('select attempts from azice_private.username_request_limits where user_id=$1',[C]))[0].attempts,10);
  await q("update azice_private.username_request_limits set window_started=clock_timestamp()-interval '61 minutes' where user_id=$1",[C]);
  assert.equal(await send(C,'unknown_again'),'not_found');
  assert.equal((await q('select attempts from azice_private.username_request_limits where user_id=$1',[C]))[0].attempts,1);
 });
 await check('existing invitation and comment-discovery requests remain functional and private',async()=>{
  const token=(await as(A,'select public.rotate_invite() token'))[0].token;
  const invited=(await as(C,'select public.send_friend_request($1) id',[token]))[0].id;await as(C,"select public.handle_friend_request($1,'cancel')",[invited]);
  await q('insert into public.friendships(user_a,user_b) values($1,$2)',[B,C]);
  const post=(await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Fixture','published',now()) returning id",[B]))[0].id;
  const comment=(await q("insert into public.comments(post_id,author_id,body) values($1,$2,'Comment fixture') returning id",[post,A]))[0].id;
  const id=(await as(C,'select public.send_comment_friend_request($1) id',[comment]))[0].id;
  assert.equal(await send(C,'user_0'),'pending');await as(C,"select public.handle_friend_request($1,'cancel')",[id]);
  assert.equal((await as(C,'select * from public.profiles where id=$1',[A])).length,0);
 });
 await check('existing 30-per-hour send quota remains enforced and failed helper calls retain lookup attempts',async()=>{
  await q('delete from azice_private.username_request_limits where user_id=$1',[C]);
  for(let n=1;n<=30;n++){
   const target='dd000000-0000-4000-8000-'+String(n).padStart(12,'0');
   await q('insert into auth.users values($1)',[target]);await q('insert into public.profiles(id,username,display_name,is_18_plus_confirmed) values($1,$2,$3,true)',[target,'fixture_'+n,'Fixture']);
   await q("insert into public.friend_requests(sender_id,receiver_id,status) values($1,$2,'canceled')",[C,target]);
  }
  assert.equal(await send(C,'user_0'),'rate_limited');
  assert.equal((await q('select attempts from azice_private.username_request_limits where user_id=$1',[C]))[0].attempts,1);
 });
 await check('account deletion cascades the private counter and its pending requests',async()=>{
  await q('delete from auth.users where id=$1',[C]);assert.equal((await q('select * from azice_private.username_request_limits where user_id=$1',[C])).length,0);
  assert.equal((await q('select id from public.friend_requests where sender_id=$1 or receiver_id=$1',[C])).length,0);
 });
 console.log(`${passed} PostgreSQL regression groups passed (PGlite; no remote SQL or multi-session concurrency test).`);
}finally{await db.close();}
