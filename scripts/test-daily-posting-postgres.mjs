// Disposable PostgreSQL engine only; uses locked root PGlite tools; see docs/backend/web-push.md.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[])=>{await db.exec('begin;set local role authenticated');await q("select set_config('request.jwt.claim.sub',$1,true)",[user]);try{const rows=await q(sql,args);await db.exec('commit');return rows;}catch(error){await db.exec('rollback');throw error;}};
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
try{
 await db.exec("create schema test_clock;create table test_clock.value(t timestamptz);insert into test_clock.value values('2026-10-24 12:00:00Z');alter function pg_catalog.clock_timestamp() rename to actual_clock_timestamp;create function pg_catalog.clock_timestamp() returns timestamptz language sql stable security definer set search_path='' as $$select t from test_clock.value$$");
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
 await db.exec(await read('supabase/migrations/20261023210942_add_friend_by_username.sql'));
 const clock=t=>q('update test_clock.value set t=$1',[t]);
 let index=0;
 const user=async()=>{const id='dd000000-0000-4000-8000-'+String(++index).padStart(12,'0');await q('insert into auth.users values($1)',[id]);await q('insert into public.profiles(id,username,display_name,is_18_plus_confirmed) values($1,$2,$3,true)',[id,'daily_'+index,'Daily']);return id;};
 const status=async(id,zone=null)=>(await as(id,'select public.get_daily_posting_status($1) data',[zone]))[0].data;
 const draft=async(id,kind='sober',photos=0)=>{const post=(await q("insert into public.posts(author_id,kind,reason) values($1,$2,'Valid reason') returning id",[id,kind]))[0].id;for(let n=1;n<=photos;n++){const path=`${id}/${post}/${n}.jpg`;await q('insert into public.post_photos(post_id,slot,path) values($1,$2,$3)',[post,n,path]);await q("insert into storage.objects(bucket_id,name) values('post-images',$1)",[path]);}return post;};
 const publish=(id,post)=>as(id,'select public.publish_post($1)',[post]);
 const acl=()=>q("select oid,proowner,proacl from pg_proc where oid='public.publish_post(uuid)'::regprocedure");
 const legacy=await user();await q("insert into public.posts(author_id,kind,reason,status,published_at) select $1,'sober','Existing','published',clock_timestamp() from generate_series(1,4)",[legacy]);
 await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'drank','Historical','published','2020-01-01Z')",[legacy]);
 const before=await q('select * from public.posts order by id'),beforeAcl=await acl();
 await check('forward migration preserves existing posts and publish ACLs; private counter/helper remain inaccessible',async()=>{
  await db.exec(await read('supabase/migrations/20261024112734_daily_posting_cap.sql'));
  assert.deepEqual(await q('select * from public.posts order by id'),before);assert.deepEqual(await acl(),beforeAcl);
  assert.equal((await status(legacy,'UTC')).count,4);await assert.rejects(publish(legacy,await draft(legacy)),/DAILY_POST_LIMIT/);
  await assert.rejects(as(null,'select public.get_daily_posting_status()'),/Profile required/);
  await assert.rejects(as(legacy,'select * from azice_private.daily_post_usage'),/permission denied/);
  await assert.rejects(as(legacy,'select azice_private.posting_status($1)',[legacy]),/permission denied/);
  assert.equal((await q("select has_function_privilege('anon','public.get_daily_posting_status(text)','execute') ok"))[0].ok,false);
 });
 for(const existing of [0,1,2,3])await check(`${existing} existing posts count both kinds and exclude drafts/history`,async()=>{
  const id=await user();await q("insert into public.posts(author_id,kind,reason,status,published_at) select $1,case when n%2=0 then 'sober' else 'drank' end,'Existing','published',clock_timestamp() from generate_series(1,$2::integer) n",[id,existing]);
  await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Old','published',clock_timestamp()-interval '2 days')",[id]);
  const post=await draft(id);assert.equal((await status(id,'UTC')).count,existing);
  const preferences=(await q('select enabled,posting_reminders from public.notification_preferences where user_id=$1',[id]))[0];assert.equal(preferences.enabled,false);assert.equal(preferences.posting_reminders,false);
  if(existing===3)await assert.rejects(publish(id,post),/DAILY_POST_LIMIT/);else await publish(id,post);
  assert.equal((await status(id)).count,Math.min(3,existing+1));
 });
 await check('three mixed-type posts share a cap; repeat and foreign draft publishing cannot consume slots',async()=>{
  const id=await user(),other=await user();await status(id,'UTC');
  const first=await draft(id,'drank',1);await assert.rejects(publish(other,first),/Draft not found/);await publish(id,first);await assert.rejects(publish(id,first),/Draft not found/);
  await publish(id,await draft(id,'sober'));await publish(id,await draft(id,'drank',3));
  await assert.rejects(publish(id,await draft(id)),/DAILY_POST_LIMIT/);assert.equal((await status(id)).count,3);
 });
 await check('competing transaction submissions for the last slot admit one (PGlite serializes transactions)',async()=>{
  const id=await user();await status(id,'UTC');await publish(id,await draft(id));await publish(id,await draft(id));const drafts=[await draft(id),await draft(id)];
  const results=await Promise.allSettled(drafts.map(post=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await tx.query('select public.publish_post($1)',[post]);})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/DAILY_POST_LIMIT/);assert.equal((await status(id)).count,3);
 });
 await check('Bucharest midnight resets locally; saved timezone wins over browser hints and handles half-hour offsets',async()=>{
  const id=await user();await clock('2026-10-24T20:59:59Z');const initial=await status(id,'Europe/Bucharest');assert.equal(initial.day,'2026-10-24');assert.equal(Date.parse(initial.reset_at),Date.parse('2026-10-24T21:00:00Z'));
  for(let n=0;n<3;n++)await publish(id,await draft(id));await clock('2026-10-24T21:00:00Z');assert.equal((await status(id,'UTC')).count,0);assert.equal((await status(id)).timezone,'Europe/Bucharest');await publish(id,await draft(id));assert.equal((await status(id)).count,1);
  const offset=await status(await user(),'Asia/Kathmandu');assert.equal(Date.parse(offset.reset_at),Date.parse('2026-10-25T18:15:00Z'));
 });
 await check('calendar-day bounds handle 23/25-hour DST days rather than adding 24 hours',async()=>{
  for(const [start,end,hours]of [['2026-03-08T05:00:00Z','2026-03-09T04:00:00Z',23],['2026-11-01T04:00:00Z','2026-11-02T05:00:00Z',25]]){await clock(start);const value=await status(await user(),'America/New_York');assert.equal(Date.parse(value.reset_at),Date.parse(end));assert.equal((Date.parse(value.reset_at)-Date.parse(value.server_now))/3600000,hours);}
  await clock('2026-10-24T12:00:00Z');
 });
 await check('photo verification, reason validation, draft-only RLS and failed-publish rollback stay intact',async()=>{
  const id=await user();await status(id,'UTC');await assert.rejects(publish(id,await draft(id,'drank')),/Invalid photo count/);
  const post=await draft(id,'drank',1);await q('delete from storage.objects where name like $1',[`${id}/${post}/%`]);await assert.rejects(publish(id,post),/Photo verification failed/);assert.equal((await status(id)).count,0);
  await assert.rejects(as(id,"insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Invalid bypass','published',clock_timestamp())",[id]),/row-level security/);
  assert.equal((await as(id,"update public.posts set status='published' where id=$1 returning id",[post])).length,0);
  await assert.rejects(as(id,"insert into public.posts(author_id,kind,reason) values($1,'sober','')",[id]),/check constraint/);
  await publish(id,await draft(id,'drank',1));assert.equal((await status(id)).count,1);
 });
 await check('usage is account scoped and account deletion cascades its private row',async()=>{
  const id=await user(),other=await user(),post=await draft(id);await assert.rejects(publish(id,post),/Posting timezone is not configured/);await status(id,'UTC');await publish(id,post);assert.equal((await status(other,'UTC')).count,0);
  await q('delete from auth.users where id=$1',[id]);assert.equal((await q('select * from azice_private.daily_post_usage where user_id=$1',[id])).length,0);
 });
 console.log(`${passed} daily-cap PostgreSQL regression groups passed (PGlite; no native multi-session concurrency test).`);
}finally{await db.close();}
