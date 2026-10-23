import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCloud } from '../cloud.js';

const FORMAT='Use 3–24 lowercase letters, numbers or underscores.';
const TAKEN='This username is already taken.';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'')
 .replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');

// Exercise the real submit handler and cloud adapter, replacing only the browser and Supabase transport.
function setup(formId,{error=null,username='new_user'}={}){
 const listeners={},queries=[],root={innerHTML:''},toast={textContent:'',hidden:true};
 let profile={id:'user',display_name:'Before',username:'old_user',bio:''};
 const client={
  auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},
  from:table=>{
   const query={table,filters:[]};queries.push(query);
   const q={
    insert:fields=>{query.operation='insert';query.fields=fields;return q;},
    update:fields=>{query.operation='update';query.fields=fields;return q;},
    eq:(key,value)=>{query.filters.push([key,value]);return q;},
    select:()=>q,single:()=>q,maybeSingle:()=>q,
    then:(resolve,reject)=>Promise.resolve().then(()=>{
     if(query.operation){
      if(error)return {data:null,error};
      profile={...profile,...query.fields};
     }
     return {data:profile,error:null};
    }).then(resolve,reject)
   };return q;
  }
 };
 const api=createCloud(client);api.getFeed=async()=>[];api.getHistory=async()=>[];
 const context=vm.createContext({
  console:{error(){},warn(){}},URLSearchParams,Map,Set,Date,
  FormData:class {constructor(form){return Object.entries(form.values);}},
  location:{search:'',origin:'http://localhost',protocol:'http:'},navigator:{},
  sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},
  window:{AZICE_CONFIG:{},addEventListener(){}},
  document:{querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:()=>[],addEventListener:(type,fn)=>{listeners[type]=fn;}}
 });
 vm.runInContext(source+'\nglobalThis.app={state,setCurrentUser,render,setApi:value=>{api=value;}};',context);
 const app=context.app;app.setApi(api);app.setCurrentUser({id:'user'});app.state.profile=profile;app.state.view=formId==='onboard-form'?'onboard':'editProfile';
 const form={id:formId,dataset:{},values:{display_name:' Updated ',username,bio:' Updated bio ',adult:'on'}};
 return {app,api,root,toast,form,listeners,queries,submit:()=>listeners.submit({target:form,preventDefault(){}})};
}

for(const formId of ['onboard-form','edit-profile']){
 test(`${formId}: duplicate username from PostgREST is friendly and leaves the form open`,async()=>{
  const h=setup(formId,{error:{code:'23505',message:'duplicate key value violates unique constraint "profiles_username_key"',details:'Key (username)=(new_user) already exists.'}});
  const previous=h.app.state.profile;await h.submit();
  assert.equal(h.toast.textContent,TAKEN);assert.equal(h.app.state.profile,previous);
  assert.equal(h.app.state.view,formId==='onboard-form'?'onboard':'editProfile');
  assert.equal(h.queries.length,1);assert.equal(h.queries[0].operation,formId==='onboard-form'?'insert':'update');
 });
 test(`${formId}: structured PostgreSQL username constraint is recognized with code 23505`,async()=>{
  const h=setup(formId,{error:{code:'23505',constraint:'profiles_username_key',message:'Unique violation'}});
  await h.submit();assert.equal(h.toast.textContent,TAKEN);
 });
 test(`${formId}: invalid formats receive exact format message without a save request`,async()=>{
  for(const username of ['', 'ab','a'.repeat(25),'MixedCase','has space','bad-name','bad.name','café',' name','name ']){
   const h=setup(formId,{username});await h.submit();
   assert.equal(h.toast.textContent,FORMAT,JSON.stringify(username));assert.equal(h.queries.length,0);
  }
 });
 test(`${formId}: server-side username check violation receives the same format message`,async()=>{
  const h=setup(formId,{error:{code:'23514',message:'new row for relation "profiles" violates check constraint "profiles_username_check"'}});
  await h.submit();assert.equal(h.toast.textContent,FORMAT);
 });
 test(`${formId}: valid usernames save normally, including changing an existing username`,async()=>{
  for(const username of ['abc','name_123','a'.repeat(24),'old_user']){
   const h=setup(formId,{username});await h.submit();
   assert.equal(h.app.state.profile.username,username);
   assert.equal(h.app.state.view,formId==='onboard-form'?'feed':'profile');
   const write=h.queries[0];assert.equal(write.table,'profiles');assert.equal(write.fields.username,username);
   assert.equal(write.fields.display_name,'Updated');
   if(formId==='edit-profile'){
    assert.equal(h.toast.textContent,'Profile updated!');assert.equal(write.fields.bio,'Updated bio');
    assert.deepEqual(write.filters,[['id','user']]);
   }else assert.equal(write.fields.is_18_plus_confirmed,true);
   assert.ok(h.queries.every(q=>q.filters.every(([key])=>key==='id')),'no username availability query');
  }
 });
 test(`${formId}: unrelated errors retain original messages`,async()=>{
  for(const error of [
   {code:'23505',message:'duplicate key value violates unique constraint "profiles_pkey"'},
   {code:'23505',message:'duplicate key value violates unique constraint "profiles_email_key"',details:'Key (username)=(new_user) already exists.'},
   {code:'23505',message:'duplicate key value violates unique constraint "other_profiles_username_key"'},
   {code:'23505',message:'Unique violation without constraint metadata'},
   {code:'23514',message:'new row violates check constraint "profiles_display_name_check"'},
   {code:'42501',message:'new row violates row-level security policy for table "profiles"'},
   {code:'XX000',message:'Error mentioning constraint "profiles_username_key"'},
   {code:'23505',constraint:'profiles_pkey',message:'Error mentioning constraint "profiles_username_key"'},
   {message:'Network unavailable'}
  ]){
   const h=setup(formId,{error});await h.submit();assert.equal(h.toast.textContent,error.message);
  }
 });
 test(`${formId}: native invalid event uses format copy and typing clears it`,()=>{
  const h=setup(formId);h.app.render();assert.match(h.root.innerHTML,/pattern="\[a-z0-9_\]\{3,24\}"/);
  let validity='';const input={name:'username',form:h.form,setCustomValidity:value=>{validity=value;}};
  h.listeners.invalid({target:input});assert.equal(validity,FORMAT);
  h.listeners.input({target:input});assert.equal(validity,'');
  let unrelated=false;
  h.listeners.invalid({target:{name:'email',form:h.form,setCustomValidity:()=>{unrelated=true;}}});
  assert.equal(unrelated,false);
 });
}

test('authentication errors do not receive profile-specific username messages',async()=>{
 const h=setup('auth-form');h.api.signIn=async()=>{throw {code:'23505',message:'duplicate key value violates unique constraint "profiles_username_key"'};};
 h.form.values={email:'test@example.com',password:'password'};await h.submit();
 assert.equal(h.toast.textContent,'duplicate key value violates unique constraint "profiles_username_key"');
});
