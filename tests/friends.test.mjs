import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCloud } from '../cloud.js';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'')
 .replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const empty=()=>({friends:[],incoming:[],outgoing:[]});
const request=id=>({id,profile:{id:'sender',display_name:'Sender',username:'sender'}});
function setup(){
 const events={document:{},window:{}};
 const root={innerHTML:''},toast={hidden:true},inviteSlot={innerHTML:''},button={innerHTML:'',setAttribute(k,v){this[k]=v;}};
 let focused=false,scroll=null,reads=0,authCallback;
 let data=empty(),user={id:'a'};
 const api={mode:'cloud',getUser:async()=>user,getMyProfile:async()=>({id:user.id,display_name:'Test',username:'test'}),getFeed:async()=>[],
  friendData:async()=>{reads++;return data;},getInvite:async()=>'token',signOut:async()=>{user=null;},
  requestAction:async(id,action)=>{data={...data,incoming:data.incoming.filter(r=>r.id!==id)};},
  onAuthChange:callback=>{authCallback=callback;return {};}};
 const context=vm.createContext({URLSearchParams,console,Map,Set,Date,
  location:{search:'',origin:'http://localhost',protocol:'http:'},navigator:{},
  sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},
  document:{visibilityState:'visible',querySelector:s=>s==='#toast'?toast:s==='#app'?root:s==='#feed-invite'?inviteSlot:s==='.friends-button'?button:s==='#friends-title'?{focus(){focused=true;}}:{},querySelectorAll:()=>[],addEventListener:(e,f)=>{events.document[e]=f;}},
  window:{AZICE_CONFIG:{},scrollTo:(...v)=>{scroll=v;},addEventListener:(e,f)=>{events.window[e]=f;}},
 });
 vm.runInContext(source+'\nglobalThis.app={state,setCurrentUser,refreshFriends,refreshOnReturn,openFriends,feedView,profileView,friendsView,handleAction,boot,render,installEligible,dismissInstall,scheduleInstall,setApi:value=>{api=value;}};',context);
 const app=context.app;app.setApi(api);app.setCurrentUser(user);app.state.profile={display_name:'Test'};app.state.view='feed';
 return {app,api,context,events,root,toast,button,inviteSlot,setData:v=>{data=v;},setUser:v=>{user=v;},get reads(){return reads;},get focused(){return focused;},get scroll(){return scroll;},auth:user=>authCallback(user)};
}

test('install eligibility respects mobile support, standalone, auth flow and persisted cooldown',()=>{
 const h=setup(),store=new Map();h.context.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 h.context.navigator.userAgent='Android Chrome';assert.equal(h.app.installEligible(),false);
 h.app.state.installPrompt={};assert.equal(h.app.installEligible(),true);
 h.context.window.matchMedia=()=>({matches:true});assert.equal(h.app.installEligible(),false);
 h.context.window.matchMedia=()=>({matches:false});h.context.navigator.userAgent='iPhone Safari';h.app.state.installPrompt=null;
 assert.equal(h.app.installEligible(),true);
 for(const view of ['auth','onboard','camera','new']){h.app.state.view=view;assert.equal(h.app.installEligible(),false);}
 h.app.state.view='feed';h.app.dismissInstall();assert.equal(h.app.installEligible(),false);
 assert.ok(Number(store.get('azice_install_remind_after'))>Date.now()+29*86400000);
 const next=setup();next.context.navigator.userAgent='iPhone Safari';next.context.localStorage=h.context.localStorage;
 assert.equal(next.app.installEligible(),false);store.clear();assert.equal(next.app.installEligible(),true);
});

test('install timer defers to open dialogs and Android uses the captured prompt only on action',async()=>{
 const h=setup();h.context.navigator.userAgent='Android Chrome';let prompts=0,fire;
 h.context.setTimeout=fn=>{fire=fn;return 1;};
 h.events.window.beforeinstallprompt({preventDefault(){},prompt:async()=>{prompts++;}});
 assert.equal(prompts,0);await fire(); // Harness reports an open dialog: do not overlay it.
 assert.equal(prompts,0);
 await h.app.handleAction({dataset:{action:'install'}});assert.equal(prompts,1);assert.equal(h.app.state.installPrompt,null);
});

