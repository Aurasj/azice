import {runAppInContext} from './fixtures/app-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCloud} from '../cloud.js';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const profile=id=>({id,display_name:`Private ${id}`,username:`user_${id}`,bio:`Biography ${id}`});
function setup(){
 const root={innerHTML:''},toast={hidden:true},events={},storage=new Map(),bitmaps=[],uploads=[];
 const document={visibilityState:'visible',querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{events[name]=fn;},createElement:type=>{assert.equal(type,'canvas');return {getContext:()=>({fillRect(){},drawImage(){}}),toBlob:callback=>callback(new Blob(['JPEG'],{type:'image/jpeg'}))};}};
 const context=vm.createContext({Blob,URLSearchParams,Intl,Map,Set,Date,console,document,navigator:{},location:{search:'',pathname:'/',origin:'https://azice.test',protocol:'https:'},
  window:{AZICE_CONFIG:{},addEventListener(){},scrollTo(){}},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:()=>1,clearTimeout(){},
  FormData:class{constructor(form){return Object.entries(form.values);}},createImageBitmap:async()=>{const bitmap={width:600,height:400,closed:false,close(){this.closed=true;}};bitmaps.push(bitmap);return bitmap;}});
 runAppInContext(source+'\nglobalThis.app={state,setCurrentUser,render,home,openProfile,openFriendProfile,galleryAvatar,refreshPosts,handleAction,setApi:value=>{api=value;}};',context);
 const app=context.app;let saved=profile('A');
 const api={mode:'cloud',getMyProfile:async()=>saved,getHistory:async()=>[],getFeed:async()=>[],getProfile:async id=>profile(id),getProfiles:async()=>[],getActivity:async()=>({items:[],unread:false}),
  saveProfile:async fields=>(saved={...saved,...fields}),saveAvatar:async(file,owner)=>{uploads.push({file,owner});saved={...saved,avatar_path:'new.jpg'};return 'avatar:new.jpg';}};
 app.setApi(api);
 const switchTo=id=>{app.setCurrentUser(id?{id}:null);if(id){app.state.profile=profile(id);app.state.view='feed';}else app.state.view='auth';app.render();};switchTo('A');
 const submit=(id,fields={})=>events.submit({preventDefault(){},target:{id,dataset:{},values:{display_name:'Updated A',username:'updated_a',bio:'Updated biography',adult:'on',...fields}}});
 return {app,api,context,root,toast,events,storage,bitmaps,uploads,switchTo,submit};
}

test('late own Profile response cannot render account A after switching to B or A to B to A',async()=>{
 for(const returnToA of [false,true]){
  const h=setup(),late=deferred();h.api.getMyProfile=()=>late.promise;const pending=h.app.openProfile();await turn();h.switchTo('B');if(returnToA)h.switchTo('A');const expected=h.app.state.profile;
  late.resolve({...profile('A'),bio:'Stale private information'});await pending;
  assert.equal(h.app.state.profile,expected);assert.equal(h.app.state.view,'feed');assert.doesNotMatch(h.root.innerHTML,/Stale private information/);
 }
});

test('newer own Profile request wins when two responses resolve out of order',async()=>{
 const h=setup(),first=deferred(),second=deferred();let calls=0;h.api.getMyProfile=()=>++calls===1?first.promise:second.promise;
 const old=h.app.openProfile();await turn();const recent=h.app.openProfile();await turn();second.resolve({...profile('A'),display_name:'Newest'});await recent;first.resolve({...profile('A'),display_name:'Old response'});await old;
 assert.equal(h.app.state.profile.display_name,'Newest');assert.match(h.root.innerHTML,/Newest/);assert.doesNotMatch(h.root.innerHTML,/Old response/);
});

test('late friend Profile and history responses cannot cross an account switch',async()=>{
 for(const phase of ['profile','history']){
  const h=setup(),late=deferred();if(phase==='profile')h.api.getProfile=()=>late.promise;else h.api.getHistory=()=>late.promise;
  const pending=h.app.openFriendProfile('friend');await turn();h.switchTo('B');late.resolve(phase==='profile'?profile('friend'):[]);await pending;
  assert.equal(h.app.state.view,'feed');assert.equal(h.app.state.target,null);assert.doesNotMatch(h.root.innerHTML,/Biography friend/);
 }
});

test('Profile loading waits for all data and normal editing preserves its success behavior',async()=>{
 const h=setup();await h.app.openProfile();assert.equal(h.app.state.view,'profile');assert.match(h.root.innerHTML,/Biography A/);
 h.app.state.view='editProfile';await h.submit('edit-profile');assert.equal(h.app.state.profile.display_name,'Updated A');assert.equal(h.app.state.view,'profile');assert.equal(h.toast.textContent,'Profile updated!');
});

