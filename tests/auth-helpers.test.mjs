import test from 'node:test';
import assert from 'node:assert/strict';
import * as helpers from '../src/auth-helpers.js';
import * as cloud from '../cloud.js';
import * as implementation from '../src/cloud.js';
const {createRecoveryStorage,isSessionMissingOrInvalid}=helpers;

test('native ESM helper surface and cloud compatibility re-exports retain function identity',()=>{
  assert.deepEqual(Object.keys(helpers).sort(),['createRecoveryStorage','isSessionMissingOrInvalid']);
  assert.deepEqual(Object.keys(cloud).sort(),['createCloud','createRecoveryStorage','isSessionMissingOrInvalid']);
  assert.deepEqual(Object.keys(implementation).sort(),Object.keys(cloud).sort());
  for(const name of Object.keys(cloud))assert.equal(cloud[name],implementation[name]);
  assert.equal(cloud.createRecoveryStorage,createRecoveryStorage);
  assert.equal(cloud.isSessionMissingOrInvalid,isSessionMissingOrInvalid);
});

test('session classification retains precedence and exact status/code semantics',()=>{
  for(const value of [null,undefined,false,0,'',{},'Auth session missing'])assert.equal(isSessionMissingOrInvalid(value),false);
  for(const code of ['refresh_token_not_found','invalid_grant','invalid_token','user_not_found','session_not_found']){
    assert.equal(isSessionMissingOrInvalid({code}),true);
    // Existing explicit session signals take precedence over network/server hints.
    assert.equal(isSessionMissingOrInvalid({code,name:'TypeError',status:503,message:'network failure'}),true);
  }
  for(const error of [
    {name:'AuthSessionMissingError',status:503},
    {message:'AUTH SESSION MISSING',name:'AuthRetryableFetchError'},
    {status:400,message:'refresh token expired'},
    {status:401,name:'AuthApiError',message:'Unauthenticated'}
  ])assert.equal(isSessionMissingOrInvalid(Object.freeze(error)),true);
  for(const error of [
    {code:'INVALID_TOKEN'},{code:'unrelated'},
    {status:'401',message:'JWT expired'},{status:403,message:'JWT expired'},
    {status:401,name:'TypeError',message:'JWT expired'},
    {status:401,name:'AuthRetryableFetchError',message:'JWT expired'},
    {status:401,message:'network unavailable'},{status:401,message:'Load failed'},
    {status:500,message:'JWT expired'},{status:401,message:'Invalid API key'},
    {status:401,message:'apikey is required'},{status:401,message:'unrelated failure'}
  ])assert.equal(isSessionMissingOrInvalid(Object.freeze(error)),false);
});

function memory(map=new Map()){
  return {map,getItem(key){return this.map.get(key)??null;},setItem(key,value){this.map.set(key,value);},removeItem(key){this.map.delete(key);}};
}

test('recovery adapter delegates only exact verifier suffixes, preserving receiver, arguments and return values',()=>{
  const calls=[],sentinel={};
  const adapter=name=>Object.fromEntries(['getItem','setItem','removeItem'].map(method=>[method,function(...args){assert.equal(this,stores[name]);calls.push([name,method,...args]);return sentinel;}]));
  const stores={shared:adapter('shared'),tab:adapter('tab')};
  const storage=createRecoveryStorage(stores.shared,stores.tab);
  assert.deepEqual(Object.keys(storage),['getItem','setItem','removeItem']);assert.equal(calls.length,0);
  for(const [key,owner] of [['azice-password-recovery-code-verifier','shared'],['-code-verifier','shared'],['azice-password-recovery','tab'],['code-verifier','tab'],['x-code-verifier-extra','tab'],['x-CODE-VERIFIER','tab']]){
    assert.equal(storage.getItem(key),sentinel);assert.equal(storage.setItem(key,'raw-value'),sentinel);assert.equal(storage.removeItem(key),sentinel);
    assert.deepEqual(calls.splice(0),[[owner,'getItem',key],[owner,'setItem',key,'raw-value'],[owner,'removeItem',key]]);
  }
});

test('recovery sessions remain tab-local and cannot overwrite another account primary session',()=>{
  const primaryKey='sb-primary-auth-token',recoveryKey='azice-password-recovery',verifierKey=recoveryKey+'-code-verifier';
  const shared=memory(new Map([[primaryKey,'account-B-primary']])),tabA=memory(),tabB=memory();
  const a=createRecoveryStorage(shared,tabA),b=createRecoveryStorage(shared,tabB);
  a.setItem(recoveryKey,'account-A-recovery');b.setItem(recoveryKey,'account-C-recovery');
  a.setItem(verifierKey,'verifier-A');assert.equal(b.getItem(verifierKey),'verifier-A');
  // Existing same-key verifier sharing is intentional; this helper adds no account namespace.
  b.setItem(verifierKey,'verifier-C');assert.equal(a.getItem(verifierKey),'verifier-C');
  a.removeItem(recoveryKey);assert.equal(a.getItem(recoveryKey),null);assert.equal(b.getItem(recoveryKey),'account-C-recovery');
  assert.equal(shared.getItem(primaryKey),'account-B-primary');assert.equal(shared.getItem(recoveryKey),null);
  b.removeItem(verifierKey);assert.equal(a.getItem(verifierKey),null);
  assert.equal(shared.getItem(primaryKey),'account-B-primary');
});

test('recovery wrappers retain independent injected stores and perform no eager access',()=>{
  const one=createRecoveryStorage(null,null),two=createRecoveryStorage(memory(),memory());
  assert.notEqual(one,two);assert.throws(()=>one.getItem('session'),TypeError);
  two.setItem('session','other');assert.equal(two.getItem('session'),'other');
  const three=createRecoveryStorage(memory(),memory());assert.equal(three.getItem('session'),null);
  for(const key of [null,undefined,42,{}])assert.throws(()=>two.getItem(key),TypeError);
});

test('storage errors propagate unchanged without fallback, retries or swallowed failures',()=>{
  for(const owner of ['shared','tab'])for(const method of ['getItem','setItem','removeItem']){
    const failure=Error('synthetic storage failure'),calls=[];
    const adapter=name=>Object.fromEntries(['getItem','setItem','removeItem'].map(operation=>[operation,()=>{calls.push([name,operation]);throw failure;}]));
    const storage=createRecoveryStorage(adapter('shared'),adapter('tab'));
    assert.throws(()=>storage[method](owner==='shared'?'key-code-verifier':'key','value'),error=>error===failure);
    assert.deepEqual(calls,[[owner,method]]);
  }
});

test('asynchronous storage return values pass through without wrapping or conversion',async()=>{
  const expected=Promise.resolve({value:'synthetic'}),adapter={getItem:()=>expected,setItem:()=>expected,removeItem:()=>expected};
  const storage=createRecoveryStorage(adapter,adapter);
  for(const key of ['session','key-code-verifier'])for(const method of ['getItem','setItem','removeItem'])assert.equal(storage[method](key,'value'),expected);
  assert.deepEqual(await expected,{value:'synthetic'});
});
