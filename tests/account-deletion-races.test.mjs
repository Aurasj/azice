// Characterization of the actual Edge handler with synthetic Auth/Storage APIs.
// These tests document R03 exposure; they do not execute Auth, Storage or Deno.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const user='aa000000-0000-4000-8000-000000000001';
function fixture(options={}){
 const files=new Map([['post-images',new Set()],['avatars',new Set()]]),calls=[];
 let handler,exists=true,removals=0,lists=0;
 const add=(bucket,path)=>files.get(bucket).add(`${user}/${path}`);
 const admin={storage:{from:bucket=>({
  list:async(prefix,{limit,offset})=>{
   calls.push(['list',bucket,prefix]);lists++;
   if(options.listFailure?.(lists))return {data:null,error:{message:'synthetic list failure'}};
   const entries=new Map();for(const path of files.get(bucket)){
    if(!path.startsWith(prefix+'/'))continue;
    const rest=path.slice(prefix.length+1),name=rest.split('/')[0];
    entries.set(name,{name,id:rest.includes('/')?null:'synthetic-object'});
   }
   const data=[...entries.values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(offset,offset+limit);
   await options.afterList?.({bucket,prefix,data,add,files});return {data,error:null};
  },
  remove:async(paths)=>{
   calls.push(['remove',bucket,[...paths]]);removals++;
   if(options.removeFailure?.(removals)){
    // Model a partial removal even when the API reports failure.
    files.get(bucket).delete(paths[0]);
    if(options.throws)throw Error('synthetic removal exception');
    return {error:{message:'synthetic removal failure'}};
   }
   if(!options.noOpRemoval)for(const path of paths)files.get(bucket).delete(path);
   return {data:paths.map(name=>({name})),error:null};
  }
 })},auth:{admin:{deleteUser:async id=>{
  calls.push(['deleteUser',id]);await options.beforeAuthDelete?.({add,files});
  if(options.authFailure)return {error:{message:'synthetic Auth delete failure'}};
  exists=false;await options.afterAuthDelete?.({add,files});return {error:null};
 }}}};
 const context=vm.createContext({Request,Response,
  Deno:{env:{get:()=> 'synthetic-config'}},serve:fn=>{handler=fn;},
  createClient:(_url,_key,settings)=>settings?{auth:{getUser:async()=>({data:{user:options.invalid?null:{id:user}},error:null})}}:admin
 });
 const source=fs.readFileSync(new URL('../supabase/functions/delete-account/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),context);
 const request=()=>handler(new Request('https://synthetic.invalid/delete-account',{method:'POST',headers:{Authorization:'Bearer synthetic-token'}}));
 return {add,files,calls,request,get exists(){return exists;}};
}

test('deletion: authenticated normal cleanup paginates before mutation and removes all files before Auth',async()=>{
 const h=fixture();for(let n=0;n<205;n++)h.add('post-images',`post/${String(n).padStart(3,'0')}.jpg`);
 h.add('avatars','one.jpg');assert.equal((await h.request()).status,200);assert.equal(h.exists,false);
 assert.ok([...h.files.values()].every(files=>files.size===0));assert.equal(h.calls.at(-1)[0],'deleteUser');
 assert.equal(h.calls.filter(call=>call[0]==='remove'&&call[1]==='post-images').length,3);
 assert.ok(h.calls.filter(call=>call[0]==='remove').every(call=>call[2].length<=100));
});

for(const throws of [false,true])test(`deletion: partial ${throws?'thrown':'returned'} Storage failure preserves Auth and retry removes the remainder`,async()=>{
 let fail=true;const h=fixture({throws,removeFailure:()=>fail});h.add('avatars','one.jpg');h.add('avatars','two.jpg');
 assert.equal((await h.request()).status,500);assert.equal(h.exists,true);assert.equal(h.files.get('avatars').size,1);
 assert.ok(!h.calls.some(call=>call[0]==='deleteUser'));fail=false;
 assert.equal((await h.request()).status,200);assert.equal(h.files.get('avatars').size,0);
});

test('deletion: listing failure and no-op removal fail closed without deleting Auth',async()=>{
 for(const options of [{listFailure:()=>true},{noOpRemoval:true}]){
  const h=fixture(options);h.add('avatars','one.jpg');assert.equal((await h.request()).status,500);
  assert.equal(h.exists,true);assert.ok(!h.calls.some(call=>call[0]==='deleteUser'));
 }
});

test('deletion: upload finishing before final verification is detected and can be retried',async()=>{
 let inject=true;const h=fixture({afterList:({bucket,prefix,add})=>{
  if(inject&&bucket==='avatars'&&prefix===user){inject=false;add('avatars','late.jpg');}
 }});
 assert.equal((await h.request()).status,500);assert.equal(h.exists,true);
 assert.equal((await h.request()).status,200);assert.equal(h.files.get('avatars').size,0);
});

test('R03 reproduction: upload after final snapshot can outlive successful Auth deletion in the handler contract',async()=>{
 for(const hook of ['beforeAuthDelete','afterAuthDelete']){
  const h=fixture({[hook]:({add})=>add('avatars','late.jpg')});
  const response=await h.request();assert.equal(response.status,200);assert.equal(h.exists,false);
  assert.equal(h.files.get('avatars').size,1);assert.equal((await response.json()).success,true);
 }
 // The synthetic Auth adapter intentionally has no ownership guard. This does
 // not assert that a hosted Supabase Auth deletion would accept an owned object.
});

test('deletion: Auth rejection after Storage cleanup leaves account intact and retry is possible',async()=>{
 const options={authFailure:true},h=fixture(options);h.add('avatars','one.jpg');
 assert.equal((await h.request()).status,500);assert.equal(h.exists,true);assert.equal(h.files.get('avatars').size,0);
 options.authFailure=false;assert.equal((await h.request()).status,200);
});

test('deletion: invalid caller never reaches privileged cleanup',async()=>{
 const h=fixture({invalid:true});assert.equal((await h.request()).status,401);assert.equal(h.calls.length,0);
});
