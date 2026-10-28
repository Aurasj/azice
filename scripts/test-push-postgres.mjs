// Optional actual PostgreSQL-engine tests in disposable in-memory PGlite, never a remote DB.
// npm ci --ignore-scripts installs the locked development-only test tools.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8'),baseOnly=process.env.AZICE_PUSH_BASE_ONLY==='1';
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[])=>{await db.exec('begin;set local role authenticated;');await q("select set_config('request.jwt.claim.sub',$1,true)",[user]);try{const rows=await q(sql,args);await db.exec('commit');return rows;}catch(e){await db.exec('rollback');throw e;}};
const count=async(table,where='true')=>Number((await q(`select count(*) n from ${table} where ${where}`))[0].n);
const claim=async()=>(await q('select public.push_claim() batch'))[0].batch;
const due=()=>db.exec('update azice_push.jobs set due_at=now() where batch_id is null');
const zone=async hour=>(await q('select name from pg_timezone_names where extract(hour from now() at time zone name)=$1 limit 1',[hour]))[0].name;
const prefs=(user,value)=>as(user,'select to_jsonb(public.save_notification_preferences($1)) settings',[value]);
const publish=async user=>{const id=(await q("insert into public.posts(author_id,kind,reason) values($1,'sober','Private test reason') returning id",[user]))[0].id;await as(user,'select public.publish_post($1)',[id]);return id;};
const finish=async batch=>{for(const d of batch.devices)await q("select public.push_complete($1,$2,$3,'sent')",[batch.id,batch.token,d.id]);await q('select public.push_release($1,$2)',[batch.id,batch.token]);};
try{
 // Pin minutes inside the reminder window in this disposable engine, independent of wall-clock minutes.
 await db.exec("create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select date_trunc('hour',transaction_timestamp())+interval '10 minutes'$$");
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,service_role;
 create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);`);
 const schema=await read('supabase/schema.sql');await db.exec(schema.slice(0,schema.indexOf('-- Storage:')));
 await db.exec(schema.slice(schema.indexOf('-- Access controls on functions')));
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
 await db.exec('alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;');
 await db.exec(schema.slice(schema.indexOf('create policy avatar_select'),schema.indexOf('create policy avatar_remove')));
 await db.exec("create policy post_image_select on storage.objects for select to authenticated using(bucket_id='post-images' and exists(select 1 from public.post_photos pp where pp.path=storage.objects.name and public.can_view_post(pp.post_id)))");
 if(!baseOnly)await db.exec(await read('supabase/migrations/20261023012201_comment_author_discovery.sql'));
 await db.exec("create function public.push_claim(integer) returns integer language sql as $$select $1$$;grant execute on function public.push_claim(integer) to authenticated");
 await check('forward-only migration executes in PostgreSQL',async()=>{await db.exec(await read('supabase/migrations/20261023175105_web_push_notifications.sql'));});
 for(const [i,u] of [A,B,C].entries()){await q('insert into auth.users values($1)',[u]);await q('insert into public.profiles(id,display_name,username,is_18_plus_confirmed) values($1,$2,$3,true)',[u,'User '+i,'user_'+i]);}
 await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
 await check('preferences default off, reminders off, only owner can read/update',async()=>{
  assert.equal((await as(B,'select public.push_claim(7) value'))[0].value,7); // Unrelated overload ACL remains intact.
  const p=(await prefs(B,{}))[0].settings;assert.equal(p.enabled,false);assert.equal(p.posting_reminders,false);
  assert.equal((await as(C,'select * from public.notification_preferences')).length,0);
  await assert.rejects(as(C,'update public.notification_preferences set enabled=true where user_id=$1',[B]),/permission denied/);
  await assert.rejects(prefs(B,{timezone:'fake/timezone'}),/Invalid timezone/);
  await assert.rejects(as(B,'select public.push_claim()'),/permission denied/);
  await assert.rejects(as(B,'select public.push_register($1,$2,$3)',[A,{endpoint:'https://fcm.googleapis.com/fcm/send/foreign'},'a'.repeat(64)]),/permission denied/);
  await assert.rejects(as(B,'select * from azice_push.subscriptions'),/permission denied/);
 });
 await prefs(B,{enabled:true,timezone:await zone(12)});await prefs(A,{enabled:true,timezone:await zone(12)});
 const subscription=n=>({endpoint:'https://fcm.googleapis.com/fcm/send/test-'+n,keys:{p256dh:'test',auth:'test'}});
 const register=async(user,n)=>(await q('select public.push_register($1,$2,$3) id',[user,subscription(n),'a'.repeat(64)]))[0].id;
 const device=await register(B,1);await register(B,2);
 await check('subscription owner cannot be hijacked, per-device unregister is owner scoped',async()=>{
  await assert.rejects(register(A,1),/Subscription unavailable/);
  await q('select public.push_unregister($1,$2)',[A,subscription(1).endpoint]);assert.equal(await count('azice_push.subscriptions'),2);
 });
 await check('grouping absorbs matching due jobs but leaves future jobs for a later batch',async()=>{
  // Isolate this case so its reservations and source events cannot affect other regressions.
  await db.exec('begin');
  try{
   await q("insert into public.posts(author_id,kind,reason,status,published_at) select $1,'sober','Grouping fixture','published',now() from generate_series(1,3)",[A]);
   const jobs=await q("select id from azice_push.jobs where user_id=$1 and category='new_posts' order by id",[B]);
   assert.equal(jobs.length,3);
   await q("update azice_push.jobs set due_at=case when id=$1 then now()+interval '10 minutes' else now() end",[jobs[2].id]);
   const first=await claim();assert.equal(first.category,'new_posts');
   assert.equal(await count('azice_push.jobs',`batch_id='${first.id}'`),2);
   assert.equal((await q('select batch_id from azice_push.jobs where id=$1',[jobs[2].id]))[0].batch_id,null);
   await finish(first);assert.equal(await claim(),null);
   await q("update azice_push.jobs set due_at=now()-interval '1 second' where id=$1",[jobs[2].id]);
   const later=await claim();assert.notEqual(later.id,first.id);
   assert.equal((await q('select batch_id from azice_push.jobs where id=$1',[jobs[2].id]))[0].batch_id,later.id);
   assert.equal(await count('azice_push.jobs',`batch_id='${later.id}'`),1);
  }finally{await db.exec('rollback');}
 });
 let post,postsBatch;
 await check('drafts never enqueue; published posts target confirmed friends only and group',async()=>{
  await q("insert into public.posts(author_id,kind,reason) values($1,'sober','Draft')",[A]);assert.equal(await count('azice_push.jobs'),0);
  post=await publish(A);await publish(A);await publish(C);
  assert.equal(await count('azice_push.jobs'),2);assert.equal(await count('azice_push.jobs',`user_id='${C}'`),0);
  await due();postsBatch=await claim();assert.equal(postsBatch.category,'new_posts');assert.equal(postsBatch.devices.length,2);
  assert.equal(await count('azice_push.jobs',`batch_id='${postsBatch.id}'`),2);
 });
 await check('notification resolution is owner scoped and checks live post authorization',async()=>{
  const target=(await as(B,'select public.resolve_notification($1) target',[postsBatch.id]))[0].target;assert.equal(target.screen,'post');
  assert.equal((await as(C,'select public.resolve_notification($1) target',[postsBatch.id]))[0].target,null);
  await q('delete from public.friendships where user_a=$1 and user_b=$2',[A,B]);
  assert.equal((await q('select public.push_validate($1,$2,$3) ok',[postsBatch.id,postsBatch.token,device]))[0].ok,false);
  assert.equal((await as(B,'select public.resolve_notification($1) target',[postsBatch.id]))[0].target,null);
  await q('insert into public.friendships values($1,$2,now())',[A,B]);await finish(postsBatch);
 });
 await check('new-post notifications reserve at most two batches per local day across retries',async()=>{
  await publish(A);await due();const second=await claim();assert.equal(second.category,'new_posts');
  await q('select public.push_release($1,$2)',[second.id,second.token]);await db.exec('update azice_push.batches set due_at=now(),leased_until=null where not done');
  const retry=await claim();assert.equal(retry.id,second.id);assert.equal(await count('azice_push.reservations',"category='new_posts'"),2);await finish(retry);
  await publish(A);await due();assert.equal(await claim(),null);assert.equal(await count('azice_push.reservations',"category='new_posts'"),2);
 });
 await check('friend requests queue through normal invitation logic; pending duplicates and cancellation are safe',async()=>{
  const token=(await as(B,'select public.rotate_invite() token'))[0].token;
  const id=(await as(C,'select public.send_friend_request($1) id',[token]))[0].id;
  if(baseOnly)await assert.rejects(as(C,'select public.send_friend_request($1)',[token]),/pending/);
  else assert.equal((await as(C,'select public.send_friend_request($1) id',[token]))[0].id,id);
  assert.equal(await count('azice_push.jobs',"category='friend_requests'"),1);
  await prefs(B,{timezone:await zone(23)});const batch=await claim();assert.equal(batch.category,'friend_requests');
  await as(C,"select public.handle_friend_request($1,'cancel')",[id]);assert.equal((await q('select public.push_validate($1,$2,$3) ok',[batch.id,batch.token,device]))[0].ok,false);
  await finish(batch);await prefs(B,{timezone:await zone(12)});
 });
 await check('comments skip self, group by post, reactions deduplicate emoji changes and respect removal',async()=>{
  const ownerPost=await publish(B);
  await q("insert into public.comments(post_id,author_id,body) values($1,$2,'Private comment'),($1,$2,'Another private comment'),($1,$3,'Self')",[ownerPost,A,B]);
  assert.equal(await count('azice_push.jobs',"category='comments'"),2);await due();let batch=await claim();assert.equal(batch.category,'comments');
  assert.equal(await claim(),null); // Live lease cannot be claimed twice.
  assert.equal(await count('azice_push.jobs',`batch_id='${batch.id}'`),2);await finish(batch);
  await q("insert into public.reactions(post_id,user_id,emoji) values($1,$2,'❤️')",[ownerPost,A]);
  await q("update public.reactions set emoji='🔥' where post_id=$1",[ownerPost]);assert.equal(await count('azice_push.jobs',"category='reactions'"),1);
  await due();batch=await claim();assert.equal(batch.category,'reactions');
  await q('delete from public.reactions where post_id=$1',[ownerPost]);assert.equal((await q('select public.push_validate($1,$2,$3) ok',[batch.id,batch.token,device]))[0].ok,false);await finish(batch);
 });
 await check('quiet hours defer nonurgent batches until local 09:00',async()=>{
  await prefs(B,{timezone:await zone(23)});const ownerPost=await publish(B);
  await q("insert into public.comments(post_id,author_id,body) values($1,$2,'Private')",[ownerPost,A]);await due();assert.equal(await claim(),null);
  const rows=await q("select extract(hour from b.due_at at time zone p.timezone) as local_hour from azice_push.batches b join public.notification_preferences p on p.user_id=b.user_id where b.category='comments' and not b.done");assert.equal(Number(rows[0].local_hour),9);
  await prefs(B,{comments:false});assert.equal(await count('azice_push.batches',"category='comments' and not done"),0);await prefs(B,{comments:true,timezone:await zone(12)});
 });
 await check('expired devices are removed and successful devices are not retried',async()=>{
  await db.exec("update azice_push.batches set done=true where not done");const ownerPost=await publish(B);
  await q("insert into public.comments(post_id,author_id,body) values($1,$2,'Private')",[ownerPost,A]);await due();const batch=await claim();
  await q("select public.push_complete($1,$2,$3,'expired')",[batch.id,batch.token,batch.devices[0].id]);
  await q("select public.push_complete($1,$2,$3,'sent')",[batch.id,batch.token,batch.devices[1].id]);
  await q('select public.push_release($1,$2)',[batch.id,batch.token]);assert.equal(await count('azice_push.subscriptions'),1);assert.equal((await q('select done from azice_push.batches where id=$1',[batch.id]))[0].done,true);
 });
 await check('reminders require opt-in, local 20:00, no post today, recent friend activity; cap three per seven days',async()=>{
  await db.exec("update azice_push.batches set done=true where not done");await prefs(B,{posting_reminders:true,timezone:await zone(20)});
  await db.exec('select azice_push.reminders()');assert.equal(await count('azice_push.jobs',"category='posting_reminders'"),0); // B posted today.
  await q("update public.posts set published_at=now()-interval '3 days' where author_id=$1",[B]);
  await db.exec('select azice_push.reminders();select azice_push.reminders()');assert.equal(await count('azice_push.jobs',"category='posting_reminders'"),1);
  const reminder=await claim();assert.equal(reminder.category,'posting_reminders');await finish(reminder);
  await prefs(B,{timezone:await zone(12)});
  assert.equal((await q("select azice_push.allowed(j) ok from azice_push.jobs j where category='posting_reminders'"))[0].ok,false);
  await prefs(B,{timezone:await zone(20)});await q('delete from public.friendships where user_a=$1 and user_b=$2',[A,B]);
  assert.equal((await q("select azice_push.allowed(j) ok from azice_push.jobs j where category='posting_reminders'"))[0].ok,false);
  await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
  await q("insert into azice_push.batches(user_id,category,done) values($1,'posting_reminders',true),($1,'posting_reminders',true) returning id",[B]).then(async rows=>{for(const r of rows)await q("insert into azice_push.reservations values($1,$2,'posting_reminders',current_date-1,now()-interval '1 day')",[r.id,B]);});
  await q("insert into azice_push.jobs(event_key,user_id,category,due_at) values('test-extra-reminder',$1,'posting_reminders',now())",[B]);assert.equal(await claim(),null);
  await prefs(B,{posting_reminders:false});await db.exec("delete from azice_push.jobs where category='posting_reminders';select azice_push.reminders()");assert.equal(await count('azice_push.jobs',"category='posting_reminders'"),0);
 });
 await check('disabling consent removes subscriptions, cancels queued work without resetting quotas',async()=>{
  const before=await count('azice_push.reservations');await prefs(B,{enabled:false});assert.equal(await count('azice_push.subscriptions'),0);assert.equal(await count('azice_push.jobs',`user_id='${B}'`),0);assert.equal(await count('azice_push.reservations'),before);
 });
 if(!baseOnly)await check('comment-discovery requests use the same authoritative pending-request trigger',async()=>{
  await q('insert into public.friendships(user_a,user_b) values($1,$2)',[B,C]);await prefs(C,{enabled:true,timezone:await zone(12)});await register(C,8);
  const p=await publish(B),comment=(await q("insert into public.comments(post_id,author_id,body) values($1,$2,'Comment-discovery fixture') returning id",[p,C]))[0].id;
  const request=(await as(A,'select public.send_comment_friend_request($1) id',[comment]))[0].id;
  assert.equal(await count('azice_push.jobs',`request_id='${request}' and user_id='${C}'`),1);
  const batch=await claim();assert.equal(batch.category,'friend_requests');await finish(batch);
 });
 await check('account deletion cascades subscriptions/preferences/jobs/delivery state',async()=>{
  await prefs(B,{enabled:true});await register(B,3);await q('delete from auth.users where id=$1',[B]);
  for(const table of ['public.notification_preferences','azice_push.subscriptions','azice_push.jobs','azice_push.batches','azice_push.reservations'])assert.equal(await count(table,`user_id='${B}'`),0,table);
  assert.equal(await count('azice_push.subscriptions',`user_id='${C}'`),baseOnly?0:1);
 });
 await check('scheduler rejects duplicate job names and dispatches only due, unleased work (Cron/HTTP stubs)',async()=>{
  await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
   insert into vault.decrypted_secrets values('azice_push_dispatch_url','https://example.test/functions/v1/push-dispatch'),('azice_push_dispatch_secret','dummy-test-secret');
   create schema cron;create table cron.job(jobname text);
   create schema net;create table public.push_test_http(url text,headers jsonb);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into public.push_test_http values(url,headers) returning 1::bigint$$;`);
  const schedule=await read('supabase/notifications_schedule.sql');await db.exec(schedule.slice(schedule.indexOf('create function azice_push.tick()'),schedule.indexOf('revoke all on function')));
  const duplicateGuard=schedule.slice(schedule.indexOf(' if exists(select 1 from cron.job'),schedule.indexOf('end $$;'));
  await db.exec('do $$begin'+duplicateGuard+'end $$;');
  await db.exec("insert into cron.job values('azice-push-dispatch')");
  await assert.rejects(db.exec('do $$begin'+duplicateGuard+'end $$;'),/Schedule exists/);
  assert.equal(await count('cron.job'),1);
  await db.exec('select azice_push.tick()');assert.equal(await count('public.push_test_http'),0);
  await q("insert into azice_push.jobs(event_key,user_id,category,due_at) values('schedule-test',$1,'friend_requests',now()+interval '10 minutes')",[A]);
  await db.exec('select azice_push.tick()');assert.equal(await count('public.push_test_http'),0);
  await db.exec("update azice_push.jobs set due_at=now() where event_key='schedule-test'");
  await db.exec('select azice_push.tick()');assert.equal(await count('public.push_test_http'),1);
  await db.exec("delete from azice_push.jobs where event_key='schedule-test'");
  const batch=(await q("insert into azice_push.batches(user_id,category,due_at) values($1,'friend_requests',now()+interval '10 minutes') returning id",[A]))[0].id;
  await db.exec('select azice_push.tick()');assert.equal(await count('public.push_test_http'),1);
  await q("update azice_push.batches set due_at=now(),leased_until=now()+interval '2 minutes' where id=$1",[batch]);
  await db.exec('select azice_push.tick()');assert.equal(await count('public.push_test_http'),1);
  await q("update azice_push.batches set leased_until=now()-interval '1 second' where id=$1",[batch]);
  await db.exec('select azice_push.tick()');assert.equal(await count('public.push_test_http'),2);
 });
 console.log(`PostgreSQL engine: ${passed} regression groups passed (PGlite; no remote database or multi-session concurrency test).`);
}finally{await db.close();}
