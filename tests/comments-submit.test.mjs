import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCloud} from '../cloud.js';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const post=id=>({id,author_id:'A',author:{id:'A',display_name:'Me'},kind:'sober',reason:'My post',published_at:new Date().toISOString(),comments:[],reactions:[],post_photos:[]});
function setup(view='feed'){
 const root={innerHTML:''},toast={hidden:true},events={},forms=[],calls=[],reads=[];let confirms=0,confirmation=async()=>true;
 const document={visibilityState:'visible',querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:s=>s==='form[data-form="comment"]'?forms:[],addEventListener:(name,fn)=>{events[name]=fn;}};
 const context=vm.createContext({URLSearchParams,Intl,Map,Set,WeakMap,Date,console:{error(){},warn(){}},document,navigator:{},location:{search:'',origin:'https://azice.test',protocol:'https:'},window:{AZICE_CONFIG:{},scrollTo(){},addEventListener(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:()=>1,clearTimeout(){},FormData:class{constructor(form){this.body=form.input.value;}get(name){return name==='body'?this.body:null;}}});
 vm.runInContext(source+'\nglobalThis.app={state,setCurrentUser,render,postCard,handleAction,setApi:value=>{api=value;},setConfirm:fn=>{confirmInApp=fn;}};',context);
 const app=context.app,posts=[post('one'),post('two')];
 const api={mode:'cloud',getUser:async()=>({id:app.state.user.id}),getMyProfile:async()=>({id:app.state.user.id,display_name:'Me'}),getHistory:async()=>structuredClone(posts),getFeed:async()=>{reads.push('feed');return structuredClone(posts);},getPost:async id=>{reads.push(id);return structuredClone(posts.find(p=>p.id===id));},getActivity:async()=>({items:[],unread:false}),comment:async(id,body,owner)=>{calls.push({id,body,owner});posts.find(p=>p.id===id).comments.push({id:'c'+calls.length,author_id:'A',author_name:'Me',body,created_at:new Date().toISOString()});}};
 app.setApi(api);app.setConfirm(()=>{confirms++;return confirmation();});
 const activate=(next=view,id='one')=>{app.state.profile={id:app.state.user.id,display_name:'Me'};app.state.view=next;app.state.feed=structuredClone(posts);app.state.history=structuredClone(posts);app.state.target={id:'friend',display_name:'Friend'};app.state.openedPost=structuredClone(posts.find(p=>p.id===id));app.state.activeComments.add(id);};
 app.setCurrentUser({id:'A'});activate();
 const form=(id='one',value='Same comment')=>{
  const input={value,readOnly:false},button={disabled:false,textContent:'➤',setAttribute(k,v){this[k]=v;}};
  const f={id:'',dataset:{form:'comment',post:id},input,button,isConnected:true,setAttribute(k,v){this[k]=v;},querySelector:s=>s.startsWith('input')?input:button};forms.push(f);app.state.activeComments.add(id);
  return {form:f,input,button,submit:()=>events.submit({preventDefault(){},target:f})};
 };
 return {app,api,context,root,toast,forms,posts,calls,reads,form,activate,setConfirmation:fn=>{confirmation=fn;},get confirms(){return confirms;}};
}

for(const trigger of ['rapid Send clicks','repeated keyboard Enter'])test(`${trigger} cannot issue another comment while the first write is pending`,async()=>{
 const h=setup(),f=h.form(),late=deferred();h.api.comment=async(...args)=>{h.calls.push(args);await late.promise;};
 const first=f.submit();await turn();const second=f.submit();await turn();const calls=h.calls.length,confirms=h.confirms;late.resolve();await Promise.all([first,second]);assert.equal(calls,1);assert.equal(confirms,1);
});

test('duplicate submits are also blocked while the confirmation dialog is pending',async()=>{
 const h=setup(),f=h.form(),confirmation=deferred();h.setConfirmation(()=>confirmation.promise);const first=f.submit(),second=f.submit();await turn();assert.equal(h.confirms,1);confirmation.resolve(true);await Promise.all([first,second]);assert.equal(h.calls.length,1);
});

for(const view of ['feed','post','profile','friendProfile','day'])test(`${view}: successful comment clears its draft, refreshes the correct post and permits a later identical comment`,async()=>{
 const h=setup(view),f=h.form();await f.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0].owner,'A');assert.equal(f.input.value,'');assert.equal(f.button.disabled,false);assert.equal(f.input.readOnly,false);assert.equal(h.toast.textContent,'Comment posted.');
 const visible=view==='feed'?h.app.state.feed:view==='post'?[h.app.state.openedPost]:h.app.state.history;assert.equal(visible.find(p=>p.id==='one').comments.length,1);assert.equal(visible.find(p=>p.id==='two')?.comments.length||0,0);
 f.input.value='Same comment';await f.submit();assert.equal(h.calls.length,2);assert.equal(h.posts[0].comments.length,2);assert.equal(h.posts[0].comments[0].body,h.posts[0].comments[1].body);
});

