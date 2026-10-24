import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCloud} from '../cloud.js';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const entry=(key='comment:one',category='comment')=>({event_key:key,post_id:'post',actor_id:'friend',category,created_at:new Date().toISOString(),read_at:null,actor:{display_name:'A Friend'}});
const post=id=>({id,author_id:'me',author:{display_name:'Me'},kind:'sober',reason:'My post',published_at:new Date().toISOString(),comments:[{id:'comment',author_id:'friend',author_name:'A Friend',body:'Hello',created_at:new Date().toISOString()}],reactions:[],post_photos:[]});
function setup(items=[]){
 const root={},toast={},bell={setAttribute(k,v){this[k]=v;}},events={},marks=[],reads=[];let data=structuredClone(items),user={id:'me'};
 const api={mode:'cloud',getUser:async()=>user,getFeed:async()=>[],friendData:async()=>({friends:[],incoming:[],outgoing:[]}),getActivity:async()=>({items:structuredClone(data),unread:data.some(item=>!item.read_at)}),
  getPost:async id=>{reads.push(id);return post(id);},markActivityRead:async key=>{marks.push(key);data.find(item=>item.event_key===key).read_at=new Date().toISOString();return true;}};
 const context=vm.createContext({URLSearchParams,Map,Set,Date,Intl,console,navigator:{},location:{search:'',pathname:'/',protocol:'https:'},
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:()=>1,clearTimeout(){},
  document:{visibilityState:'visible',querySelector:s=>s==='#app'?root:s==='#toast'?toast:s==='.activity-button'?bell:s==='#activity-title'?{focus(){}}:null,querySelectorAll:()=>[],addEventListener:(type,fn)=>{events[type]=fn;}},
  window:{AZICE_CONFIG:{},scrollTo(){},addEventListener(){}}});
 vm.runInContext(source+'\nglobalThis.app={state,setCurrentUser,refreshActivity,openActivity,openActivityPost,activityView,feedView,home,handleAction,refreshOnReturn,render,setApi:v=>{api=v;}};',context);
 const app=context.app;app.setApi(api);app.setCurrentUser(user);app.state.profile={id:'me',display_name:'Me'};app.state.view='feed';
 return {app,api,context,root,toast,bell,marks,reads,events,setData:items=>{data=structuredClone(items);},setUser:value=>{user=value;}};
}