test('friend notifications skip initial requests, deduplicate IDs, and open existing Friends',async()=>{
 const h=setup();h.setData({...empty(),incoming:[request('existing')]});await h.app.refreshFriends();assert.equal(h.toast.hidden,true);
 h.setData({...empty(),incoming:[request('existing'),request('new')]});await h.app.refreshFriends();
 assert.equal(h.toast.hidden,false);assert.match(h.toast.innerHTML,/You have a new friend request!/);
 const account=h.toast.innerHTML.match(/data-account="(\d+)"/)[1];h.toast.hidden=true;
 await h.app.refreshFriends();assert.equal(h.toast.hidden,true);
 h.setData(empty());await h.app.refreshFriends();h.setData({...empty(),incoming:[request('new')]});await h.app.refreshFriends();assert.equal(h.toast.hidden,true);
 await h.app.handleAction({dataset:{action:'friend-toast',account}});assert.equal(h.app.state.view,'friends');
});

test('account switching clears notification baseline and rejects stale toast actions and refreshes',async()=>{
 const h=setup();await h.app.refreshFriends();h.setData({...empty(),incoming:[request('a-request')]});await h.app.refreshFriends();
 const account=h.toast.innerHTML.match(/data-account="(\d+)"/)[1];let resolve;h.api.friendData=()=>new Promise(r=>{resolve=r;});
 const pending=h.app.refreshFriends();h.app.setCurrentUser({id:'b'});assert.equal(h.toast.hidden,true);
 resolve({...empty(),incoming:[request('late-a')]});await pending;assert.equal(h.toast.hidden,true);
 await h.app.handleAction({dataset:{action:'friend-toast',account}});assert.equal(h.app.state.view,'feed');
 h.api.friendData=async()=>({...empty(),incoming:[request('b-existing')]});await h.app.refreshFriends();assert.equal(h.toast.hidden,true);
 h.app.setCurrentUser(null);assert.equal(h.toast.hidden,true);
});

