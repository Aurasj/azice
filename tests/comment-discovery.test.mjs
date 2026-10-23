import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCloud } from '../cloud.js';
import { createDemo } from '../demo.js';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'')
 .replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const person={id:'c',display_name:'Commenter',username:'commenter',avatar_path:null,relationship:'none',request_id:null};

function setup(profile={...person}){
 const events={},root={innerHTML:''},toast={textContent:''},dialogs=[],calls=[];
 let card=profile,restored=false;
 const makeDialog=()=>{
  const handlers={};const dialog={innerHTML:'',isConnected:true,
   setAttribute(){},addEventListener:(type,fn)=>{handlers[type]=fn;},
   querySelectorAll:()=>[],querySelector:()=>({focus(){}}),showModal(){dialog.open=true;},
   close(){dialog.open=false;handlers.close?.();},remove(){dialog.isConnected=false;},
   click:async action=>handlers.click({target:{closest:()=>({dataset:{cardAction:action}})}})
  };dialogs.push(dialog);return dialog;
 };
 const api={commentAuthor:async id=>{calls.push(['card',id]);return card;},
  sendCommentRequest:async id=>{calls.push(['send',id]);card={...card,relationship:'outgoing',request_id:'pending'};return 'pending';},
  requestAction:async(id,action)=>{calls.push([action,id]);card={...card,relationship:action==='accept'?'friends':'none',request_id:null};},
  friendData:async()=>({friends:[],incoming:[],outgoing:[]})};
 const context=vm.createContext({URLSearchParams,Map,Set,Date,console,setTimeout:()=>1,clearTimeout(){},
  navigator:{},location:{search:'',origin:'http://localhost',protocol:'http:'},sessionStorage:{getItem:()=>null,setItem(){}},
  window:{AZICE_CONFIG:{},addEventListener(){}},
  document:{activeElement:{isConnected:true,focus(){restored=true;}},
   querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:()=>[],createElement:makeDialog,
   body:{append(){}},addEventListener:(type,fn)=>{events[type]=fn;}}
 });
 vm.runInContext(source+'\nglobalThis.app={state,setCurrentUser,feedView,handleAction,openCommentAuthor,closeCommentCard,setApi:value=>{api=value;}};',context);
 const app=context.app;app.setApi(api);app.setCurrentUser({id:'a'});app.state.view='feed';app.state.profile={display_name:'Me'};
 app.state.feed=[{id:'post',author_id:'b',author:{display_name:'Post author'},published_at:new Date().toISOString(),kind:'sober',reason:'Post',comments:[{id:'comment-c',author_id:'c',author_name:'Commenter',body:'Hello',created_at:new Date().toISOString()},{id:'comment-a',author_id:'a',author_name:'Me',body:'Own comment',created_at:new Date().toISOString()}]}];
 app.state.activeComments.add('post');
 return {app,api,calls,dialogs,toast,events,root,setCard:value=>{card=value;},get restored(){return restored;}};
}

