import {runAppInContext} from './fixtures/app-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const post=(id,age=1)=>({id,author_id:'friend',author:{id:'friend',display_name:'Friend'},kind:'sober',reason:`Private ${id}`,published_at:new Date(Date.now()-age*3600000).toISOString(),post_photos:[{path:`friend/${id}/1.jpg`}],comments:[],reactions:[]});
function setup(){
 const root={innerHTML:''},toast={},events={document:{},window:{}},revoked=[],downloads=[],scrolls=[];let user={id:'A'},server=[],reads=0;
 const document={visibilityState:'visible',querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{events.document[name]=fn;}};
 const window={AZICE_CONFIG:{},scrollX:0,scrollY:420,scrollTo:(...args)=>scrolls.push(args),addEventListener:(name,fn)=>{events.window[name]=fn;}};
 const context=vm.createContext({URLSearchParams,Intl,Map,Set,Date,console:{error(){},warn(){}},document,window,navigator:{},location:{search:'',origin:'https://azice.test',protocol:'https:'},sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},URL:{revokeObjectURL:url=>revoked.push(url)}});
 runAppInContext(source+'\nglobalThis.app={state,home,refreshOnReturn,refreshPosts,privatePhotoURL,setCurrentUser,render,handleAction,setApi:value=>{api=value;}};',context);
 const app=context.app,api={mode:'cloud',getUser:async()=>user,getFeed:async()=>{reads++;return server;},getActivity:async()=>({items:[],unread:false}),friendData:async()=>({friends:[],incoming:[],outgoing:[]}),imageUrl:async path=>{downloads.push(path);return `blob:${path}`;}};app.setApi(api);app.setCurrentUser(user);app.state.profile={id:'A',display_name:'Me'};app.state.view='feed';
 const background=()=>{document.visibilityState='hidden';events.document.visibilitychange();};
 const resume=()=>{document.visibilityState='visible';return events.document.visibilitychange();};
 return {app,api,context,document,window,events,root,revoked,downloads,scrolls,background,resume,setServer:value=>{server=value;},get reads(){return reads;},switchTo:id=>{user={id};app.setCurrentUser(user);app.state.profile={id,display_name:id};app.state.view='feed';app.render();}};
}

test('returning from background fetches current Feed and removes expired/revoked posts',async()=>{
 const h=setup();h.app.state.feed=[post('old',49),post('revoked')];h.app.render();h.setServer([post('fresh'),post('expired-response',49)]);
 h.background();await h.resume();assert.equal(h.reads,1);assert.deepEqual(Array.from(h.app.state.feed,p=>p.id),['fresh']);assert.match(h.root.innerHTML,/Private fresh/);assert.doesNotMatch(h.root.innerHTML,/Private old|Private revoked/);
});

test('offline return does not retain cached private Feed as an authorized fallback',async()=>{
 const h=setup();const old=post('secret');h.app.state.feed=[old];h.app.render();await h.app.privatePhotoURL(old.post_photos[0].path);h.api.getFeed=async()=>{throw Error('Offline');};
 h.background();await h.resume();assert.equal(h.app.state.feed.length,0);assert.doesNotMatch(h.root.innerHTML,/Private secret/);assert.match(h.root.innerHTML,/Could not refresh Feed/);assert.equal(h.app.state.cache.size,0);assert.equal(h.revoked.length,1);
});

test('duplicate visibility/focus events coalesce a pending Feed read and do not refetch on ordinary focus',async()=>{
 const h=setup(),late=deferred();let reads=0;h.api.getFeed=()=>{reads++;return late.promise;};h.background();const first=h.resume();await turn();const second=h.app.refreshOnReturn(),third=h.events.window.focus();assert.equal(first,second);assert.equal(second,third);assert.equal(reads,1);
 late.resolve([post('new')]);await first;await h.events.window.focus();assert.equal(reads,1);
});

test('two Feed navigations resolving out of order keep only the latest successful result',async()=>{
 const h=setup(),old=deferred(),recent=deferred();let reads=0;h.api.getFeed=()=>++reads===1?old.promise:recent.promise;
 const first=h.app.home(),second=h.app.home();recent.resolve([post('new')]);await second;old.resolve([post('old')]);await first;assert.deepEqual(Array.from(h.app.state.feed,p=>p.id),['new']);assert.doesNotMatch(h.root.innerHTML,/Private old/);
});

test('an obsolete failing Feed request cannot hide a newer authorized Feed',async()=>{
 const h=setup(),old=deferred();let reads=0;h.api.getFeed=()=>++reads===1?old.promise:Promise.resolve([post('new')]);const first=h.app.home();await h.app.home();old.reject(Error('Old network failure'));await first;assert.equal(h.app.state.feedError,false);assert.equal(h.app.state.feed[0].id,'new');
});

test('switching accounts rejects an old Feed response and allows the new account to load immediately',async()=>{
 const h=setup(),old=deferred();let reads=0;h.api.getFeed=()=>++reads===1?old.promise:Promise.resolve([post('B')]);h.background();const pending=h.resume();await turn();h.switchTo('B');await h.app.home();old.resolve([post('A')]);await pending;
 assert.equal(h.app.state.user.id,'B');assert.equal(h.app.state.feed[0].id,'B');assert.doesNotMatch(h.root.innerHTML,/Private A/);
});

test('a pending old-account identity check cannot block the new account return refresh',async()=>{
 const h=setup(),old=deferred();let users=0;h.api.getUser=()=>++users===1?old.promise:Promise.resolve({id:'B'});h.background();const previous=h.resume();await turn();h.switchTo('B');h.setServer([post('B')]);h.background();await h.resume();assert.equal(h.app.state.feed[0].id,'B');old.resolve({id:'A'});await previous;assert.equal(h.app.state.user.id,'B');
});

