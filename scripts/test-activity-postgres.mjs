// Disposable PostgreSQL engine only; reuses ignored tooling documented in WEB_PUSH.md.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[])=>{await db.exec('begin;set local role authenticated');await q("select set_config('request.jwt.claim.sub',$1,true)",[user]);try{const rows=await q(sql,args);await db.exec('commit');return rows;}catch(error){await db.exec('rollback');throw error;}};
const activity=async user=>(await as(user,'select public.get_activity() data'))[0].data;
const size=async()=>Number((await q('select count(*) n from public.activity_notifications'))[0].n);
const comment=async(user,post)=>(await as(user,"insert into public.comments(post_id,author_id,body) values($1,$2,'Private source content') returning id",[post,user]))[0].id;
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
const noCron=process.env.AZICE_ACTIVITY_NO_CRON==='1';
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
 if(!noCron)await db.exec(`create schema cron;create table cron.job(jobname text primary key,schedule text,command text);
 create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1,$2,$3) returning 1::bigint$$;
 insert into cron.job values('azice-push-dispatch','* * * * *','unchanged');`);
 await check('forward migration executes with existing discovery and push; retention job is separate (Cron stub)',async()=>{
  await db.exec(await read('supabase/migrations/20261023193752_in_app_activity.sql'));
  await db.exec(await read('supabase/migrations/20261024174419_bound_activity_unread.sql'));
  if(!noCron){const jobs=await q('select * from cron.job order by jobname');assert.equal(jobs.length,2);assert.equal(jobs.find(j=>j.jobname==='azice-push-dispatch').command,'unchanged');assert.equal(jobs.find(j=>j.jobname==='azice-activity-retention').command,'select azice_activity.purge();');}
 });
 for(const [i,user] of [A,B,C].entries()){await q('insert into auth.users values($1)',[user]);await q('insert into public.profiles(id,display_name,username,is_18_plus_confirmed) values($1,$2,$3,true)',[user,'User '+i,'test_'+i]);}
 await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
 const post=(await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Private post','published',now()) returning id",[A]))[0].id;
 let event;
 await check('incoming source events create activity with push off; self and unauthorized events do not',async()=>{
  await comment(A,post);assert.equal(await size(),0);event='comment:'+await comment(B,post);
  assert.equal(await size(),1);assert.equal(Number((await q('select count(*) n from azice_push.jobs'))[0].n),0);
  await assert.rejects(comment(C,post),/row-level security/);
  await q("insert into public.comments(post_id,author_id,body) values($1,$2,'Privileged insert with no authenticated actor')",[post,C]);assert.equal(await size(),1);
  const data=await activity(A);assert.equal(data.items[0].event_key,event);assert.equal(data.unread,true);assert.doesNotMatch(JSON.stringify(data),/Private source content|Private post/);
 });
 await check('RLS and exact RPC grants prevent other-user reads, marking, forging and metadata changes',async()=>{
  assert.equal((await activity(B)).items.length,0);assert.equal((await activity(C)).unread,false);
  assert.equal((await as(B,'select public.mark_activity_read($1) ok',[event]))[0].ok,false);
  await assert.rejects(as(B,"insert into public.activity_notifications(event_key,recipient_id,actor_id,category,post_id) values('forged',$1,$2,'comment',$3)",[B,A,post]),/permission denied/);
  await assert.rejects(as(A,'update public.activity_notifications set actor_id=$1',[C]),/permission denied/);
  await assert.rejects(as(A,'delete from public.activity_notifications'),/permission denied/);
  await assert.rejects(as(A,'select azice_activity.purge()'),/permission denied/);
  assert.equal((await q("select has_function_privilege('anon','public.get_activity()','execute') ok"))[0].ok,false);
  assert.equal((await q("select has_function_privilege('anon','public.mark_activity_read(text)','execute') ok"))[0].ok,false);
  const keys=(await q("select column_name from information_schema.columns where table_schema='public' and table_name='activity_notifications' order by ordinal_position")).map(r=>r.column_name);
  assert.deepEqual(keys,['event_key','recipient_id','actor_id','category','post_id','created_at','read_at']);
 });
 await check('read marking is owner scoped and idempotent',async()=>{
  assert.equal((await as(A,'select public.mark_activity_read($1) ok',[event]))[0].ok,true);
  const first=(await activity(A)).items[0].read_at;assert.ok(first);assert.equal((await activity(A)).unread,false);
  await as(A,'select public.mark_activity_read($1)',[event]);assert.equal((await activity(A)).items[0].read_at,first);
 });
 await check('revoked post ownership and unpublished targets disappear and cannot be marked read',async()=>{
  await q('update public.posts set author_id=$1 where id=$2',[C,post]);assert.equal((await activity(A)).items.length,0);
  assert.equal((await as(A,'select public.mark_activity_read($1) ok',[event]))[0].ok,false);
  await q("update public.posts set author_id=$1,status='draft' where id=$2",[A,post]);assert.equal((await activity(A)).items.length,0);
  assert.equal((await as(A,'select public.mark_activity_read($1) ok',[event]))[0].ok,false);
  await q("update public.posts set status='published' where id=$1",[post]);assert.equal((await activity(A)).items.length,1);
 });
 await check('initial reactions notify once; emoji updates and remove/reinsert do not spam or reset read state',async()=>{
  await as(B,"insert into public.reactions values($1,$2,'❤️',now())",[post,B]);const key='reaction:'+post+':'+B;
  await as(A,'select public.mark_activity_read($1)',[key]);const before=(await q('select * from public.activity_notifications where event_key=$1',[key]))[0];
  await as(B,"update public.reactions set emoji='🔥' where post_id=$1",[post]);
  await as(B,'delete from public.reactions where post_id=$1',[post]);await as(B,"insert into public.reactions values($1,$2,'👏',now())",[post,B]);
  assert.equal(await size(),2);assert.deepEqual((await q('select * from public.activity_notifications where event_key=$1',[key]))[0],before);
 });
 await check('list is latest 50, descending; hidden older unread entries cannot keep the flag active',async()=>{
  for(let n=0;n<55;n++)await comment(B,post);
  await db.exec("update public.activity_notifications set created_at=now()-interval '1 day',read_at=null");
  const ids=await q("select event_key from public.activity_notifications where category='comment' order by event_key limit 50");
  for(const [n,row] of ids.entries())await q("update public.activity_notifications set created_at=now()+$2*interval '1 second',read_at=now() where event_key=$1",[row.event_key,n]);
  const data=await activity(A);assert.equal(data.items.length,50);assert.equal(data.unread,false);assert.ok(data.items.every(x=>x.read_at));
  for(let n=1;n<data.items.length;n++)assert.ok(data.items[n-1].created_at>=data.items[n].created_at);
 });
 await check('30-day expiration hides immediately, cannot be marked, and purge removes physical rows',async()=>{
  await q("update public.activity_notifications set created_at=now()-interval '31 days' where event_key=$1",[event]);
  assert.equal((await as(A,'select count(*) n from public.activity_notifications where event_key=$1',[event]))[0].n,0);
  assert.equal((await as(A,'select public.mark_activity_read($1) ok',[event]))[0].ok,false);
  await db.exec('select azice_activity.purge()');assert.equal((await q('select count(*) n from public.activity_notifications where event_key=$1',[event]))[0].n,0);
 });
 await check('old posts remain authorized read-only; access revocation blocks new source events',async()=>{
  await q("update public.posts set published_at=now()-interval '3 days' where id=$1",[post]);assert.equal((await as(A,'select public.can_view_post($1) ok',[post]))[0].ok,true);
  await assert.rejects(comment(B,post),/row-level security/);
  await q('delete from public.friendships where user_a=$1 and user_b=$2',[A,B]);await q('update public.posts set published_at=now() where id=$1',[post]);await assert.rejects(comment(B,post),/row-level security/);
  // Recipient still owns the post, but no actor profile access is widened.
  assert.equal((await as(A,'select id from public.profiles where id=$1',[B])).length,0);
 });
 await check('actor deletion, post deletion and recipient account deletion cascade activity',async()=>{
  await q('delete from auth.users where id=$1',[B]);assert.equal(await size(),0);
  await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,C]);await comment(C,post);await q('delete from public.posts where id=$1',[post]);assert.equal(await size(),0);
  const next=(await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Next','published',now()) returning id",[A]))[0].id;
  await comment(C,next);await q('delete from auth.users where id=$1',[A]);assert.equal(await size(),0);
 });
 console.log(`PostgreSQL engine: ${passed} Activity regression groups passed (PGlite; ${noCron?'without Cron':'Cron stub'}, no remote SQL or multi-session test).`);
}finally{await db.close();}