test('Feed-only native Activity bell has its own unread dot and uses existing two-tab navigation',async()=>{
 const h=setup([entry()]);await h.app.refreshActivity();const markup=h.app.feedView();
 assert.match(markup,/class="activity-button"[^>]*data-action="activity"[^>]*aria-label="Activity, unread/);
 assert.match(markup,/class="activity-dot"/);assert.doesNotMatch(markup,/friend-request-dot/);
 assert.equal((markup.match(/class="nav-item /g)||[]).length,2);assert.match(h.bell.innerHTML,/activity-dot/);
 await h.app.handleAction({dataset:{action:'activity'}});assert.equal(h.app.state.view,'activity');assert.doesNotMatch(h.root.innerHTML,/class="activity-button"/);
 assert.match(h.root.innerHTML,/data-action="feed" aria-label="Back"/);
});

test('all 50 visible events read clears the bell; a new visible event can be opened and cleared',async()=>{
 const visible=Array.from({length:50},(_,i)=>({...entry('read:'+i,i%2?'reaction':'comment'),read_at:new Date().toISOString()}));
 const h=setup(visible);await h.app.refreshActivity();assert.equal(h.app.state.activity.items.length,50);assert.equal(h.app.state.activity.unread,false);assert.doesNotMatch(h.bell.innerHTML,/activity-dot/);
 h.setData([entry('comment:new'),...visible.slice(0,49)]);await h.app.openActivity();assert.equal(h.app.state.activity.unread,true);
 await h.app.openActivityPost('comment:new');assert.equal(h.app.state.activity.unread,false);assert.doesNotMatch(h.bell.innerHTML,/activity-dot/);
});

test('a slower older Activity response cannot erase a newly refreshed unread event',async()=>{
 const h=setup(),resolve=[];h.api.getActivity=()=>new Promise(r=>resolve.push(r));
 const older=h.app.refreshActivity(),newer=h.app.refreshActivity();
 resolve[1]({items:[entry('comment:new')],unread:true});await newer;
 resolve[0]({items:[],unread:false});await older;
 assert.equal(h.app.state.activity.items[0].event_key,'comment:new');assert.equal(h.app.state.activity.unread,true);assert.match(h.bell.innerHTML,/activity-dot/);
});

test('Activity loading, error, retry and empty states do not replace or break Feed',async()=>{
 const h=setup();h.app.render();const feed=h.root.innerHTML;h.api.getActivity=async()=>{throw Error('Offline');};
 await h.app.refreshActivity();assert.equal(h.root.innerHTML,feed);assert.equal(h.app.state.view,'feed');
 await h.app.openActivity();assert.match(h.root.innerHTML,/role="alert"/);assert.match(h.root.innerHTML,/Try Again/);
 let resolve;h.api.getActivity=()=>new Promise(r=>{resolve=r;});const loading=h.app.openActivity();assert.match(h.root.innerHTML,/Loading activity/);
 resolve({items:[],unread:false});await loading;assert.match(h.root.innerHTML,/Your story is just getting started/);assert.match(h.root.innerHTML,/Comments and reactions to your posts/);
});

test('comment activity opens an authorized old post with comments expanded and read-only, then Back returns through Activity to Feed',async()=>{
 const h=setup([entry()]);h.api.getPost=async id=>({...post(id),published_at:new Date(Date.now()-3*86400000).toISOString()});
 await h.app.openActivity();await h.app.handleAction({dataset:{action:'activity-post',id:'comment:one'}});
 assert.equal(h.app.state.view,'post');assert.equal(h.app.state.postReturn,'activity');assert.match(h.root.innerHTML,/class="comments-area"/);
 assert.match(h.root.innerHTML,/Comments are closed after 48 hours/);assert.doesNotMatch(h.root.innerHTML,/class="comment-form"|aria-label="React to post"/);
 assert.match(h.root.innerHTML,/data-action="activity" aria-label="Back"/);assert.deepEqual(h.marks,['comment:one']);assert.equal(h.app.state.activity.unread,false);
 await h.app.handleAction({dataset:{action:'activity'}});assert.equal(h.app.state.view,'activity');assert.doesNotMatch(h.root.innerHTML,/class="activity-row is-unread"/);
 await h.app.handleAction({dataset:{action:'feed'}});assert.equal(h.app.state.view,'feed');assert.doesNotMatch(h.root.innerHTML,/activity-dot/);
});

test('reaction activity opens the existing post; reading one item preserves other unread activity',async()=>{
 const h=setup([entry('reaction:one','reaction'),entry('comment:two')]);await h.app.openActivity();await h.app.openActivityPost('reaction:one');
 assert.deepEqual(h.reads,['post']);assert.equal(h.app.state.view,'post');assert.doesNotMatch(h.root.innerHTML,/class="comments-area"/);
 assert.equal(h.app.state.activity.unread,true);await h.app.openActivity();await h.app.openActivityPost('comment:two');assert.equal(h.app.state.activity.unread,false);
});

test('deleted, inaccessible or non-owned post targets never open or get marked read',async()=>{
 for(const result of [null,{...post('post'),author_id:'someone-else'},Error('Access denied')]){
  const h=setup([entry()]);h.api.getPost=async()=>{if(result instanceof Error)throw result;return result;};
  await h.app.openActivity();await h.app.openActivityPost('comment:one');assert.equal(h.app.state.view,'activity');assert.equal(h.marks.length,0);assert.match(h.toast.textContent,/no longer available/);
 }
});

test('account switching resets activity immediately and discards stale list and post responses',async()=>{
 const h=setup([entry()]);await h.app.refreshActivity();let resolve;
 h.api.getActivity=()=>new Promise(r=>{resolve=r;});const refreshing=h.app.refreshActivity();h.app.setCurrentUser({id:'other'});
 assert.equal(h.app.state.activity.unread,false);assert.equal(h.app.state.activity.items.length,0);resolve({items:[entry()],unread:true});await refreshing;assert.equal(h.app.state.activity.items.length,0);
 const next=setup([entry()]);await next.app.openActivity();next.api.getPost=()=>new Promise(r=>{resolve=r;});const opening=next.app.openActivityPost('comment:one');
 next.app.setCurrentUser({id:'other'});next.app.state.view='loading';resolve(post('post'));await opening;assert.equal(next.app.state.view,'loading');assert.equal(next.marks.length,0);
});

test('return/focus refreshes unread state, and mark-read failure does not block the authorized post',async()=>{
 const h=setup();await h.app.refreshOnReturn();assert.equal(h.app.state.activity.unread,false);h.setData([entry()]);await h.app.refreshOnReturn();assert.equal(h.app.state.activity.unread,true);
 await h.app.openActivity();h.api.markActivityRead=async()=>{throw Error('Offline');};await h.app.openActivityPost('comment:one');
 assert.equal(h.app.state.view,'post');assert.equal(h.app.state.activity.unread,true);assert.match(h.toast.textContent,/could not be marked read/);
});

test('cloud Activity adapter uses recipient-scoped RPCs and only RLS-permitted actor display names',async()=>{
 const calls=[],selects=[];const api=createCloud({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='get_activity'?{items:[entry(),{...entry('reaction:two','reaction'),actor_id:'removed-friend'}],unread:true}:true};},
  from:table=>({select:fields=>{selects.push({table,fields});return {in:async()=>({data:[{id:'friend',display_name:'Visible friend'}]})};}})});
 const result=await api.getActivity();assert.equal(result.items[0].actor.display_name,'Visible friend');assert.equal(result.items[1].actor,null);
 assert.deepEqual(selects,[{table:'profiles',fields:'id,display_name'}]);assert.equal(calls[0].args,undefined);
 await api.markActivityRead('comment:one');assert.deepEqual(calls[1],{name:'mark_activity_read',args:{p_event_key:'comment:one'}});
});

test('a read response finishing after Back refreshes the Activity dot without navigating away',async()=>{
 const h=setup([entry()]);await h.app.openActivity();let finish;
 h.api.markActivityRead=()=>new Promise(resolve=>{finish=()=>{h.setData([{...entry(),read_at:new Date().toISOString()}]);resolve(true);};});
 const opening=h.app.openActivityPost('comment:one');await new Promise(r=>setImmediate(r));assert.equal(h.app.state.view,'post');
 await h.app.openActivity();assert.equal(h.app.state.activity.unread,true);finish();await opening;
 assert.equal(h.app.state.view,'activity');assert.equal(h.app.state.activity.unread,false);
});