test('returning on Profile, Friends or Activity never fetches Feed or redirects navigation',async()=>{
 for(const view of ['profile','friends','activity']){
  const h=setup();h.app.state.view=view;h.app.state.feed=[post('retained')];h.background();await h.resume();assert.equal(h.reads,0);assert.equal(h.app.state.view,view);
 }
});

test('leaving Feed during a return refresh prevents both late data and late errors from replacing Profile',async()=>{
 for(const fails of [false,true]){
  const h=setup(),late=deferred();h.api.getFeed=()=>late.promise;h.api.getMyProfile=async()=>({id:'A',display_name:'Me'});h.api.getHistory=async()=>[];h.background();const returning=h.resume();await turn();await h.app.handleAction({dataset:{action:'profile'}});const markup=h.root.innerHTML;
  if(fails)late.reject(Error('Late error'));else late.resolve([post('stale')]);await returning;assert.equal(h.app.state.view,'profile');assert.equal(h.root.innerHTML,markup);
 }
});

test('failed identity revalidation also hides private Feed and Retry obtains fresh authorized posts',async()=>{
 const h=setup();h.app.state.feed=[post('secret')];h.app.render();h.api.getUser=async()=>{throw Error('Offline');};h.background();await h.resume();assert.equal(h.app.state.feed.length,0);assert.match(h.root.innerHTML,/Could not refresh Feed/);
 h.setServer([post('fresh')]);await h.app.handleAction({dataset:{action:'retry-feed'}});assert.equal(h.app.state.feedError,false);assert.equal(h.app.state.feed[0].id,'fresh');
});

test('a successful empty authorization result evicts removed images and late downloads cannot repopulate cache',async()=>{
 const h=setup(),late=deferred(),old=post('removed');h.app.state.feed=[old];h.api.imageUrl=()=>late.promise;
 const download=h.app.privatePhotoURL(old.post_photos[0].path);h.background();await h.resume();late.resolve('blob:removed');await assert.rejects(download,/Photo unavailable/);assert.equal(h.app.state.cache.size,0);assert.deepEqual(h.revoked,['blob:removed']);assert.equal(h.app.state.feed.length,0);assert.match(h.root.innerHTML,/Pretty quiet/);
});

test('valid unchanged images keep their cached URL and DOM node without download, src reset or scroll jump',async()=>{
 const h=setup(),item=post('kept');h.app.state.feed=[item];h.setServer([structuredClone(item)]);const url=await h.app.privatePhotoURL(item.post_photos[0].path);
 const image={classList:{contains:name=>name==='loaded'}};let replacements=0,children;
 const node={dataset:{post:'kept'},isConnected:true,getBoundingClientRect:()=>({top:80,bottom:400})};
 const slot={querySelectorAll:()=>[node],replaceChildren(...next){replacements++;children=next;}};const find=h.document.querySelector;h.document.querySelector=s=>s==='#feed-posts'?slot:find(s);h.document.querySelectorAll=()=>[image];
 h.background();await h.resume();assert.equal(await h.app.privatePhotoURL(item.post_photos[0].path),url);assert.equal(h.downloads.length,1);assert.equal(h.revoked.length,0);assert.equal(replacements,1);assert.equal(children[0],node);assert.deepEqual(h.scrolls.at(-1),[0,420]);
});

test('normal Feed navigation and reaction/comment refresh use the same guarded loader',async()=>{
 const h=setup();h.setServer([post('one')]);await h.app.home();assert.equal(h.app.state.view,'feed');assert.equal(h.app.state.postReturn,'feed');assert.equal(h.app.state.feed[0].id,'one');
 h.setServer([post('two')]);await h.app.refreshPosts();assert.equal(h.app.state.feed[0].id,'two');assert.equal(h.reads,2);
});

test('back-forward-cache return refreshes Feed through the existing pageshow handler',async()=>{
 const h=setup();h.app.state.feed=[post('old',49)];h.setServer([post('new')]);await h.events.window.pageshow({persisted:true});assert.equal(h.reads,1);assert.equal(h.app.state.feed[0].id,'new');
});

test('changed comments preserve the existing photo carousel, draft text and input focus',async()=>{
 const h=setup(),item=post('same'),updated={...item,comments:[{id:'c',author_id:'friend',body:'New comment'}]};h.app.state.feed=[item];h.setServer([updated]);
 const oldInput={value:'Unsubmitted text',selectionStart:3,selectionEnd:7,isConnected:false},input={isConnected:true,focus(){this.focused=true;},setSelectionRange(...range){this.selection=range;}};
 const carousel={scrollLeft:120};let reused,children;const placeholder={replaceWith(node){reused=node;}};
 const node={dataset:{post:'same'},isConnected:false,getBoundingClientRect:()=>({top:70,bottom:500}),querySelector:s=>s==='input[name="body"]'?oldInput:carousel};
 const fragment={querySelector:s=>s==='input[name="body"]'?input:placeholder};h.document.createElement=()=>({set innerHTML(value){this.markup=value;},content:fragment});h.document.activeElement=oldInput;
 const slot={querySelectorAll:()=>[node],replaceChildren(...next){children=next;}};const find=h.document.querySelector;h.document.querySelector=s=>s==='#feed-posts'?slot:find(s);
 h.background();await h.resume();assert.equal(children[0],fragment);assert.equal(reused,carousel);assert.equal(carousel.scrollLeft,120);assert.equal(input.value,'Unsubmitted text');assert.equal(input.focused,true);assert.deepEqual(input.selection,[3,7]);
});
