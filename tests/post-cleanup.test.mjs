import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloud} from '../cloud.js';

const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002';
const photo=()=>new Blob(['jpeg'],{type:'image/jpeg'});
function setup(){
 const posts=new Map(),metadata=new Map(),objects=new Set(),values=new Map(),calls=[];
 const store={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const h={user:A,posts,metadata,objects,store,calls,uploadNumber:0,metadataNumber:0,removeError:null,publishError:{code:'P0001',message:'Publish rejected'}};
 const client={auth:{getUser:async()=>({data:{user:{id:h.user}}}),onAuthStateChange(fn){h.authChange=fn;}},from(table){
  let op='select',payload,filters=[];
  const query={insert(v){op='insert';payload=v;return query;},delete(){op='delete';return query;},select(){return query;},eq(k,v){filters.push([k,v]);return query;},maybeSingle(){return query;},then(resolve,reject){return Promise.resolve().then(()=>{
   const id=filters.find(([k])=>k==='id')?.[1];
   if(table==='posts'){
    if(op==='insert'){calls.push('draft');posts.set(payload.id,{...payload});return {data:null};}
    if(op==='delete'){calls.push('delete');if(h.deleteError)return {error:h.deleteError};posts.delete(id);metadata.delete(id);return {data:[{id}]};}
    const row=posts.get(id);return {data:row&&row.author_id===h.user?{...row,post_photos:metadata.get(id)||[]}:null};
   }
   if(table==='post_photos'&&op==='insert'){
    calls.push('metadata');h.metadataNumber++;if(h.metadataFailure===h.metadataNumber)return {error:{code:'42501',message:'Metadata rejected'}};
    const rows=metadata.get(payload.post_id)||[];rows.push(payload);metadata.set(payload.post_id,rows);return {data:null};
   }
   return {data:null};
  }).then(resolve,reject);}};return query;
 },storage:{from(){return {
  async upload(path){calls.push('upload');h.uploadNumber++;if(h.onUpload)await h.onUpload(path);
   if(h.uploadFailure===h.uploadNumber)return {error:{message:'Upload rejected',status:400}};
   objects.add(path);return {data:{path}};
  },async list(prefix){calls.push('list');if(h.listError)return {error:h.listError};return {data:[...objects].filter(p=>p.startsWith(prefix+'/')).map(p=>({name:p.slice(prefix.length+1)}))};},
  async remove(paths){calls.push('remove');if(h.removeThrow)throw Error('Remove connection lost');if(h.removeError)return {error:h.removeError};
   const removed=paths.slice(0,h.partialRemove??paths.length);for(const p of removed)objects.delete(p);return {data:removed.map(name=>({name}))};
  }
 };}},async rpc(name,{p_post_id}){assert.equal(name,'publish_post');calls.push('publish');if(h.publishCommitThenFail){posts.get(p_post_id).status='published';return {error:{message:'Failed to fetch'}};}if(h.publishError)return {error:h.publishError};posts.get(p_post_id).status='published';return {data:null};}};
 h.api=()=>createCloud(client,{postCleanupStorage:store});return h;
}

test('failed remove response keeps draft and metadata instead of orphaning uploaded objects',async()=>{
 const h=setup();h.removeError={message:'Storage unavailable'};
 await assert.rejects(h.api().createPost('drank','Reason',[photo()]),error=>error.cleanupPending===true);
 assert.equal(h.posts.size,1);assert.equal(h.metadata.size,1);assert.equal(h.objects.size,1);assert.ok(!h.calls.includes('delete'));
});

for(const index of [1,2,3])test(`photo ${index} rejection cleans earlier uploads and deletes the draft only after verification`,async()=>{
 const h=setup();h.uploadFailure=index;await assert.rejects(h.api().createPost('drank','Reason',[photo(),photo(),photo()]),e=>e.message==='Upload rejected');
 assert.equal(h.objects.size,0);assert.equal(h.posts.size,0);assert.equal(h.metadata.size,0);assert.equal(h.calls.filter(c=>c==='upload').length,index);
 assert.ok(h.calls.indexOf('metadata')<h.calls.indexOf('upload'));assert.equal(h.calls.at(-1),'delete');
});
for(const index of [1,2,3])test(`metadata ${index} rejection never uploads the unregistered path`,async()=>{
 const h=setup();h.metadataFailure=index;await assert.rejects(h.api().createPost('drank','Reason',[photo(),photo(),photo()]),e=>e.message==='Metadata rejected');
 assert.equal(h.calls.filter(c=>c==='upload').length,index-1);assert.equal(h.objects.size,0);assert.equal(h.posts.size,0);
});
test('thrown removal, partial removal and silent no-op preserve recovery across adapter recreation',async()=>{
 for(const mode of ['throw','partial','noop']){
  const h=setup();if(mode==='throw')h.removeThrow=true;else h.partialRemove=mode==='noop'?0:1;
  await assert.rejects(h.api().createPost('drank','Reason',[photo(),photo()]),e=>e.cleanupPending);
  assert.equal(h.posts.size,1);assert.equal(h.metadata.size,1);assert.ok(h.objects.size>0);
  h.removeThrow=false;h.partialRemove=undefined;
  await h.api().retryPostCleanup();assert.equal(h.objects.size,0);assert.equal(h.posts.size,0);
  assert.deepEqual([...h.store.getItem('azice_post_cleanup_v1:'+A)],['[',']']);
 }
});
test('list or draft deletion errors remain retryable and preserve the original publication error',async()=>{
 for(const mode of ['list','delete']){
  const h=setup();h[mode+'Error']={message:mode+' unavailable'};
  await assert.rejects(h.api().createPost('drank','Reason',[photo()]),e=>e.cleanupPending&&e.originalError===h.publishError);
  assert.equal(h.posts.size,1);h[mode+'Error']=null;await h.api().retryPostCleanup();assert.equal(h.posts.size,0);assert.equal(h.objects.size,0);
 }
});
test('failed cleanup blocks a new attempt until recovery succeeds, without duplicate drafts or publish calls',async()=>{
 const h=setup(),api=h.api();h.removeError={message:'Offline'};
 await assert.rejects(api.createPost('drank','Reason',[photo()]),e=>e.cleanupPending);
 await assert.rejects(api.createPost('drank','Reason',[photo()]),e=>e.cleanupPending);assert.equal(h.posts.size,1);assert.equal(h.calls.filter(c=>c==='publish').length,1);
 h.removeError=null;h.publishError=null;await api.createPost('drank','Reason',[photo()]);assert.equal(h.posts.size,1);assert.equal([...h.posts.values()][0].status,'published');
});
test('missing server metadata cannot make a hidden uploaded object look safely cleaned',async()=>{
 const h=setup(),api=h.api();h.removeError={message:'Offline'};
 await assert.rejects(api.createPost('drank','Reason',[photo()]),e=>e.cleanupPending);
 h.metadata.clear();h.removeError=null;
 await assert.rejects(api.retryPostCleanup(),e=>e.cleanupPending);
 assert.equal(h.objects.size,1);assert.equal(h.posts.size,1);assert.ok(!h.calls.includes('delete'));
});
test('account switching during an upload stops continuation and cannot clean or publish as the new account',async()=>{
 const h=setup(),api=h.api();h.onUpload=async()=>{h.user=B;h.authChange('SIGNED_IN',{user:{id:B}});};
 await assert.rejects(api.createPost('drank','Reason',[photo(),photo()]),e=>e.cleanupPending);
 assert.equal(h.calls.filter(c=>c==='upload').length,1);assert.ok(!h.calls.includes('publish'));assert.ok(!h.calls.includes('remove'));assert.equal(h.posts.size,1);
 await api.retryPostCleanup();assert.equal(h.posts.size,1);
 h.user=A;h.authChange('SIGNED_IN',{user:{id:A}});await api.retryPostCleanup();assert.equal(h.posts.size,0);
});
test('A to B to A auth events invalidate the original attempt even when the user ID matches again',async()=>{
 const h=setup(),api=h.api();h.onUpload=async()=>{h.authChange('SIGNED_IN',{user:{id:B}});h.authChange('SIGNED_IN',{user:{id:A}});};
 await assert.rejects(api.createPost('drank','Reason',[photo()]),e=>e.cleanupPending);assert.ok(!h.calls.includes('publish'));
});
test('ambiguous upload failure retains the draft and metadata even after files are removed',async()=>{
 const h=setup(),api=h.api();h.onUpload=async path=>{h.objects.add(path);throw TypeError('Failed to fetch');};
 await assert.rejects(api.createPost('drank','Reason',[photo()]),e=>e.cleanupPending);
 assert.equal(h.objects.size,0);assert.equal(h.posts.size,1);assert.equal(h.metadata.size,1);
 // Simulate a late server completion after the failed response and first cleanup.
 const path=[...h.metadata.values()][0][0].path;h.objects.add(path);
 const result=await api.retryPostCleanup();assert.equal(result.retained.length,1);assert.equal(h.objects.size,0);assert.equal(h.posts.size,1);
});
test('unknown publish outcome reconciles the existing draft instead of publishing a duplicate',async()=>{
 const h=setup(),api=h.api();h.publishCommitThenFail=true;
 const post=await api.createPost('drank','Reason',[photo()]);assert.equal(h.posts.size,1);assert.equal(h.posts.get(post.id).status,'published');assert.ok(!h.calls.includes('remove'));
 const retry=setup(),retryApi=retry.api();retry.publishError={message:'Failed to fetch'};
 await assert.rejects(retryApi.createPost('drank','Reason',[photo()]),e=>e.cleanupPending);assert.equal(retry.posts.size,1);
 retry.publishError=null;const resumed=await retryApi.createPost('drank','Reason changed',[photo()]);assert.ok(retry.posts.has(resumed.id));assert.equal(retry.calls.filter(c=>c==='draft').length,1);
});
test('normal successful publication and quota rejection preserve the authoritative RPC and cleanup',async()=>{
 const h=setup();h.publishError=null;await h.api().createPost('drank','Reason',[photo(),photo(),photo()]);
 assert.equal(h.objects.size,3);assert.equal(h.posts.size,1);assert.equal(h.calls.at(-1),'publish');assert.ok(!h.calls.includes('delete'));
 const quota=setup();quota.publishError={code:'P0001',message:'DAILY_POST_LIMIT'};
 await assert.rejects(quota.api().createPost('drank','Reason',[photo()]),e=>e===quota.publishError);assert.equal(quota.posts.size,0);assert.equal(quota.objects.size,0);
});
test('overlapping submissions and unavailable persistent journal cannot start extra uploads',async()=>{
 const h=setup(),api=h.api();let release;h.onUpload=()=>new Promise(resolve=>{release=resolve;});const first=api.createPost('drank','Reason',[photo()]);
 while(!release)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(api.createPost('drank','Reason',[photo()]),/already in progress/);release();await assert.rejects(first);
 const blocked=setup();blocked.store.setItem=()=>{throw Error('Storage disabled');};await assert.rejects(blocked.api().createPost('drank','Reason',[photo()]),/Storage disabled/);assert.equal(blocked.posts.size,0);
});

test('Web Lock excludes another adapter/tab before it can inspect or clean a live upload',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis.navigator,'locks');let locked=false;
 Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{async request(_name,_options,task){if(locked)return task(null);locked=true;try{return await task({});}finally{locked=false;}}}});
 try{
  const h=setup(),firstApi=h.api(),secondApi=h.api();let release;h.onUpload=()=>new Promise(resolve=>{release=resolve;});
  const first=firstApi.createPost('drank','Reason',[photo()]);while(!release)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(secondApi.retryPostCleanup(),/another tab/);assert.ok(!h.calls.includes('list'));assert.ok(!h.calls.includes('remove'));
  release();await assert.rejects(first);await secondApi.retryPostCleanup();assert.equal(h.posts.size,0);
 }finally{if(original===undefined)delete globalThis.navigator.locks;else Object.defineProperty(globalThis.navigator,'locks',original);}
});
