// Disposable PostgreSQL/RLS tests using the existing ignored PGlite tooling.
import {PGlite} from '../supabase/.temp/push-tests/node_modules/@electric-sql/pglite/dist/index.js';
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
const activity=async(user=A)=>(await as(user,'select public.get_activity() data'))[0].data;
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS PostgreSQL: '+name);};
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
 for(const file of ['20261023012201_comment_author_discovery.sql','20261023175105_web_push_notifications.sql',
  '20261023193752_in_app_activity.sql','20261023202526_remove_push_quiet_hours.sql',
  '20261023210942_add_friend_by_username.sql','20261024112734_daily_posting_cap.sql',
  '20261024171206_restrict_friendship_helper.sql'])await db.exec(await read('supabase/migrations/'+file));
 for(const [i,user] of [A,B,C].entries()){
  await q('insert into auth.users values($1)',[user]);
  await q('insert into public.profiles(id,username,display_name,is_18_plus_confirmed) values($1,$2,$3,true)',[user,'unread_'+i,'User '+i]);
 }
 await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
 const post=(await q("insert into public.posts(author_id,kind,reason,status,published_at) values($1,'sober','Private reason','published',now()) returning id",[A]))[0].id;
 // Synthetic persisted-event fixtures; original runner separately tests source capture.
 const seed=async(n,unread=[])=>{
  await db.exec('delete from public.activity_notifications');
  for(let i=1;i<=n;i++)await q("insert into public.activity_notifications(event_key,recipient_id,actor_id,category,post_id,created_at,read_at) values($1,$2,$3,$4,$5,now()-$6*interval '1 second',$7)",['fixture:'+String(i).padStart(3,'0'),A,B,i%2?'comment':'reaction',post,i,unread.includes(i)?null:new Date().toISOString()]);
 };
 await seed(51,[51]);
 await check('reproduces old 51-event mismatch: all visible events read but hidden oldest keeps unread true',async()=>{
  const data=await activity();assert.equal(data.items.length,50);assert.ok(data.items.every(item=>item.read_at));assert.equal(data.unread,true);
 });
 const migration=await read('supabase/migrations/20261024174419_bound_activity_unread.sql');
 const definition=()=>q("select oid,proowner,proacl,prosecdef,provolatile,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid='public.get_activity()'::regprocedure");
 const before=await definition(),rows=await q('select * from public.activity_notifications order by event_key');
 const others=await q("select p.oid,p.proacl,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','azice_private','azice_push','azice_activity') and p.oid<>'public.get_activity()'::regprocedure order by p.oid");
 const policies=await q('select oid,polqual::text,polwithcheck::text from pg_policy order by oid');
 if(process.env.AZICE_F06_BEFORE_FIX!=='1'){
  await check('wrong owner and disabled RLS fail closed without changing the function',async()=>{
   await assert.rejects(db.exec(migration.replace('begin;','begin;set local role service_role;')),/existing get_activity owner/);await db.exec('rollback');assert.deepEqual(await definition(),before);
   await db.exec('alter table public.activity_notifications disable row level security');
   await assert.rejects(db.exec(migration),/Unexpected Activity RLS/);await db.exec('rollback');assert.deepEqual(await definition(),before);
   await db.exec('alter table public.activity_notifications enable row level security');
  });
  await check('failure after function replacement rolls back its definition, privileges and all read state',async()=>{
   await assert.rejects(db.exec(migration.replace(/commit;\s*$/,'select 1/0;\ncommit;')),/division by zero/);await db.exec('rollback');
   assert.deepEqual(await definition(),before);assert.deepEqual(await q('select * from public.activity_notifications order by event_key'),rows);
  });
  await db.exec(migration);
 }
 await check('hidden 51st unread event cannot keep the indicator active when all visible events are read',async()=>{
  const data=await activity();assert.equal(data.items.length,50);assert.ok(data.items.every(item=>item.read_at));assert.equal(data.unread,false);
 });
 await check('migration preserves OID/owner/ACL/invoker/search_path, RLS, all other functions and event data; repeat is harmless',async()=>{
  const after=await definition();assert.deepEqual({...after[0],definition:null},{...before[0],definition:null});
  assert.deepEqual(await q('select * from public.activity_notifications order by event_key'),rows);
  assert.deepEqual(await q('select oid,polqual::text,polwithcheck::text from pg_policy order by oid'),policies);
  assert.deepEqual(await q("select p.oid,p.proacl,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','azice_private','azice_push','azice_activity') and p.oid<>'public.get_activity()'::regprocedure order by p.oid"),others);
  await db.exec(migration);assert.deepEqual(await definition(),after);
 });
 const mark=async key=>(await as(A,'select public.mark_activity_read($1) ok',[key]))[0].ok;
 await check('empty and fewer-than-50 sets, mixed categories and normal read marking remain correct',async()=>{
  await seed(0);assert.deepEqual(await activity(),{items:[],unread:false});
  for(const count of [1,2,49]){
   await seed(count,[1]);const data=await activity();assert.equal(data.items.length,count);assert.equal(data.unread,true);
   assert.equal(await mark('fixture:001'),true);assert.equal((await activity()).unread,false);
   if(count>1)assert.deepEqual(new Set(data.items.map(item=>item.category)),new Set(['comment','reaction']));
  }
 });
 await check('exactly 50 preserves descending order and clears only after every visible unread event is marked',async()=>{
  await seed(50,[1,50]);let data=await activity();assert.equal(data.items.length,50);assert.equal(data.items[0].event_key,'fixture:001');assert.equal(data.items[49].event_key,'fixture:050');
  assert.equal(await mark('fixture:050'),true);assert.equal((await activity()).unread,true);
  assert.equal(await mark('fixture:001'),true);data=await activity();assert.equal(data.unread,false);assert.ok(data.items.every(item=>item.read_at));
 });
 await check('equal timestamps use the same event-key tie-break for items and the unread boundary',async()=>{
  await seed(51,[1]);await db.exec("update public.activity_notifications set created_at=now()-interval '1 second'");
  const data=await activity();assert.equal(data.items[0].event_key,'fixture:051');assert.equal(data.items[49].event_key,'fixture:002');assert.equal(data.unread,false);
  assert.equal((await q("select read_at from public.activity_notifications where event_key='fixture:001'"))[0].read_at,null);
 });
 await check('new events between refresh snapshots enter the visible set and clear normally without marking hidden events',async()=>{
  await seed(51,[51]);const prior=await activity();assert.equal(prior.unread,false);
  await q("insert into public.activity_notifications(event_key,recipient_id,actor_id,category,post_id) values('new', $1,$2,'reaction',$3)",[A,B,post]);
  const next=await activity();assert.equal(next.items.length,50);assert.equal(next.items[0].event_key,'new');assert.equal(next.unread,true);
  assert.equal(prior.items.some(item=>item.event_key==='new'),false);assert.equal(await mark('new'),true);assert.equal((await activity()).unread,false);
  assert.equal((await q("select read_at from public.activity_notifications where event_key='fixture:051'"))[0].read_at,null);
 });
 await check('other accounts cannot read or mark these events; anon/service RPC grants and direct write denial are unchanged',async()=>{
  await seed(1,[1]);for(const user of [B,C]){
   assert.deepEqual(await activity(user),{items:[],unread:false});
   assert.equal((await as(user,"select public.mark_activity_read('fixture:001') ok"))[0].ok,false);
  }
  for(const role of ['anon','service_role'])await assert.rejects(as(null,'select public.get_activity()',[],role),error=>error.code==='42501');
  assert.deepEqual(await activity(null),{items:[],unread:false});
  await assert.rejects(as(A,'update public.activity_notifications set read_at=now()'),error=>error.code==='42501');
 });
 await check('30-day event expiry and inaccessible/unpublished targets do not contribute; authorized old posts remain read-only',async()=>{
  await seed(1,[1]);await db.exec("update public.activity_notifications set created_at=now()-interval '31 days'");
  assert.deepEqual(await activity(),{items:[],unread:false});assert.equal(await mark('fixture:001'),false);
  await seed(1,[1]);await q("update public.posts set published_at=now()-interval '3 days' where id=$1",[post]);
  assert.equal((await activity()).unread,true);assert.equal((await as(A,'select public.can_interact_post($1) ok',[post]))[0].ok,false);assert.equal(await mark('fixture:001'),true);
  await seed(1,[1]);await q("update public.posts set status='draft' where id=$1",[post]);assert.equal((await activity()).unread,false);assert.equal(await mark('fixture:001'),false);
  await q("update public.posts set status='published',author_id=$2 where id=$1",[post,B]);assert.equal((await activity()).unread,false);assert.equal(await mark('fixture:001'),false);
  await q('update public.posts set author_id=$2,published_at=now() where id=$1',[post,A]);
 });
 await check('friendship revocation preserves clearable own-post history without exposing the actor profile or authorizing new comments',async()=>{
  await seed(2,[1,2]);await as(A,'select public.remove_friend($1)',[B]);
  assert.equal((await as(A,'select * from public.profiles where id=$1',[B])).length,0);
  assert.equal((await activity()).items.length,2);await mark('fixture:001');await mark('fixture:002');assert.equal((await activity()).unread,false);
  await assert.rejects(as(B,"insert into public.comments(post_id,author_id,body) values($1,$2,'Revoked')",[post,B]),/row-level security/);
 });
 await check('source removal keeps markable historical events; actor and post deletion cascade and clear the indicator',async()=>{
  await seed(0);await q('insert into public.friendships(user_a,user_b) values($1,$2)',[A,B]);
  const comment=(await as(B,"insert into public.comments(post_id,author_id,body) values($1,$2,'Private comment') returning id",[post,B]))[0].id;
  await as(B,"insert into public.reactions(post_id,user_id,emoji) values($1,$2,'🔥')",[post,B]);
  await q('delete from public.comments where id=$1',[comment]);await as(B,'delete from public.reactions where post_id=$1',[post]);
  let data=await activity();assert.equal(data.items.length,2);for(const item of data.items)assert.equal(await mark(item.event_key),true);assert.equal((await activity()).unread,false);
  await seed(1,[1]);await q('delete from auth.users where id=$1',[B]);assert.equal((await activity()).unread,false);
  await q("insert into public.activity_notifications(event_key,recipient_id,actor_id,category,post_id) values('last',$1,$2,'comment',$3)",[A,C,post]);
  await q('delete from public.posts where id=$1',[post]);assert.deepEqual(await activity(),{items:[],unread:false});
 });
 console.log(`PostgreSQL engine: ${passed} F06 regression groups passed (PGlite; no hosted or native concurrent verification).`);
}finally{await db.close();}
