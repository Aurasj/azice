import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCloud} from '../cloud.js';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const value=count=>({count,limit:3,timezone:'Europe/Bucharest',server_now:'2026-10-24T20:59:59Z',reset_at:'2026-10-24T21:00:00Z'});
function setup(count=0){
 const root={innerHTML:''},toast={},counter={},note={},retry={},button={disabled:false},events={},timers=new Map();let seq=0,confirmations=0,publishes=0,status=value(count);
 const document={visibilityState:'visible',querySelector:s=>({'#app':root,'#toast':toast,'#daily-post-count':counter,'#daily-post-limit':note,'#daily-post-retry':retry,'[data-action="post-next"]':button}[s]||null),querySelectorAll:()=>[],addEventListener:(type,fn)=>{events[type]=fn;}};
 const api={mode:'cloud',getDailyPostingStatus:async()=>status,createPost:async()=>{publishes++;status={...status,count:status.count+1};},getUser:async()=>({id:'a'}),getNotificationPreferences:async()=>null,getActivity:async()=>({items:[],unread:false}),friendData:async()=>({friends:[],incoming:[],outgoing:[]})};
 const context=vm.createContext({URLSearchParams,Date,Intl,Map,Set,console:{...console,error(){}},navigator:{},location:{search:'',origin:'https://azice.test',protocol:'https:'},document,sessionStorage:{getItem:()=>null,setItem(){}},window:{AZICE_CONFIG:{},scrollTo(){},addEventListener(){}},setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source+'\nconfirmInApp=async()=>{globalThis.confirmed();return true;};home=async()=>{state.view="feed";render();};globalThis.a={state,setCurrentUser,refreshDailyPosting,newPostView,handleAction,refreshOnReturn,setApi:v=>{api=v;}};',context);
 context.confirmed=()=>{confirmations++;};context.a.setApi(api);context.a.setCurrentUser({id:'a'});context.a.state.profile={id:'a',display_name:'Test'};context.a.state.view='new';context.a.state.draft={kind:'sober',reason:'Valid reason',files:[],step:3};
 return {a:context.a,api,root,toast,counter,note,retry,button,timers,events,document,setStatus:v=>{status=v;},get confirmations(){return confirmations;},get publishes(){return publishes;},publish:()=>context.a.handleAction({dataset:{action:'post-next'},...button,get disabled(){return button.disabled;},set disabled(v){button.disabled=v;}})};
}

for(const n of [0,1,2,3,5])test(`Create Post displays capped usage for ${n} posts and enforces availability`,async()=>{
 const h=setup(n);await h.a.refreshDailyPosting();assert.equal(h.counter.textContent,`${Math.min(3,n)} of 3 today`);assert.equal(h.button.disabled,n>=3);assert.equal(h.note.hidden,n<3);
 assert.match(h.a.newPostView(),new RegExp(`${Math.min(3,n)} of 3 today`));assert.match(h.a.newPostView(),/Come back tomorrow!/);
});

test('server-aligned midnight timer refreshes the cap without client-clock assumptions; return refreshes again',async()=>{
 const h=setup(3);await h.a.refreshDailyPosting();const timer=[...h.timers.values()].find(t=>t.ms===1100);assert.ok(timer);
 h.setStatus({...value(0),server_now:'2026-10-24T21:00:00Z',reset_at:'2026-10-25T22:00:00Z'});timer.fn();await new Promise(r=>setImmediate(r));
 assert.equal(h.counter.textContent,'0 of 3 today');assert.equal(h.button.disabled,false);
 h.setStatus(value(2));await h.a.refreshOnReturn();assert.equal(h.counter.textContent,'2 of 3 today');
});

test('publish refreshes before uploads, prevents rapid duplicates and refreshes after success',async()=>{
 const h=setup(2);await h.a.refreshDailyPosting();let resolve;h.api.createPost=()=>new Promise(r=>{resolve=r;});
 const first=h.publish();await new Promise(r=>setImmediate(r));assert.equal(h.confirmations,1);await h.publish();assert.equal(h.confirmations,1);
 h.setStatus(value(3));resolve();await first;assert.equal(h.a.state.dailyPosting.count,3);assert.equal(h.a.state.view,'feed');assert.equal(h.toast.textContent,'Post published!');
 const capped=setup(2);await capped.a.refreshDailyPosting();capped.setStatus(value(3));await capped.publish();assert.equal(capped.publishes,0);assert.equal(capped.confirmations,0);assert.match(capped.toast.textContent,/today's limit/);
});

test('backend race errors retain the draft and show the daily-limit message; failed status can retry',async()=>{
 const h=setup(2);await h.a.refreshDailyPosting();const file={};h.a.state.draft.files=[file];
 h.api.createPost=async()=>{h.setStatus(value(3));throw {code:'P0001',message:'DAILY_POST_LIMIT'};};await h.publish();
 assert.match(h.toast.textContent,/You've reached today's limit/);assert.equal(h.a.state.draft.files[0],file);assert.equal(h.a.state.draft.reason,'Valid reason');assert.equal(h.button.disabled,true);
 const serialized=setup(2);await serialized.a.refreshDailyPosting();serialized.api.createPost=async()=>{serialized.setStatus(value(3));throw {code:'40001',message:'Serialization failure'};};await serialized.publish();assert.match(serialized.toast.textContent,/today's limit/);
 h.api.getDailyPostingStatus=async()=>{throw Error('Offline');};await h.a.refreshDailyPosting();assert.equal(h.retry.hidden,false);assert.equal(h.button.disabled,true);
 h.api.getDailyPostingStatus=async()=>value(0);await h.a.handleAction({dataset:{action:'retry-post-count'}});assert.equal(h.button.disabled,false);assert.equal(h.retry.hidden,true);
});

test('logout/account switching clears counts, timers and stale responses',async()=>{
 const h=setup(2);await h.a.refreshDailyPosting();let resolve;h.api.getDailyPostingStatus=()=>new Promise(r=>{resolve=r;});const pending=h.a.refreshDailyPosting();
 h.a.setCurrentUser({id:'b'});resolve(value(3));await pending;assert.equal(h.a.state.dailyPosting,null);assert.equal(h.timers.size,0);
});

test('counter adapter accepts no author ID',async()=>{
 const calls=[];const api=createCloud({rpc:async(name,args)=>{calls.push({name,args});return {data:value(1)};}});assert.equal((await api.getDailyPostingStatus()).count,1);
 assert.equal(calls[0].name,'get_daily_posting_status');assert.deepEqual(Object.keys(calls[0].args),['p_timezone']);
});

test('entering New Post retries failed cleanup even when the daily publishing cap is reached',async()=>{
 const h=setup(3);let retries=0;h.api.retryPostCleanup=async()=>{retries++;return {published:[],retained:[]};};
 await h.a.handleAction({dataset:{action:'start-post'}});
 assert.equal(retries,1);assert.equal(h.a.state.dailyPosting.count,3);assert.equal(h.a.state.view,'new');assert.equal(h.publishes,0);
});

test('late cleanup completion cannot show another account a publication message or refresh its state',async()=>{
 const h=setup();let resolve;h.api.retryPostCleanup=()=>new Promise(r=>{resolve=r;});
 const pending=h.a.handleAction({dataset:{action:'start-post'}});h.a.setCurrentUser({id:'b'});
 resolve({published:[{id:'a-private-post'}],retained:[]});await pending;
 assert.notEqual(h.toast.textContent,'Your previous post was published.');assert.equal(h.a.state.dailyPosting,null);
});

test('cleanup failure reports recovery explicitly while preserving the captured draft and refreshing quota',async()=>{
 const h=setup(2);await h.a.refreshDailyPosting();const file={};h.a.state.draft.files=[file];
 h.api.createPost=async()=>{h.setStatus(value(3));throw Object.assign(Error('Photo cleanup is pending. Reopen New Post to retry before publishing again.'),{cleanupPending:true,code:'P0001'});};
 await h.publish();assert.match(h.toast.textContent,/Photo cleanup is pending/);assert.equal(h.a.state.draft.files[0],file);assert.equal(h.a.state.dailyPosting.count,3);assert.equal(h.a.state.publishing,false);
});