test('comment names are native buttons tied to comment IDs, including own comment',()=>{
 const h=setup();const markup=h.app.feedView();
 assert.match(markup,/<button type="button" class="comment-author" data-action="comment-user" data-id="comment-c">Commenter<\/button>/);
 assert.match(markup,/data-id="comment-a">You<\/button>/);
 assert.match(markup,/Hello/);assert.match(markup,/Own comment/);
});
for(const [relationship,labels] of [['none',['Add Friend']],['outgoing',['Request Sent']],['incoming',['Accept','Decline']],['friends',['Friends']],['self',[]]]){
 test(`comment user card renders only permitted identity and ${relationship} actions`,async()=>{
  const h=setup({...person,relationship,request_id:relationship==='incoming'?'incoming-id':null,bio:'PRIVATE BIO',posts:['PRIVATE POST'],friends:['PRIVATE FRIEND']});
  await h.app.handleAction({dataset:{action:'comment-user',id:'comment-c'}});
  const dialog=h.dialogs[0];assert.equal(dialog.open,true);
  assert.match(dialog.innerHTML,/Commenter/);assert.match(dialog.innerHTML,/@commenter/);
  for(const label of labels)assert.ok(dialog.innerHTML.includes(`>${label}</button>`));
  if(relationship==='self')assert.doesNotMatch(dialog.innerHTML,/Add Friend|Request Sent|>Accept<|>Decline</);
  assert.doesNotMatch(dialog.innerHTML,/PRIVATE|data-private-photo|Calendar|data-action="friend-profile"/);
  await dialog.click('close');assert.equal(dialog.isConnected,false);assert.equal(h.restored,true);
 });
}
test('Add Friend sends the qualifying comment ID, refreshes status and existing friend indicator data',async()=>{
 const h=setup();let refreshes=0;h.api.friendData=async()=>{refreshes++;return {friends:[],incoming:[],outgoing:[]};};
 await h.app.openCommentAuthor('comment-c');await h.dialogs[0].click('send');
 assert.deepEqual(h.calls.filter(c=>c[0]==='send'),[['send','comment-c']]);
 assert.match(h.dialogs[0].innerHTML,/>Request Sent<\/button>/);assert.equal(refreshes,1);
});
for(const action of ['accept','decline'])test(`incoming ${action} reuses the authorized request ID and existing action API`,async()=>{
 const h=setup({...person,relationship:'incoming',request_id:'real-request'});
 await h.app.openCommentAuthor('comment-c');await h.dialogs[0].click(action);
 assert.deepEqual(h.calls.filter(c=>c[0]===action),[[action,'real-request']]);
 assert.match(h.dialogs[0].innerHTML,action==='accept'?/>Friends<\/button>/:/>Add Friend<\/button>/);
});
test('stale relationship is refreshed before acting and does not send a duplicate or reverse request',async()=>{
 const h=setup();await h.app.openCommentAuthor('comment-c');
 h.setCard({...person,relationship:'incoming',request_id:'reverse'});await h.dialogs[0].click('send');
 assert.equal(h.calls.some(c=>c[0]==='send'),false);assert.match(h.dialogs[0].innerHTML,/>Accept<\/button>/);
});
test('revoked comment access closes an existing card and cannot send a request',async()=>{
 const h=setup();await h.app.openCommentAuthor('comment-c');
 h.api.commentAuthor=async()=>{throw Error('User unavailable.');};await h.dialogs[0].click('send');
 assert.equal(h.calls.some(c=>c[0]==='send'),false);assert.equal(h.dialogs[0].isConnected,false);assert.equal(h.toast.textContent,'User unavailable.');
});
test('account switch closes open cards and discards an outstanding card lookup',async()=>{
 const h=setup();await h.app.openCommentAuthor('comment-c');h.app.setCurrentUser({id:'b'});
 assert.equal(h.dialogs[0].isConnected,false);
 let resolve;h.api.commentAuthor=()=>new Promise(r=>{resolve=r;});const pending=h.app.openCommentAuthor('comment-c');
 h.app.setCurrentUser(null);resolve({...person});await pending;assert.equal(h.dialogs.length,1);
});
test('authorized avatar paths use the existing private image mechanism',async()=>{
 const h=setup({...person,avatar_path:'c/avatar.jpg',relationship:'friends'});await h.app.openCommentAuthor('comment-c');
 assert.match(h.dialogs[0].innerHTML,/data-private-photo="avatar:c\/avatar.jpg"/);
});
test('user-supplied names are escaped in the card',async()=>{
 const h=setup({...person,display_name:'<script>bad</script>',username:'<img>'});await h.app.openCommentAuthor('comment-c');
 assert.doesNotMatch(h.dialogs[0].innerHTML,/<script>|<img>/);assert.match(h.dialogs[0].innerHTML,/&lt;script&gt;/);
});
test('cloud discovery calls only comment-scoped RPCs, never profiles or an arbitrary target UUID endpoint',async()=>{
 const calls=[];const api=createCloud({rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='comment_author_card'?[person]:'request',error:null};}});
 assert.equal((await api.commentAuthor('comment-id')).id,'c');assert.equal(await api.sendCommentRequest('comment-id'),'request');
 assert.deepEqual(calls,[['comment_author_card',{p_comment_id:'comment-id'}],['send_comment_friend_request',{p_comment_id:'comment-id'}]]);
});
test('cloud discovery hides raw database errors and preserves rate-limit feedback',async()=>{
 for(const message of ['permission denied for table profiles','duplicate key leaks private uuid','User unavailable.','Too many friend requests. Try again later.']){
  const api=createCloud({rpc:async()=>({data:null,error:{message,details:'PRIVATE'}})});
  const expected=message==='Too many friend requests. Try again later.'?message:'User unavailable.';
  await assert.rejects(api.commentAuthor('comment'),{message:expected});await assert.rejects(api.sendCommentRequest('comment'),{message:expected});
 }
});