test('only the submitting form is disabled; separate post forms may send independently',async()=>{
 const h=setup(),one=h.form('one'),two=h.form('two'),late=deferred();h.api.comment=async(...args)=>{h.calls.push(args);if(args[0]==='one')await late.promise;};const pending=one.submit();await turn();
 assert.equal(one.button.disabled,true);assert.equal(one.button.textContent,'…');assert.equal(one.button['aria-label'],'Sending comment');assert.equal(one.form['aria-busy'],'true');assert.equal(one.input.readOnly,true);assert.equal(two.button.disabled,false);
 await two.submit();assert.equal(h.calls.length,2);late.resolve();await pending;assert.equal(one.button.disabled,false);
});

test('network failure preserves the submitted draft, unlocks controls and allows retry',async()=>{
 const h=setup(),f=h.form('one','  Keep my draft  ');h.api.comment=async()=>{throw Error('Network unavailable');};await f.submit();assert.equal(f.input.value,'  Keep my draft  ');assert.equal(f.input.readOnly,false);assert.equal(f.button.disabled,false);assert.equal(f.form['aria-busy'],'false');assert.equal(h.toast.textContent,'Network unavailable');
 h.api.comment=async(...args)=>{h.calls.push(args);};await f.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],'Keep my draft');assert.equal(f.input.value,'');
});

test('cancelling confirmation preserves the draft and immediately releases the guard',async()=>{
 const h=setup(),f=h.form();h.setConfirmation(async()=>false);await f.submit();assert.equal(h.calls.length,0);assert.equal(f.input.value,'Same comment');assert.equal(f.button.disabled,false);h.setConfirmation(async()=>true);await f.submit();assert.equal(h.calls.length,1);
});

test('a same-context re-render keeps the guard, readonly draft and disabled Send control',async()=>{
 const h=setup(),old=h.form(),late=deferred();h.api.comment=async(...args)=>{h.calls.push(args);await late.promise;};const pending=old.submit();await turn();old.form.isConnected=false;const replacement=h.form('one','');h.app.render();
 assert.equal(replacement.input.value,'Same comment');assert.equal(replacement.button.disabled,true);assert.match(h.app.postCard(h.app.state.feed[0]),/Sending comment/);await replacement.submit();assert.equal(h.calls.length,1);late.resolve();await pending;assert.equal(replacement.button.disabled,false);assert.equal(replacement.input.value,'');
});

test('old-account success and errors cannot clear another account draft, refresh its post or alter its pending control',async()=>{
 for(const fails of [false,true]){
  const h=setup('post'),old=h.form(),late=deferred(),newWrite=deferred();h.api.comment=async()=>late.promise;const pending=old.submit();await turn();old.form.isConnected=false;h.app.setCurrentUser({id:'B'});h.activate('post');const replacement=h.form('one','B draft');h.api.comment=async()=>newWrite.promise;const next=replacement.submit();await turn();const reads=h.reads.length;
  if(fails)late.reject(Error('Private A error'));else late.resolve();await pending;assert.equal(h.reads.length,reads);assert.equal(replacement.input.value,'B draft');assert.equal(replacement.button.disabled,true);assert.equal(h.toast.hidden,true);newWrite.resolve();await next;assert.equal(replacement.button.disabled,false);
 }
});

test('navigation and switching single-post targets suppress stale responses and errors',async()=>{
 for(const change of ['navigation','post'])for(const fails of [false,true]){
  const h=setup('post'),f=h.form(),late=deferred();h.api.comment=async()=>late.promise;const pending=f.submit();await turn();f.form.isConnected=false;
  if(change==='navigation')await h.app.handleAction({dataset:{action:'profile'}});else h.activate('post','two');
  const expected=h.app.state.openedPost,view=h.app.state.view,markup=h.root.innerHTML,reads=h.reads.length;
  if(fails)late.reject(Error('Stale comment error'));else late.resolve();await pending;assert.equal(h.app.state.view,view);assert.equal(h.app.state.openedPost,expected);assert.equal(h.root.innerHTML,markup);assert.equal(h.reads.length,reads);assert.equal(h.toast.hidden,true);
 }
});

