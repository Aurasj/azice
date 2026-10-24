// PostgreSQL/RLS regression only. Storage HTTP and physical blobs are not simulated here.
import {PGlite} from '../supabase/.temp/push-tests/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(user,sql,args=[],role='authenticated')=>{
 await db.exec('begin;set local role '+role);
 try{await q("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const rows=await q(sql,args);await db.exec('commit');return rows;}
 catch(error){await db.exec('rollback');throw error;}
};
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 const base=await read('supabase/schema.sql');await db.exec(base.slice(0,base.indexOf('-- Storage:')));await db.exec(base.slice(base.indexOf('-- Access controls on functions')));
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,delete on storage.objects to anon,authenticated');
 await db.exec(base.slice(base.indexOf('create policy post_image_insert'),base.indexOf('-- Note: No UPDATE policies')));
 for(const file of [
  '20261023012201_comment_author_discovery.sql','20261023175105_web_push_notifications.sql',
  '20261023193752_in_app_activity.sql','20261023202526_remove_push_quiet_hours.sql',
  '20261023210942_add_friend_by_username.sql','20261024112734_daily_posting_cap.sql',
  '20261024171206_restrict_friendship_helper.sql'
 ])await db.exec(await read('supabase/migrations/'+file));
 for(const [i,user] of [A,B].entries()){
  await q('insert into auth.users values($1)',[user]);
  await q('insert into public.profiles(id,username,display_name,is_18_plus_confirmed) values($1,$2,$3,true)',[user,'cleanup_'+i,'User '+i]);
 }
 await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
 await as(A,"select public.get_daily_posting_status('UTC')");
 const draft=async()=>{const id=crypto.randomUUID();await as(A,"insert into public.posts(id,author_id,kind,reason) values($1,$2,'drank','Fixture')",[id,A]);return id;};
 const path=(id,slot=1)=>`${A}/${id}/${slot}.jpg`;
 const metadata=(id,slot=1)=>as(A,'insert into public.post_photos(post_id,slot,path) values($1,$2,$3)',[id,slot,path(id,slot)]);
 const upload=name=>as(A,"insert into storage.objects(bucket_id,name) values('post-images',$1)",[name]);
 const remove=(user,name)=>as(user,'delete from storage.objects where name=$1 returning name',[name]);
 const legacy=await draft();await upload(path(legacy));
 await check('reproduces existing policy gap: upload without metadata cannot be selected or deleted by its owner',async()=>{
  assert.equal((await q('select * from storage.objects where name=$1',[path(legacy)])).length,1);
  assert.equal((await as(A,'select * from storage.objects where name=$1',[path(legacy)])).length,0);
  assert.equal((await remove(A,path(legacy))).length,0);
 });
 await check('preserving the owned draft allows metadata repair and authorized Storage deletion without widening policies',async()=>{
  await metadata(legacy);assert.equal((await as(A,'select * from storage.objects where name=$1',[path(legacy)])).length,1);
  assert.equal((await remove(A,path(legacy))).length,1);
  await as(A,'delete from public.posts where id=$1',[legacy]);
 });
 let current;
 await check('metadata-first creates an authorized cleanup path before every upload; failed metadata means no upload',async()=>{
  current=await draft();await metadata(current);await upload(path(current));
  await assert.rejects(metadata(current),/duplicate key/);
  await assert.rejects(metadata(current,4),/check constraint/);
  assert.equal((await remove(A,path(current))).length,1);
  await as(A,'delete from public.posts where id=$1',[current]);assert.equal((await q('select * from public.post_photos where post_id=$1',[current])).length,0);
 });
 await check('missing bytes cannot publish a reserved photo manifest; cleanup can retry partial multi-photo removal',async()=>{
  current=await draft();for(let i=1;i<=3;i++)await metadata(current,i);
  await upload(path(current));await upload(path(current,2));
  await assert.rejects(as(A,'select public.publish_post($1)',[current]),/Photo verification failed/);
  assert.equal((await remove(A,path(current))).length,1);
  assert.equal((await as(A,'select * from storage.objects where name like $1',[`${A}/${current}/%`])).length,1);
  assert.equal((await as(A,'select * from public.post_photos where post_id=$1',[current])).length,3);
  assert.equal((await remove(A,path(current))).length,0);assert.equal((await remove(A,path(current,2))).length,1);
  await as(A,'delete from public.posts where id=$1',[current]);
 });
 await check('another account and anonymous callers cannot inspect or delete owned draft photos',async()=>{
  current=await draft();await metadata(current);await upload(path(current));
  assert.equal((await as(B,'select * from storage.objects where name=$1',[path(current)])).length,0);
  assert.equal((await remove(B,path(current))).length,0);
  assert.equal((await as(null,'select * from storage.objects where name=$1',[path(current)],'anon')).length,0);
  assert.equal((await as(null,'delete from storage.objects where name=$1 returning name',[path(current)],'anon')).length,0);
  assert.equal((await as(B,'delete from public.posts where id=$1 returning id',[current])).length,0);
 });
 await check('successful publish remains atomic and published photos stay immutable, including to their owner',async()=>{
  await as(A,'select public.publish_post($1)',[current]);
  assert.equal((await as(B,'select * from storage.objects where name=$1',[path(current)])).length,1);
  assert.equal((await remove(A,path(current))).length,0);assert.equal((await remove(B,path(current))).length,0);
  assert.equal((await as(A,'delete from public.posts where id=$1 returning id',[current])).length,0);
  await assert.rejects(as(A,'select public.publish_post($1)',[current]),/Draft not found/);
 });
 await check('daily quota rejection retains the draft for owner cleanup and cannot consume another slot',async()=>{
  // Existing published rows count toward the same authoritative cap.
  await q("insert into public.posts(author_id,kind,reason,status,published_at) select $1,'sober','Existing','published',clock_timestamp() from generate_series(1,2)",[A]);
  current=await draft();await metadata(current);await upload(path(current));
  await assert.rejects(as(A,'select public.publish_post($1)',[current]),/DAILY_POST_LIMIT/);
  assert.equal((await as(A,'select status from public.posts where id=$1',[current]))[0].status,'draft');
  assert.equal((await remove(A,path(current))).length,1);await as(A,'delete from public.posts where id=$1',[current]);
  assert.equal((await as(A,'select public.get_daily_posting_status(null) data'))[0].data.count,3);
 });
 console.log(`PostgreSQL engine: ${passed} post-cleanup regression groups passed (PGlite; Storage policy metadata only, no Storage API/blob integration).`);
}finally{await db.close();}