// Demo fixtures exercise the same visibility windows and request states without a live service.
function demoFixture(change=()=>{}){
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 const initial=createDemo();initial.resetDemo();const db=JSON.parse(store.get('azice-demo-v1'));
 db.profiles.push({id:'demo-c',display_name:'C',username:'user_c',bio:'PRIVATE',avatar_path:'PRIVATE_AVATAR'});
 db.comments.push({id:'comment-c',post_id:'sample-1',author_id:'demo-c',author_name:'C',body:'Hello',created_at:new Date().toISOString()});
 change(db);store.set('azice-demo-v1',JSON.stringify(db));return {api:createDemo(),store};
}
test('demo: friend-of-friend comment permits a minimal card, not private avatar or biography',async()=>{
 const {api}=demoFixture();const card=await api.commentAuthor('comment-c');
 assert.deepEqual(Object.keys(card).sort(),['id','display_name','username','avatar_path','relationship','request_id'].sort());
 assert.equal(card.avatar_path,null);assert.equal(card.relationship,'none');
 assert.deepEqual(await api.getHistory('demo-c'),[]);
 const id=await api.sendCommentRequest('comment-c');assert.equal(await api.sendCommentRequest('comment-c'),id);
 assert.equal((await api.friendData()).outgoing.length,1);assert.equal((await api.commentAuthor('comment-c')).relationship,'outgoing');
});
for(const [label,change] of [
 ['removed post-owner friendship',db=>{db.friends=[];}],
 ['expired friend post',db=>{db.posts[0].published_at=new Date(Date.now()-31*86400000).toISOString();}],
 ['unpublished post',db=>{db.posts[0].status='draft';}],
 ['deleted comment',db=>{db.comments=db.comments.filter(c=>c.id!=='comment-c');}],
 ['deleted post',db=>{db.posts=db.posts.filter(p=>p.id!=='sample-1');}],
 ['unauthenticated user',db=>{db.user=null;}]
])test(`demo: ${label} denies card and request with identical non-leaking errors`,async()=>{
 const {api}=demoFixture(change);await assert.rejects(api.commentAuthor('comment-c'),{message:'User unavailable.'});await assert.rejects(api.sendCommentRequest('comment-c'),{message:'User unavailable.'});
});
test('demo: arbitrary target UUID cannot substitute for a qualifying comment ID',async()=>{
 const {api}=demoFixture();await assert.rejects(api.commentAuthor('demo-c'),{message:'User unavailable.'});await assert.rejects(api.sendCommentRequest('demo-c'),{message:'User unavailable.'});
});
test('demo: opposite-direction pending request is never duplicated and can be accepted',async()=>{
 const {api}=demoFixture(db=>db.requests.push({id:'incoming-c',sender_id:'demo-c',receiver_id:'demo-me',status:'pending',created_at:new Date().toISOString()}));
 assert.equal((await api.commentAuthor('comment-c')).relationship,'incoming');
 await assert.rejects(api.sendCommentRequest('comment-c'),{message:'A request is already pending'});
 await api.requestAction('incoming-c','accept');assert.equal((await api.commentAuthor('comment-c')).relationship,'friends');
 await assert.rejects(api.sendCommentRequest('comment-c'),{message:'Already friends'});
});
test('demo: own comment does not allow self-requests',async()=>{
 const {api}=demoFixture(db=>{db.comments.find(c=>c.id==='comment-c').author_id='demo-me';});
 assert.equal((await api.commentAuthor('comment-c')).relationship,'self');await assert.rejects(api.sendCommentRequest('comment-c'),{message:'You cannot add yourself'});
});
test('demo: the existing aggregate hourly quota applies to comment requests',async()=>{
 const {api}=demoFixture(db=>{for(let i=0;i<30;i++)db.requests.push({id:`quota-${i}`,sender_id:'demo-me',receiver_id:'demo-alex',status:'declined',created_at:new Date().toISOString()});});
 await assert.rejects(api.sendCommentRequest('comment-c'),{message:'Too many friend requests. Try again later.'});
});

