// Optional actual PostgreSQL-engine tests in disposable in-memory PGlite, never a remote DB.
// npm install --prefix supabase/.temp/push-tests --no-save --ignore-scripts @electric-sql/pglite@0.5.11 typescript@5.9.3
import {PGlite} from '../supabase/.temp/push-tests/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002',C='cc000000-0000-4000-8000-000000000003';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[])=>{await db.exec('begin;set local role authenticated;');await q("select set_config('request.jwt.claim.sub',$1,true)",[user]);try{const rows=await q(sql,args);await db.exec('commit');return rows;}catch(e){await db.exec('rollback');throw e;}};
const count=async(table,where='true')=>Number((await q(`select count(*) n from ${table} where ${where}`))[0].n);
const claim=async()=>(await q('select public.push_claim() batch'))[0].batch;
const due=()=>db.exec('update azice_push.jobs set due_at=now() where batch_id is null');
const prefs=(user,value)=>as(user,'select to_jsonb(public.save_notification_preferences($1)) settings',[value]);
const publish=async user=>{const id=(await q("insert into public.posts(author_id,kind,reason) values($1,'sober','Private test reason') returning id",[user]))[0].id;await as(user,'select public.publish_post($1)',[id]);return id;};
const finish=async batch=>{for(const d of batch.devices)await q("select public.push_complete($1,$2,$3,'sent')",[batch.id,batch.token,d.id]);await q('select public.push_release($1,$2)',[batch.id,batch.token]);};
try{
 // Controllable clock only in this disposable PostgreSQL engine, never in deployed SQL.
 // A fresh function OID avoids PostgreSQL's hard-wired builtin now() fast path.
 await db.exec("create schema test_clock;create table test_clock.value(t timestamptz);insert into test_clock.value values('2026-10-23 23:10:00+00');alter function pg_catalog.now() rename to actual_now;create function pg_catalog.now() returns timestamptz language sql stable security definer set search_path='' as $$select t from test_clock.value$$");
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
 await db.exec(await read('supabase/migrations/20261023012201_comment_author_discovery.sql'));
 await db.exec("create function public.push_claim(integer) returns integer language sql as $$select $1$$;grant execute on function public.push_claim(integer) to authenticated");
 await db.exec(await read('supabase/migrations/20261023175105_web_push_notifications.sql'));
 await db.exec(await read('supabase/migrations/20261023193752_in_app_activity.sql'));
 const clock=t=>q('update test_clock.value set t=$1',[t]);
 for(const [i,u] of [A,B,C].entries()){
  await q('insert into auth.users values($1)',[u]);
  await q('insert into public.profiles(id,display_name,username,is_18_plus_confirmed) values($1,$2,$3,true)',[u,'User '+i,'user_'+i]);
 }
 await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
 await prefs(B,{enabled:true,timezone:'UTC'});
 for(let n=1;n<=2;n++)await q('select public.push_register($1,$2,$3)',[B,{endpoint:'https://fcm.googleapis.com/fcm/send/test-'+n,keys:{p256dh:'test',auth:'test'}},'a'.repeat(64)]);
 const ownerPost=await publish(B);
 const comment=()=>q("insert into public.comments(post_id,author_id,body) values($1,$2,'Private fixture') returning id",[ownerPost,A]);
 const oldDeferred=async()=>{
  const [{id}]=await comment();await due();assert.equal(await claim(),null,JSON.stringify(await q('select now(),timezone from public.notification_preferences')));
  return (await q("select b.* from azice_push.batches b join azice_push.jobs j on j.batch_id=b.id where j.event_key='comment:'||$1||':'||$2",[id,B]))[0];
 };
 // Use the ORIGINAL functions to generate real legacy deferrals, including a partial delivery.
 await clock('2026-10-23 21:10:00Z');await comment();await due();const partial=await claim();
 await q("select public.push_complete($1,$2,$3,'sent')",[partial.id,partial.token,partial.devices[0].id]);
 await q('select public.push_release($1,$2)',[partial.id,partial.token]);
 await clock('2026-10-23 23:10:00Z');assert.equal(await claim(),null);
 const deferred=await oldDeferred(),leased=await oldDeferred(),done=await oldDeferred(),expired=await oldDeferred(),ordinaryRetry=await oldDeferred();
 await prefs(B,{timezone:'Asia/Kolkata'});const changedTimezone=await oldDeferred();await prefs(B,{timezone:'UTC'});
 await q("update azice_push.batches set leased_until=now()+interval '1 minute' where id=$1",[leased.id]);
 await q('update azice_push.batches set done=true where id=$1',[done.id]);
 await q("update azice_push.batches set expires_at=now()-interval '1 minute' where id=$1",[expired.id]);
 await q("update azice_push.batches set attempts=4,due_at=now()+interval '5 minutes' where id=$1",[ordinaryRetry.id]);
 // The old 09:00 signature also represents a quota deferral; never release it over budget.
 await publish(A);await due();assert.equal(await claim(),null);
 const capped=(await q("select * from azice_push.batches where category='new_posts' and not done"))[0];
 for(let i=0;i<2;i++)await db.exec(`with b as (insert into azice_push.batches(user_id,category,done) values('${B}','new_posts',true) returning id)
  insert into azice_push.reservations select id,'${B}','new_posts','2026-10-23',now() from b`);
 const snapshot=async()=>({jobs:await q('select * from azice_push.jobs order by id'),receipts:await q('select * from azice_push.deliveries order by batch_id,subscription_id'),reservations:await q('select * from azice_push.reservations order by batch_id,local_day')});
 const acl=()=>q("select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid in ('public.push_claim()'::regprocedure,'public.push_validate(uuid,uuid,uuid)'::regprocedure) order by oid");
 const before=await snapshot(),beforeAcl=await acl();
 await check('forward migration releases valid legacy batches without changing events, receipts, quotas or RPC ACLs',async()=>{
  await db.exec(await read('supabase/migrations/20261023202526_remove_push_quiet_hours.sql'));
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await acl(),beforeAcl);
  const rows=await q('select id,due_at,attempts from azice_push.batches order by id');
  assert.equal(rows.find(r=>r.id===deferred.id).due_at.toISOString(),'2026-10-23T23:10:00.000Z');
  assert.equal(rows.find(r=>r.id===changedTimezone.id).due_at.toISOString(),'2026-10-23T23:10:00.000Z');
  assert.equal(rows.find(r=>r.id===partial.id).due_at.toISOString(),'2026-10-23T23:11:00.000Z');
  assert.equal(rows.find(r=>r.id===partial.id).attempts,1);
  for(const b of [leased,done,expired])assert.equal(rows.find(r=>r.id===b.id).due_at.toISOString(),b.due_at.toISOString());
  assert.equal(rows.find(r=>r.id===ordinaryRetry.id).due_at.toISOString(),'2026-10-23T23:15:00.000Z');
  assert.equal(rows.find(r=>r.id===capped.id).due_at.toISOString(),'2026-10-24T00:00:00.000Z');
  assert.equal((await as(B,'select public.push_claim(7) value'))[0].value,7);
  await assert.rejects(as(B,'select public.push_claim()'),/permission denied/);
 });
 await check('overnight delivery and final validation work; migration repair never repeats a terminal device',async()=>{
  const recovered=[];for(let n=0;n<2;n++){const first=await claim();recovered.push(first.id);await finish(first);}
  assert.deepEqual(recovered.sort(),[deferred.id,changedTimezone.id].sort());
  await clock('2026-10-23 23:11:00Z');const retry=await claim();assert.equal(retry.id,partial.id);
  assert.equal(retry.devices.length,1);assert.notEqual(retry.devices[0].id,partial.devices[0].id);
  assert.equal((await q('select public.push_validate($1,$2,$3) ok',[retry.id,retry.token,retry.devices[0].id]))[0].ok,true);
  assert.equal(await claim(),null);await finish(retry);assert.equal(await claim(),null);
 });
 // Isolate subsequent checks so fixtures and quota reservations cannot bleed between cases.
 const isolated=async(name,fn)=>check(name,async()=>{await db.exec('begin');try{
  await db.exec('delete from azice_push.jobs;delete from azice_push.batches;');await fn();
 }finally{await db.exec('rollback');}});
 await isolated('3/15/10 minute grouping survives, future jobs stay separate, and all three categories validate overnight',async()=>{
  await clock('2026-10-24 02:10:00Z');await comment();await comment();
  await q("insert into public.reactions(post_id,user_id,emoji) values($1,$2,'❤️')",[ownerPost,A]);await publish(A);
  const windows=await q("select category,extract(epoch from due_at-created_at)::integer seconds from azice_push.jobs order by category");
  assert.deepEqual(windows.map(r=>[r.category,r.seconds]),[['comments',180],['comments',180],['new_posts',600],['reactions',900]]);
  assert.equal(await claim(),null);
  await clock('2026-10-24 02:12:00Z');await comment();
  await clock('2026-10-24 02:13:00Z');const first=await claim();
  assert.equal(await count('azice_push.jobs',`batch_id='${first.id}'`),2);await finish(first);assert.equal(await claim(),null);
  await clock('2026-10-24 02:25:00Z');const categories=[];
  for(let i=0;i<3;i++){const batch=await claim();categories.push(batch.category);
   assert.equal((await q('select public.push_validate($1,$2,$3) ok',[batch.id,batch.token,batch.devices[0].id]))[0].ok,true);await finish(batch);}
  assert.deepEqual(categories.sort(),['comments','new_posts','reactions']);assert.equal(await claim(),null);
 });
 await isolated('daily post cap remains two and deferred quota work resumes at local midnight, not morning',async()=>{
  await clock('2026-10-23 23:10:00Z');
  for(let n=0;n<2;n++){await publish(A);await due();await finish(await claim());}
  await publish(A);await due();assert.equal(await claim(),null);
  const b=(await q('select * from azice_push.batches where not done'))[0];
  assert.equal(b.due_at.toISOString(),'2026-10-24T00:00:00.000Z');
  assert.equal(await count('azice_push.reservations'),2);
  await clock('2026-10-24 00:00:00Z');const next=await claim();assert.equal(next.id,b.id);await finish(next);assert.equal(await claim(),null);
 });
 await isolated('reminders remain opt-in, evening-only, same-day, idempotent and capped at three per rolling week',async()=>{
  await clock('2026-10-23 20:10:00Z');await publish(A);
  await q("update public.posts set published_at=now()-interval '3 days' where author_id=$1",[B]);
  await db.exec('select azice_push.reminders()');assert.equal(await count('azice_push.jobs',"category='posting_reminders'"),0);
  await prefs(B,{posting_reminders:true});await db.exec('select azice_push.reminders();select azice_push.reminders()');
  assert.equal(await count('azice_push.jobs',"category='posting_reminders'"),1);
  const b=await claim();assert.equal(b.category,'posting_reminders');
  assert.equal((await q('select public.push_validate($1,$2,$3) ok',[b.id,b.token,b.devices[0].id]))[0].ok,true);
  for(const t of ['2026-10-23 23:10:00Z','2026-10-24 08:10:00Z','2026-10-24 20:10:00Z']){
   await clock(t);await q("update azice_push.batches set leased_until=now()+interval '2 minutes' where id=$1",[b.id]);
   assert.equal((await q('select public.push_validate($1,$2,$3) ok',[b.id,b.token,b.devices[0].id]))[0].ok,false);
   if(t.includes('08:10')){await db.exec('select azice_push.reminders()');assert.equal(await count('azice_push.jobs',"category='posting_reminders'"),1);}
  }
  await clock('2026-10-23 20:10:00Z');await finish(b);
  for(let i=0;i<2;i++)await db.exec(`with b as (insert into azice_push.batches(user_id,category,done) values('${B}','posting_reminders',true) returning id)
   insert into azice_push.reservations select id,'${B}','posting_reminders','2026-10-22',now()-interval '1 day' from b`);
  await q("insert into azice_push.jobs(event_key,user_id,category,due_at) values('extra-reminder',$1,'posting_reminders',now())",[B]);
  assert.equal(await claim(),null);
 });
 await isolated('authorization and category preferences still reject revoked or disabled activity overnight',async()=>{
  await clock('2026-10-24 02:10:00Z');await comment();await due();const b=await claim();
  await q('delete from public.friendships where user_a=$1 and user_b=$2',[A,B]);
  assert.equal((await q('select public.push_validate($1,$2,$3) ok',[b.id,b.token,b.devices[0].id]))[0].ok,false);
  await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);await prefs(B,{comments:false});
  assert.equal((await q('select public.push_validate($1,$2,$3) ok',[b.id,b.token,b.devices[0].id]))[0].ok,false);
 });
 console.log(`${passed} PostgreSQL regression groups passed (PGlite; no remote database).`);
}finally{await db.close();}