test('late comment-refresh response cannot replace a different single post',async()=>{
 const h=setup('post'),f=h.form(),late=deferred();h.api.getPost=async()=>late.promise;const pending=f.submit();await turn();f.form.isConnected=false;h.activate('post','two');const expected=h.app.state.openedPost;late.resolve({...post('one'),reason:'Late private result'});await pending;assert.equal(h.app.state.openedPost,expected);assert.equal(h.toast.hidden,true);
});

test('expiry during confirmation and backend rejection preserve the draft and unlock Send',async()=>{
 const h=setup('post'),f=h.form(),confirmation=deferred();h.setConfirmation(()=>confirmation.promise);const pending=f.submit();h.app.state.openedPost.published_at=new Date(Date.now()-49*3600000).toISOString();confirmation.resolve(true);await pending;assert.equal(h.calls.length,0);assert.equal(f.input.value,'Same comment');assert.equal(f.button.disabled,false);assert.equal(h.toast.textContent,'Comments are closed after 48 hours.');
 h.app.state.openedPost.published_at=new Date().toISOString();h.setConfirmation(async()=>true);h.api.comment=async()=>{throw {code:'42501',message:'Comment no longer allowed'};};await f.submit();assert.equal(f.button.disabled,false);assert.equal(f.input.value,'Same comment');assert.equal(h.toast.textContent,'Comment no longer allowed');
});

test('confirmed write followed by refresh failure clears the sent draft and reports that only refresh failed',async()=>{
 const h=setup('post'),f=h.form();h.api.getPost=async()=>{throw Error('Read failed');};await f.submit();assert.equal(h.calls.length,1);assert.equal(f.input.value,'');assert.equal(f.button.disabled,false);assert.match(h.toast.textContent,/Comment posted, but comments could not refresh/);
});

test('failed navigation does not leave the original connected comment form permanently disabled',async()=>{
 const h=setup(),f=h.form(),late=deferred();h.api.comment=async()=>late.promise;const pending=f.submit();await turn();h.api.getMyProfile=async()=>{throw Error('Profile offline');};await assert.rejects(h.app.handleAction({dataset:{action:'profile'}}),/Profile offline/);late.reject(Error('Old error'));await pending;assert.equal(f.button.disabled,false);assert.equal(f.input.readOnly,false);assert.equal(f.input.value,'Same comment');assert.equal(h.toast.hidden,true);
});

test('cloud comment adapter binds the initiating account and retains authenticated insert behavior',async()=>{
 let user='B',inserts=[];const api=createCloud({auth:{getUser:async()=>({data:{user:{id:user}}})},from:table=>({insert:async fields=>{inserts.push({table,fields});return {error:null};}})});
 await assert.rejects(api.comment('one','Comment','A'),/Account changed/);assert.equal(inserts.length,0);user='A';await api.comment('one','Comment','A');assert.deepEqual(inserts,[{table:'comments',fields:{post_id:'one',author_id:'A',body:'Comment'}}]);
});

test('account switching during confirmation closes the old confirmation and never sends under the new account',async()=>{
 const h=setup(),f=h.form(),confirmation=deferred();let closed=0;h.setConfirmation(()=>confirmation.promise);const find=h.context.document.querySelector;h.context.document.querySelector=s=>s==='dialog.azice-confirm[open]'?{close(){closed++;confirmation.resolve(false);}}:find(s);
 const pending=f.submit();h.app.setCurrentUser({id:'B'});h.activate();await pending;assert.equal(closed,1);assert.equal(h.calls.length,0);assert.equal(h.toast.hidden,true);
});

test('empty comment submits leave controls and confirmation untouched; length limit remains 300',async()=>{
 const h=setup(),f=h.form('one','   ');await f.submit();assert.equal(h.calls.length,0);assert.equal(h.confirms,0);assert.equal(f.button.disabled,false);assert.match(h.app.postCard(h.app.state.feed[0]),/name="body" maxlength="300" required/);
});