const migration=fs.readFileSync(new URL('../supabase/migrations/20261023012201_comment_author_discovery.sql',import.meta.url),'utf8');
test('migration audit: private UUID helper and new projection endpoints have explicit grants',()=>{
 assert.match(migration,/create schema azice_private;/);
 assert.doesNotMatch(migration,/create schema if not exists/);
 assert.match(migration,/revoke all on schema azice_private from public, anon, authenticated/);
 assert.match(migration,/revoke all on function azice_private\.create_friend_request\(uuid,uuid\) from public, anon, authenticated/);
 for(const name of ['comment_author_card','send_comment_friend_request','pending_friend_request_profiles'])assert.ok(migration.includes('grant execute on function public.'+name));
 assert.match(migration,/aclexplode/);assert.match(migration,/a\.grantee<>entry\.proowner/);
});
test('migration audit: full profiles and avatars exclude pending-only users', () => {
  const helper = migration.match(/create or replace function public\.can_view_profile\(p_profile uuid\)[\s\S]*?(?=\n-- An extra restrictive RLS guard)/i)?.[0] || '';

  assert.match(helper, /security definer/i);
  assert.match(helper, /p_profile\s*=\s*auth\.uid\(\)/i);
  assert.match(helper, /public\.are_friends\(p_profile,\s*auth\.uid\(\)\)/i);
  assert.doesNotMatch(helper, /friend_requests|pending/i);

  assert.match(migration, /create policy profiles_confirmed_read_guard on public\.profiles as restrictive/i);
  assert.match(migration, /policyname='avatar_select'/i);
  assert.match(migration, /qual like '%can_view_profile%'/i);
  assert.match(migration, /create function public\.pending_friend_request_profiles\(\)/i);

  assert.doesNotMatch(migration, /create\s+policy\s+\w+\s+on\s+storage\.objects/i);
  assert.doesNotMatch(migration, /create policy avatars_confirmed_read_guard/i);
});

test('migration audit: invitations and comments share quota and pair duplicate checks',()=>{
 assert.match(migration,/return azice_private\.create_friend_request\(recipient\)/);
 assert.match(migration,/return azice_private\.create_friend_request\(target,p_comment_id\)/);
 assert.match(migration,/created_at>now\(\)-interval '1 hour'\) >= 30/);
 assert.match(migration,/request-sender:/);assert.match(migration,/request-pair:/);
 assert.match(migration,/if pending\.sender_id=caller then return pending\.id/);
});