test('own history, stale errors and navigation away cannot restore an old Profile screen',async()=>{
 for(const action of ['switch','feed','error']){
  const h=setup(),late=deferred();h.api.getHistory=()=>late.promise;const pending=h.app.openProfile();await turn();
  if(action==='switch')h.switchTo('B');else await h.app.handleAction({dataset:{action:'feed'}});
  const expected=h.app.state.profile,markup=h.root.innerHTML;if(action==='error')late.reject(Error('Old private error'));else late.resolve([]);await pending;
  assert.equal(h.app.state.profile,expected);assert.equal(h.app.state.view,'feed');assert.equal(h.root.innerHTML,markup);
 }
});

test('newer friend Profile wins; leaving for Edit Profile suppresses a pending load',async()=>{
 const h=setup(),old=deferred();h.api.getProfile=id=>id==='old'?old.promise:Promise.resolve(profile(id));
 const pending=h.app.openFriendProfile('old');await h.app.openFriendProfile('new');old.resolve(profile('old'));await pending;assert.equal(h.app.state.target.id,'new');
 const late=deferred();h.api.getMyProfile=()=>late.promise;const own=h.app.openProfile();await turn();await h.app.handleAction({dataset:{action:'edit-profile'}});late.resolve(profile('A'));await own;assert.equal(h.app.state.view,'editProfile');
});

test('late editing and onboarding saves, including failures, cannot affect another account',async()=>{
 for(const id of ['edit-profile','onboard-form'])for(const fails of [false,true]){
  const h=setup(),late=deferred();h.app.state.view=id==='edit-profile'?'editProfile':'onboard';let owner;h.api.saveProfile=(fields,expected)=>{owner=expected;return late.promise;};
  const pending=h.submit(id);await turn();assert.equal(owner,'A');h.switchTo('B');const markup=h.root.innerHTML;
  if(fails)late.reject(Error('Private A save error'));else late.resolve({...profile('A'),bio:'Saved A secret'});await pending;
  assert.equal(h.app.state.profile.id,'B');assert.equal(h.app.state.view,'feed');assert.equal(h.root.innerHTML,markup);assert.equal(h.toast.hidden,true);
 }
});

test('overlapping same-account edits serialize writes and only the newest edit renders',async()=>{
 const h=setup(),old=deferred(),calls=[];let saved=profile('A');h.app.state.view='editProfile';h.api.getMyProfile=async()=>saved;
 h.api.saveProfile=async fields=>{calls.push(fields.display_name);if(calls.length===1)await old.promise;return saved={...saved,...fields};};
 const first=h.submit('edit-profile',{display_name:'Old edit'});await turn();const second=h.submit('edit-profile',{display_name:'Newest edit'});await turn();assert.deepEqual(calls,['Old edit']);
 old.resolve();await Promise.all([first,second]);assert.deepEqual(calls,['Old edit','Newest edit']);assert.equal(saved.display_name,'Newest edit');assert.equal(h.app.state.profile.display_name,'Newest edit');assert.equal(h.app.state.view,'profile');
});

test('avatar decoding cannot start an upload for a different account, and releases its bitmap',async()=>{
 const h=setup(),late=deferred(),bitmap={width:600,height:400,closed:false,close(){this.closed=true;}};h.context.createImageBitmap=()=>late.promise;
 const pending=h.app.galleryAvatar(new Blob(['image'],{type:'image/png'}));h.switchTo('B');late.resolve(bitmap);await pending;
 assert.equal(bitmap.closed,true);assert.equal(h.uploads.length,0);assert.equal(h.app.state.profile.id,'B');assert.equal(h.toast.hidden,true);
});

test('late avatar upload or profile refresh cannot apply to a switched account',async()=>{
 for(const phase of ['upload','profile']){
  const h=setup(),late=deferred();let owner;
  if(phase==='upload')h.api.saveAvatar=(file,expected)=>{owner=expected;return late.promise;};else h.api.getMyProfile=()=>late.promise;
  const pending=h.app.galleryAvatar(new Blob(['image'],{type:'image/png'}));await turn();if(phase==='upload')assert.equal(owner,'A');h.switchTo('B');const markup=h.root.innerHTML;
  late.resolve(phase==='upload'?'avatar:old.jpg':profile('A'));await pending;assert.equal(h.app.state.profile.id,'B');assert.equal(h.app.state.profile.avatar_path,undefined);assert.equal(h.root.innerHTML,markup);assert.equal(h.toast.hidden,true);
 }
});

