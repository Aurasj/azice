import test from 'node:test';import assert from 'node:assert/strict';import {createCloud}from '../cloud.js';
function fixture(){let user='A',fail=true,cleanup='returned',referenced=null,remaining=[];const values=new Map(),removed=[],uploads=[];const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};const client={auth:{getUser:async()=>({data:{user:{id:user}}})},from:()=>({update:()=>({eq:async()=>({error:fail?Object.assign(Error('Profile failed'),{code:'23514'}):null})}),select:()=>({eq:()=>({maybeSingle:async()=>({data:{avatar_path:referenced}})})})}),storage:{from:()=>({upload:async p=>{uploads.push(p);return {};},list:async()=>({data:remaining}),remove:async paths=>{removed.push(...paths);if(cleanup==='thrown')throw Error('Remove failed');return cleanup==='returned'?{error:Error('Remove failed')}:{};}})}};return {api:createCloud(client,{postCleanupStorage:storage}),values,removed,uploads,setUser:v=>user=v,setFail:v=>fail=v,setCleanup:v=>cleanup=v,setReference:v=>referenced=v,setRemaining:v=>remaining=v};}
for(const failure of ['returned','thrown'])test('avatar cleanup retains owner journal and retries '+failure,async()=>{const h=fixture();h.setCleanup(failure);await assert.rejects(h.api.saveAvatar(new Blob(),'A'),e=>e.cleanupPending===true);assert(h.values.get('azice_avatar_cleanup_v1:A').includes(h.uploads[0]));h.setUser('B');h.setFail(false);h.setCleanup('ok');await h.api.saveAvatar(new Blob(),'B');assert.equal(h.removed.filter(p=>p.startsWith('A/')).length,1);h.setUser('A');h.setReference(h.uploads[0]);await h.api.saveAvatar(new Blob(),'A');assert.equal(h.removed.filter(p=>p.startsWith('A/')).length,1);assert.equal(h.values.get('azice_avatar_cleanup_v1:A'),'[]');});
test('avatar retry removes only unreferenced owner paths and normal updates succeed',async()=>{const h=fixture();await assert.rejects(h.api.saveAvatar(new Blob(),'A'));h.setCleanup('ok');h.setFail(false);const result=await h.api.saveAvatar(new Blob(),'A');assert(result.startsWith('avatar:A/'));assert.equal(h.removed.length,2);assert.equal(h.values.get('azice_avatar_cleanup_v1:A'),'[]');});

test('avatar upload switching accounts preserves recovery and cannot update the new account',async()=>{let release;const paused=new Promise(r=>release=r); // Exercise owner checks through a deferred upload client.
 let user='A',writes=0;const values=new Map();const api=createCloud({auth:{getUser:async()=>({data:{user:{id:user}}})},storage:{from:()=>({upload:()=>paused,remove:async()=>{assert.fail('Stale account must not remove');}})},from:()=>({update:()=>{writes++;return {eq:async()=>({})};}})},{postCleanupStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 const pending=api.saveAvatar(new Blob(),'A');await new Promise(r=>setImmediate(r));user='B';release({});await assert.rejects(pending,e=>e.cleanupPending);assert.equal(writes,0);assert(values.get('azice_avatar_cleanup_v1:A').includes('A/'));});

test('successful remove response with a still-listed object retains its cleanup reference',async()=>{const h=fixture();h.setCleanup('returned');h.setRemaining([]); // Set exact name after the upload has reserved its UUID.
 const operation=h.api.saveAvatar(new Blob(),'A');await Promise.resolve();await Promise.resolve();await Promise.resolve();
 // Retry a failed removal with an exact remaining filename.
 await assert.rejects(operation);const path=h.uploads[0];h.setCleanup('ok');h.setRemaining([{name:path.split('/')[1]}]);h.setFail(false);await assert.rejects(h.api.saveAvatar(new Blob(),'A'),e=>e.cleanupPending);assert(h.values.get('azice_avatar_cleanup_v1:A').includes(path));});

test('unconfirmed upload retains its path and prevents unsafe automatic removal or repeat upload',async()=>{
 const values=new Map();let uploads=0,removes=0;
 const api=createCloud({auth:{getUser:async()=>({data:{user:{id:'A'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{avatar_path:null}})})})}),storage:{from:()=>({upload:async()=>{uploads++;throw Error('Network outcome unknown');},remove:async()=>{removes++;return {};}})}},{postCleanupStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 await assert.rejects(api.saveAvatar(new Blob(),'A'),e=>e.cleanupPending);await assert.rejects(api.saveAvatar(new Blob(),'A'),e=>e.cleanupPending);
 assert.equal(uploads,1);assert.equal(removes,0);assert.equal(JSON.parse(values.get('azice_avatar_cleanup_v1:A')).length,1);
});


test('lost profile-update response cannot delete a delayed committed avatar or discard uncertainty',async()=>{
 const values=new Map();let path,reference=null,removed=0,reads=0;
 const api=createCloud({auth:{getUser:async()=>({data:{user:{id:'A'}}})},storage:{from:()=>({upload:async p=>{path=p;return {};},remove:async()=>{removed++;return {};},list:async()=>({data:[]})})},from:()=>({update:()=>({eq:async()=>({error:Error('Response lost')})}),select:()=>({eq:()=>({maybeSingle:async()=>{reads++;const snapshot={avatar_path:reference};queueMicrotask(()=>{reference=path;});return {data:snapshot};}})})})},{postCleanupStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 await assert.rejects(api.saveAvatar(new Blob(),'A'));
 assert.equal(removed,0);assert.equal(reads,0);assert(JSON.parse(values.get('azice_avatar_cleanup_v1:A:uncertain')).includes(path));
 reference=path;await assert.rejects(api.saveAvatar(new Blob(),'A'),e=>e.cleanupPending);assert.equal(removed,0);assert.equal(reads,0);assert(JSON.parse(values.get('azice_avatar_cleanup_v1:A')).includes(path));
});
for(const outcome of ['timeout','thrown','unknown-returned'])test('ambiguous profile completion retains recovery across A-B-A: '+outcome,async()=>{
 const values=new Map();let user='A',callback,resolve,path,removes=0;
 const pending=new Promise(r=>resolve=r);const api=createCloud({auth:{getUser:async()=>({data:{user:{id:user}}}),onAuthStateChange:cb=>callback=cb},storage:{from:()=>({upload:async p=>{path=p;return {};},remove:async()=>{removes++;return {};}})},from:()=>({update:()=>({eq:async()=>{await pending;if(outcome==='thrown')throw Error('Network failed');return {error:outcome==='timeout'?{code:'ETIMEDOUT'}:Error('Unknown completion')};}})})},{postCleanupStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 const operation=api.saveAvatar(new Blob(),'A');await new Promise(r=>setImmediate(r));user='B';callback('SIGNED_IN',{user:{id:user}});user='A';callback('SIGNED_IN',{user:{id:user}});resolve();await assert.rejects(operation,e=>e.cleanupPending);
 await assert.rejects(api.saveAvatar(new Blob(),'A'),e=>e.cleanupPending);assert.equal(removes,0);assert(JSON.parse(values.get('azice_avatar_cleanup_v1:A:uncertain')).includes(path));
});