test('Feed header has a labeled native Friends button, users SVG, and unchanged two-tab navigation',()=>{
 const {app}=setup();const markup=app.feedView();
 assert.match(markup,/<header[^>]*>[\s\S]*<button type="button" class="friends-button" data-action="friends" aria-label="Friends & Invites">/);
 assert.match(markup,/<svg aria-hidden="true" focusable="false"/);
 assert.match(markup,/<span>Friends<\/span>/);
 assert.equal((markup.match(/class="nav-item /g)||[]).length,2);
 assert.doesNotMatch(markup,/friend-request-dot/);
});
test('Profile has no duplicate Friends entry and retains navigation to Feed',async()=>{
 const h=setup();h.app.state.view='profile';
 const markup=h.app.profileView();
 assert.doesNotMatch(markup,/data-action="friends"|Friends & Invites/);
 assert.match(markup,/data-action="feed"/);
 assert.match(markup,/My Calendar/);
 assert.match(markup,/Edit Profile/);
 await h.app.handleAction({dataset:{action:'feed'}});
 assert.equal(h.app.state.view,'feed');
 assert.match(h.root.innerHTML,/class="friends-button"/);
});
test('Only incoming requests display a dot and accessible pending label',async()=>{
 const h=setup();h.setData({...empty(),outgoing:[request('out')]});await h.app.refreshFriends();
 assert.doesNotMatch(h.app.feedView(),/friend-request-dot/);
 h.setData({...empty(),incoming:[request('in')]});await h.app.refreshFriends();
 assert.match(h.app.feedView(),/friend-request-dot/);
 assert.match(h.button['aria-label'],/pending incoming/);
});
test('Friends action opens existing interface, puts incoming requests first, scrolls to top and focuses title',async()=>{
 const h=setup();h.setData({...empty(),incoming:[request('in')]});
 await h.app.handleAction({dataset:{action:'friends'}});
 assert.equal(h.app.state.view,'friends');assert.equal(h.app.state.inviteToken,'token');
 assert.ok(h.root.innerHTML.indexOf('Requests Received')<h.root.innerHTML.indexOf('Invite your crew'));
 assert.match(h.root.innerHTML,/data-value="accept"/);assert.match(h.root.innerHTML,/data-value="decline"/);
 assert.equal(h.focused,true);assert.deepEqual(h.scroll,[0,0]);
});
test('Friends Back button returns to Feed',async()=>{
 const h=setup();await h.app.openFriends();
 const backAction=h.root.innerHTML.match(/class="icon-btn" data-action="([^"]+)" aria-label="Back"/)[1];
 assert.equal(backAction,'feed');
 await h.app.handleAction({dataset:{action:backAction}});
 assert.equal(h.app.state.view,'feed');
 assert.match(h.root.innerHTML,/class="friends-button"/);
});
test('friend profile opened from Friends returns to Friends before returning to Feed',async()=>{
 const h=setup();
 h.api.getProfile=async()=>({id:'friend',display_name:'Friend',username:'friend'});
 h.api.getHistory=async()=>[];
 await h.app.openFriends();
 await h.app.handleAction({dataset:{action:'friend-profile',id:'friend'}});
 assert.equal(h.app.state.view,'friendProfile');
 const backAction=h.root.innerHTML.match(/class="icon-btn" data-action="([^"]+)" aria-label="Back"/)[1];
 assert.equal(backAction,'friends');
 await h.app.handleAction({dataset:{action:backAction}});
 assert.equal(h.app.state.view,'friends');
 assert.match(h.root.innerHTML,/class="icon-btn" data-action="feed" aria-label="Back"/);
});
test('Friends keeps invite-first order when there are no incoming requests',()=>{
 const h=setup();const markup=h.app.friendsView();
 assert.ok(markup.indexOf('Invite your crew')<markup.indexOf('Requests Received'));
});
for(const action of ['accept','decline'])test(`${action} updates pending requests and clears dot only after the last request`,async()=>{
 const h=setup();h.setData({...empty(),incoming:[request('one'),request('two')]});await h.app.refreshFriends();
 await h.app.handleAction({dataset:{action:'request',id:'one',value:action}});
 await h.app.handleAction({dataset:{action:'feed'}});
 assert.match(h.app.feedView(),/friend-request-dot/);
 await h.app.handleAction({dataset:{action:'request',id:'two',value:action}});
 await h.app.handleAction({dataset:{action:'feed'}});
 assert.doesNotMatch(h.app.feedView(),/friend-request-dot/);
});
test('boot loads indicator through existing friendData',async()=>{
 const h=setup();h.setData({...empty(),incoming:[request('one')]});await h.app.boot();
 assert.equal(h.reads,1);assert.match(h.root.innerHTML,/friend-request-dot/);
});
test('return events refresh, skip hidden app, and coalesce concurrent events',async()=>{
 const h=setup();h.context.document.visibilityState='hidden';await h.events.document.visibilitychange();assert.equal(h.reads,0);
 h.context.document.visibilityState='visible';h.setData({...empty(),incoming:[request('one')]});
 await Promise.all([h.events.document.visibilitychange(),h.events.window.focus(),h.events.window.pageshow()]);
 assert.equal(h.reads,1);assert.match(h.button.innerHTML,/friend-request-dot/);
 h.setData(empty());await h.events.window.focus();assert.doesNotMatch(h.button.innerHTML,/friend-request-dot/);
});
test('logout clears request state and rejects an in-flight response',async()=>{
 const h=setup();let resolve;h.api.friendData=()=>new Promise(r=>{resolve=r;});
 const pending=h.app.refreshFriends();await h.app.handleAction({dataset:{action:'sign-out'}});
 resolve({...empty(),incoming:[request('old')]});await pending;
 assert.equal(h.app.state.user,null);assert.equal(h.app.state.friends.incoming.length,0);assert.equal(h.app.state.view,'auth');
});
test('account switching resets dot immediately and discards old-account responses, including A to B to A',async()=>{
 const h=setup();h.setData({...empty(),incoming:[request('one')]});await h.app.refreshFriends();
 let resolve;h.api.friendData=()=>new Promise(r=>{resolve=r;});const pending=h.app.refreshFriends();
 h.app.setCurrentUser({id:'b'});assert.doesNotMatch(h.app.feedView(),/friend-request-dot/);
 h.app.setCurrentUser({id:'a'});resolve({...empty(),incoming:[request('old')]});await pending;
 assert.equal(h.app.state.friends.incoming.length,0);
});
test('auth events clear stale state immediately for cross-tab account switch and logout',async()=>{
 const h=setup();await h.app.boot();h.setData({...empty(),incoming:[request('one')]});await h.app.refreshFriends();
 h.auth({id:'b'});assert.equal(h.app.state.friends.incoming.length,0);assert.equal(h.app.state.view,'loading');
 h.auth(null);assert.equal(h.app.state.user,null);assert.equal(h.app.state.view,'auth');
});
test('return detects account switch and loads that account requests',async()=>{
 const h=setup();h.setData({...empty(),incoming:[request('old')]});await h.app.refreshFriends();
 h.setUser({id:'b'});h.setData(empty());await h.app.refreshOnReturn();
 assert.equal(h.app.state.user.id,'b');assert.doesNotMatch(h.root.innerHTML,/friend-request-dot/);
});
test('newer friend refresh wins over an older pending response',async()=>{
 const h=setup();let resolve;h.api.friendData=()=>new Promise(r=>{resolve=r;});const pending=h.app.refreshFriends();
 h.api.friendData=async()=>empty();await h.app.refreshFriends();resolve({...empty(),incoming:[request('old')]});await pending;
 assert.equal(h.app.state.friends.incoming.length,0);
});
test('cloud auth hook forwards session users and logout through existing SDK subscription',()=>{
 let callback;const subscription={unsubscribe(){}};
 const api=createCloud({auth:{onAuthStateChange:fn=>{callback=fn;return {data:{subscription}};}}});
 const users=[];assert.equal(api.onAuthChange(u=>users.push(u)),subscription);
 callback('SIGNED_IN',{user:{id:'a'}});callback('SIGNED_OUT',null);
 assert.deepEqual(users,[{id:'a'},null]);
});

test('account switch while opening Friends cannot restore old invite token or screen',async()=>{
 const h=setup();let resolve;
 h.api.getInvite=()=>new Promise(r=>{resolve=r;});
 const pending=h.app.openFriends();
 // Let the existing friend-data query finish and the invite query start.
 await new Promise(r=>setImmediate(r));
 h.app.setCurrentUser({id:'b'});h.app.state.view='loading';
 resolve('old-account-token');await pending;
 assert.equal(h.app.state.inviteToken,null);assert.equal(h.app.state.view,'loading');
});
test('account switch during boot user lookup cannot restore previous account',async()=>{
 const h=setup();let resolve;
 h.api.getUser=()=>new Promise(r=>{resolve=r;});const pending=h.app.boot();
 h.app.setCurrentUser({id:'b'});resolve({id:'a'});await pending;
 assert.equal(h.app.state.user.id,'b');assert.equal(h.reads,0);
});

for(const sharing of ['copy','share'])test(`invitation ${sharing} preserves complete long URL despite visual truncation`,async()=>{
 const h=setup();const token='long-invite-token-'.repeat(24)+'+/=';
 h.app.state.inviteToken=token;h.app.state.view='friends';
 const url=`http://localhost/?invite=${encodeURIComponent(token)}`;
 const markup=h.app.friendsView();
 assert.ok(markup.includes(`<div class="invite-url">${url}</div>`));
 assert.match(markup,/data-action="share-invite"/);
 assert.match(markup,/data-action="rotate-invite"/);
 let captured;
 if(sharing==='share')h.context.navigator.share=async payload=>{captured=payload.url;};
 else h.context.navigator.clipboard={writeText:async value=>{captured=value;}};
 await h.app.handleAction({dataset:{action:'share-invite'}});
 assert.equal(captured,url);
});

for(const count of [0,1,2,3,5])for(const populated of [false,true])test(`Feed invitation copy with ${count} confirmed friends and ${populated?'populated':'empty'} Feed ignores pending requests`,async()=>{
 const h=setup();
 h.setData({friends:Array.from({length:count},(_,i)=>({id:`friend-${i}`})),incoming:[request('pending-in')],outgoing:[request('pending-out')]});
 await h.app.refreshFriends();
 if(populated)h.app.state.feed=[{id:'post',author_id:'a',published_at:new Date().toISOString(),kind:'sober',reason:'A post'}];
 const markup=h.app.feedView();
 assert.equal(markup.includes('Better with friends'),count===0);
 assert.equal(markup.includes("Invite your friends and see what they're up to."),count===0);
 assert.equal(markup.includes('The more, the merrier!'),count>0);
 assert.equal(markup.includes('Got room for one more friend? Bring them in!'),count>0);
 assert.equal((markup.match(/class="feed-invite-card"/g)||[]).length,1);
 assert.equal((markup.match(/>Invite Friends<\/button>/g)||[]).length,1);
});
for(const count of [0,1,4,25])test(`Feed invitation follows all ${count} posts and precedes bottom navigation`,async()=>{
 const h=setup();await h.app.refreshFriends();
 h.app.state.feed=Array.from({length:count},(_,i)=>({id:`post-${i}`,author_id:'a',published_at:new Date().toISOString(),kind:'sober',reason:`Post ${i}`}));
 const markup=h.app.feedView();const card=markup.indexOf('class="feed-invite-card"');
 assert.ok(card>markup.lastIndexOf('</article>'));
 assert.ok(card<markup.indexOf('<nav class="bottom-nav"'));
 assert.equal((markup.match(/>Invite Friends<\/button>/g)||[]).length,1);
 assert.match(markup,/Invite your friends and see what they're up to\./);
 if(count===0){assert.ok(card>markup.indexOf('class="empty-state"'));assert.doesNotMatch(markup,/Invite Friends ↗/);}
});
test('Feed invitation button reuses the Friends navigation action',async()=>{
 const h=setup();await h.app.refreshFriends();
 const action=h.app.feedView().match(/class="feed-invite-card"[\s\S]*?<button[^>]*data-action="([^"]+)"/)[1];
 assert.equal(action,'friends');await h.app.handleAction({dataset:{action}});
 assert.equal(h.app.state.view,'friends');assert.match(h.root.innerHTML,/Friends &amp; Invites/);
});
test('confirmed friendship count refresh updates the Feed card without replacing Feed or header',async()=>{
 const h=setup();h.app.render();const originalFeed=h.root.innerHTML;
 await h.app.refreshFriends();assert.match(h.inviteSlot.innerHTML,/Better with friends/);
 h.setData({...empty(),friends:[{id:'one'},{id:'two'},{id:'three'}]});await h.app.refreshFriends();
 assert.match(h.inviteSlot.innerHTML,/The more, the merrier!/);assert.equal(h.root.innerHTML,originalFeed);
 h.setData(empty());await h.events.window.focus();
 assert.match(h.inviteSlot.innerHTML,/Better with friends/);assert.equal(h.app.state.view,'feed');
});
test('Feed invitation stays hidden until friend data loads and resets on account switch or logout',async()=>{
 const h=setup();assert.doesNotMatch(h.app.feedView(),/class="feed-invite-card"/);
 await h.app.refreshFriends();assert.match(h.app.feedView(),/Better with friends/);
 h.app.setCurrentUser({id:'b'});assert.doesNotMatch(h.app.feedView(),/class="feed-invite-card"/);
 h.setData({...empty(),friends:[{id:'one'},{id:'two'},{id:'three'}]});await h.app.refreshFriends();
 assert.match(h.app.feedView(),/The more, the merrier!/);
 h.app.setCurrentUser(null);assert.doesNotMatch(h.app.feedView(),/class="feed-invite-card"/);
});

test('invitation remains visible after accepting the third friend and removing a friend',async()=>{
 const h=setup();const two=[{id:'one'},{id:'two'}];
 h.setData({friends:two,incoming:[request('third')],outgoing:[]});await h.app.refreshFriends();
 assert.match(h.app.feedView(),/The more, the merrier!/);
 h.api.requestAction=async()=>h.setData({...empty(),friends:[...two,{id:'third'}]});
 await h.app.handleAction({dataset:{action:'request',id:'third',value:'accept'}});
 await h.app.handleAction({dataset:{action:'feed'}});
 assert.match(h.root.innerHTML,/The more, the merrier!/);
 vm.runInContext('confirmInApp=async()=>true;',h.context);
 h.api.unfriend=async()=>h.setData({...empty(),friends:two});
 await h.app.handleAction({dataset:{action:'unfriend',id:'third'}});
 await h.app.handleAction({dataset:{action:'feed'}});
 assert.match(h.root.innerHTML,/The more, the merrier!/);
});
test('empty Feed preserves its existing message and Create Post action with one invitation CTA',async()=>{
 const h=setup();await h.app.refreshFriends();h.app.render();
 assert.match(h.root.innerHTML,/Pretty quiet in here\.\.\./);
 assert.match(h.root.innerHTML,/The crew hasn't shown up yet\./);
 assert.match(h.root.innerHTML,/>Or be the first to post →<\/button>/);
 assert.equal((h.root.innerHTML.match(/>Invite Friends<\/button>/g)||[]).length,1);
 const action=h.root.innerHTML.match(/class="text-button" data-action="([^"]+)"/)[1];
 assert.equal(action,'start-post');
 await h.app.handleAction({dataset:{action}});
 assert.equal(h.app.state.view,'new');
});