test('overlapping avatars serialize uploads, and the final Profile load observes the newest avatar',async()=>{
 const h=setup(),firstUpload=deferred(),calls=[];let saved=profile('A');h.app.state.view='editProfile';h.api.getMyProfile=async()=>saved;
 h.api.saveAvatar=async()=>{const n=calls.push('upload');if(n===1)await firstUpload.promise;saved={...saved,avatar_path:`${n}.jpg`};return `avatar:${n}.jpg`;};
 const first=h.app.galleryAvatar(new Blob(['first'],{type:'image/png'}));await turn();const second=h.app.galleryAvatar(new Blob(['second'],{type:'image/png'}));await turn();assert.equal(calls.length,1);firstUpload.resolve();await Promise.all([first,second]);assert.equal(calls.length,2);assert.equal(h.app.state.profile.avatar_path,'avatar:2.jpg');
 await h.app.openProfile();assert.equal(h.app.state.profile.avatar_path,'2.jpg');
});

test('avatar refresh includes an earlier serialized text edit instead of restoring old text',async()=>{
 const h=setup(),late=deferred();let saved=profile('A');h.app.state.view='editProfile';h.api.getMyProfile=async()=>saved;
 h.api.saveProfile=async fields=>{await late.promise;return saved={...saved,...fields};};h.api.saveAvatar=async()=>{saved={...saved,avatar_path:'latest.jpg'};return 'avatar:latest.jpg';};
 const edit=h.submit('edit-profile',{display_name:'Latest text'});await turn();const avatar=h.app.galleryAvatar(new Blob(['image'],{type:'image/png'}));await turn();late.resolve();await Promise.all([edit,avatar]);
 assert.equal(h.app.state.profile.display_name,'Latest text');assert.equal(h.app.state.profile.avatar_path,'avatar:latest.jpg');
});

test('Profile history refresh cannot restore the previous account or navigate after leaving Profile',async()=>{
 for(const leave of ['switch','feed']){
  const h=setup(),late=deferred();h.app.state.view='profile';h.api.getHistory=()=>late.promise;const pending=h.app.refreshPosts();await turn();if(leave==='switch')h.switchTo('B');else await h.app.handleAction({dataset:{action:'feed'}});const markup=h.root.innerHTML;late.resolve([]);await pending;assert.equal(h.app.state.view,'feed');assert.equal(h.root.innerHTML,markup);
 }
});

test('cloud profile/avatar writes reject an unexpected authenticated account before any write',async()=>{
 let writes=0;const client={auth:{getUser:async()=>({data:{user:{id:'B'}}})},from:()=>{writes++;throw Error('Unexpected write');},storage:{from:()=>{writes++;throw Error('Unexpected upload');}}};const api=createCloud(client);
 await assert.rejects(api.saveProfile({display_name:'A'},'A'),/Account changed/);await assert.rejects(api.saveAvatar(new Blob(['image']),'A'),/Account changed/);assert.equal(writes,0);
});

test('an older avatar decode finishing last cannot upload or overwrite the newer selection',async()=>{
 const h=setup(),old=deferred(),bitmap={width:600,height:400,closed:false,close(){this.closed=true;}};let decodes=0;
 h.context.createImageBitmap=()=>++decodes===1?old.promise:Promise.resolve({width:600,height:400,close(){}});
 const first=h.app.galleryAvatar(new Blob(['old'],{type:'image/png'}));await h.app.galleryAvatar(new Blob(['new'],{type:'image/png'}));const expected=h.app.state.profile;
 old.resolve(bitmap);await first;assert.equal(bitmap.closed,true);assert.equal(h.uploads.length,1);assert.equal(h.app.state.profile,expected);
});

test('a newer Profile load waits for a pending avatar write and stale avatar navigation is ignored',async()=>{
 const h=setup(),upload=deferred();let saved=profile('A'),reads=0;h.app.state.view='editProfile';h.api.saveAvatar=async()=>{await upload.promise;saved={...saved,avatar_path:'new.jpg'};return 'avatar:new.jpg';};h.api.getMyProfile=async()=>{reads++;return saved;};
 const avatar=h.app.galleryAvatar(new Blob(['image'],{type:'image/png'}));await turn();const opening=h.app.openProfile();await turn();assert.equal(reads,0);upload.resolve();await Promise.all([avatar,opening]);assert.equal(h.app.state.view,'profile');assert.equal(h.app.state.profile.avatar_path,'new.jpg');assert.equal(h.toast.hidden,true);
});

test('normal onboarding preserves pending invitation navigation; stale preview cannot replace another account',async()=>{
 for(const switchAccount of [false,true]){
  const h=setup(),preview=deferred();h.storage.set('azice_pending_invite','token');h.app.state.view='onboard';h.api.previewInvite=()=>preview.promise;
  const pending=h.submit('onboard-form');await turn();if(switchAccount)h.switchTo('B');preview.resolve({display_name:'Inviter'});await pending;
  assert.equal(h.app.state.view,switchAccount?'feed':'invite');assert.equal(h.app.state.profile.id,switchAccount?'B':'A');
 }
});