test('repeated card clicks while a request is in flight send only once',async()=>{
 const h=setup();await h.app.openCommentAuthor('comment-c');
 let resolve;h.api.sendCommentRequest=async id=>{h.calls.push(['send',id]);await new Promise(r=>{resolve=r;});h.setCard({...person,relationship:'outgoing',request_id:'pending'});};
 const first=h.dialogs[0].click('send');await new Promise(r=>setImmediate(r));
 await h.dialogs[0].click('send');resolve();await first;
 assert.equal(h.calls.filter(c=>c[0]==='send').length,1);
 assert.match(h.dialogs[0].innerHTML,/>Request Sent<\/button>/);
});
test('access revoked between card lookup and send is denied by the RPC without exposing raw errors',async()=>{
 const h=setup();await h.app.openCommentAuthor('comment-c');
 h.api.sendCommentRequest=async()=>{throw Error('User unavailable.');};
 await h.dialogs[0].click('send');assert.equal(h.dialogs[0].isConnected,false);assert.equal(h.toast.textContent,'User unavailable.');
});
test('migration audit: hardened paths, matching owner and locked authorization before insertion', () => {
  const helper = migration.match(/create or replace function public\.can_view_profile\(p_profile uuid\)[\s\S]*?(?=\n-- An extra restrictive RLS guard)/i)?.[0] || '';

  assert.match(helper, /security definer set search_path\s*=\s*public,\s*pg_temp/i);
  assert.match(helper, /public\.are_friends\(/i);
  assert.match(helper, /auth\.uid\(\)/i);

  assert.match(migration, /public\.can_view_profile\(uuid\)'::regprocedure\) <> owner_id/i);

  assert.match(
    migration,
    /create function azice_private\.create_friend_request\([\s\S]*?security invoker set search_path\s*=\s*''/i
  );

  for (const fn of [
    'send_friend_request',
    'comment_author_card',
    'send_comment_friend_request',
    'pending_friend_request_profiles'
  ]) {
    const pattern = new RegExp(
      '(?:create|create or replace) function public\\.' +
      fn +
      '\\([\\s\\S]*?security definer set search_path\\s*=\\s*\x27\x27',
      'i'
    );

    assert.match(migration, pattern, fn + ' must use empty search_path');
  }

  assert.match(migration, /visible_comment from public\.comments c where c\.id=p_comment_id for share;/i);
  assert.match(migration, /visible_post from public\.posts p where p\.id=visible_comment\.post_id for share;/i);
  assert.match(migration, /public\.friendships f[\s\S]*?for share;/i);
  assert.match(migration, /not public\.can_view_post\(visible_post\.id\)/i);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(migration, /return azice_private\.create_friend_request\(recipient\)/i);
});

test('demo: a readable archived comment remains discoverable after interactions close',async()=>{
 const {api}=demoFixture(db=>{db.posts[0].published_at=new Date(Date.now()-3*86400000).toISOString();});
 assert.equal((await api.commentAuthor('comment-c')).id,'demo-c');
 await assert.rejects(api.comment('sample-1','Too late'),/Comments are closed/);
 assert.ok(await api.sendCommentRequest('comment-c'));
});
test('demo: own published history has no friend-history cutoff for discovery',async()=>{
 const {api}=demoFixture(db=>{db.posts[0].author_id='demo-me';db.posts[0].published_at=new Date(Date.now()-31*86400000).toISOString();});
 assert.equal((await api.commentAuthor('comment-c')).relationship,'none');assert.ok(await api.sendCommentRequest('comment-c'));
});

test('closing the card during Accept still refreshes the same account pending-request indicator',async()=>{
 const h=setup({...person,relationship:'incoming',request_id:'incoming'});
 let resolve,refreshes=0;
 h.api.requestAction=async()=>{await new Promise(r=>{resolve=r;});};
 h.api.friendData=async()=>{refreshes++;return {friends:[{id:'c'}],incoming:[],outgoing:[]};};
 await h.app.openCommentAuthor('comment-c');const pending=h.dialogs[0].click('accept');
 await new Promise(r=>setImmediate(r));await h.dialogs[0].click('close');resolve();await pending;
 assert.equal(refreshes,1);assert.equal(h.app.state.friends.incoming.length,0);assert.equal(h.dialogs[0].isConnected,false);
});

test('cloud pending lists use a narrow identity RPC, never direct pending-user profile reads',async()=>{
 const filters=[],rpcCalls=[];
 const requests=[{id:'in',sender_id:'c',receiver_id:'a',status:'pending'},{id:'out',sender_id:'a',receiver_id:'d',status:'pending'}];
 const client={auth:{getUser:async()=>({data:{user:{id:'a'}},error:null})},
  from:table=>{
   const q={select:()=>q,or:()=>q,eq:()=>q,in:(column,ids)=>{filters.push([table,column,ids]);return q;},
    then:(resolve,reject)=>Promise.resolve({data:table==='friendships'?[{user_a:'a',user_b:'b'}]:table==='friend_requests'?requests:[{id:'b',display_name:'Friend B',username:'b',bio:'Confirmed friend bio',avatar_path:'b/avatar.jpg'}],error:null}).then(resolve,reject)};return q;
  },rpc:async name=>{rpcCalls.push(name);return {data:[{id:'c',display_name:'C',username:'c',avatar_path:null},{id:'d',display_name:'D',username:'d',avatar_path:null}],error:null};}
 };
 const data=await createCloud(client).friendData();
 assert.deepEqual(filters,[['profiles','id',['b']]]);assert.deepEqual(rpcCalls,['pending_friend_request_profiles']);
 assert.equal(data.incoming[0].profile.display_name,'C');assert.equal(data.outgoing[0].profile.display_name,'D');
 assert.equal(data.incoming[0].profile.bio,undefined);assert.equal(data.outgoing[0].profile.avatar_path,null);
 assert.equal(data.friends[0].bio,'Confirmed friend bio');
});
test('cloud friend refresh does not request pending identities when no requests exist',async()=>{
 let called=false;
 const client={auth:{getUser:async()=>({data:{user:{id:'a'}},error:null})},
  from:()=>{const q={select:()=>q,or:()=>q,eq:()=>q,then:(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject)};return q;},
  rpc:async()=>{called=true;throw Error('Should not run');}};
 const data=await createCloud(client).friendData();assert.equal(called,false);assert.deepEqual(data,{friends:[],incoming:[],outgoing:[]});
});
test('demo pending outgoing identity and comment card never expose bio or avatar',async()=>{
 const {api}=demoFixture();await api.sendCommentRequest('comment-c');
 const p=(await api.friendData()).outgoing[0].profile;
 assert.deepEqual(Object.keys(p).sort(),['id','display_name','username','avatar_path'].sort());
 assert.equal(p.avatar_path,null);assert.equal((await api.commentAuthor('comment-c')).avatar_path,null);
});
test('demo pending incoming identity remains minimal until acceptance',async()=>{
 const {api}=demoFixture(db=>db.requests.push({id:'incoming-c',sender_id:'demo-c',receiver_id:'demo-me',status:'pending'}));
 const p=(await api.friendData()).incoming[0].profile;assert.equal(p.bio,undefined);assert.equal(p.avatar_path,null);
 assert.equal((await api.commentAuthor('comment-c')).avatar_path,null);
 await api.requestAction('incoming-c','accept');assert.equal((await api.commentAuthor('comment-c')).avatar_path,'PRIVATE_AVATAR');
});
