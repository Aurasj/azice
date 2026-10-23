// Node Web API checks of the actual handlers, with Deno.serve, Supabase and encryption mocked.
// These do not resolve npm:web-push or execute the native Deno/Supabase Edge runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createECDH} from 'node:crypto';
import * as policy from '../supabase/functions/_shared/push-policy.mjs';

const user='aa000000-0000-4000-8000-000000000001',binding='a'.repeat(64),origin='https://azice.test';
const endpoint='https://fcm.googleapis.com/fcm/send/opaque';
const curve=createECDH('prime256v1');curve.generateKeys();
const subscription={endpoint,keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
const encrypted=Buffer.from([99,0,255,128,42,99]).subarray(1,5);
function edge(name,options={}){
 const env={APP_ORIGIN:origin,SUPABASE_URL:'https://project.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',PUSH_DISPATCH_SECRET:'test-dispatch-secret',VAPID_PUBLIC_KEY:'test-public',VAPID_PRIVATE_KEY:'test-private',VAPID_SUBJECT:'mailto:test@example.test',...options.env};
 const calls=[],tokens=[];let handle,claims=0;
 const rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return {data:name==='push_claim'?(claims++===0?options.batch||null:null):name==='push_validate'?options.allowed!==false:true,error:null};};
 const context=vm.createContext({...policy,Request,Response,Uint8Array,atob,crypto,AbortSignal,
  console:{info(){}},Deno:{env:{get:key=>env[key]},serve:fn=>{handle=fn;}},
  createClient:()=>({rpc,auth:{getUser:async token=>{tokens.push(token);return token==='user-jwt'?{data:{user:{id:user}},error:null}:{data:{user:null},error:{message:'Invalid JWT'}};}}}),
  webpush:{generateRequestDetails:(value,body,settings)=>{
   options.onGenerate?.(value,JSON.parse(body),settings);
   return {endpoint:value.endpoint,headers:{TTL:300,'Content-Length':encrypted.length,'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',Authorization:'vapid test'},body:encrypted};
  }},fetch:options.fetch||(()=>{throw Error('Unexpected network request');})
 });
 const source=fs.readFileSync(new URL('../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),context);
 const request=(body={},headers={},method='POST')=>new Request('https://project.supabase.test/functions/v1/'+name,{method,headers:{origin,authorization:name==='push-subscriptions'?'Bearer user-jwt':'Bearer test-dispatch-secret',...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
 return {handle,request,calls,tokens};
}

test('subscription handler authenticates JWT, enforces origin and binds changes to the authenticated owner',async()=>{
 const h=edge('push-subscriptions'),body={action:'subscribe',subscription,binding,p_user:'different-user'};
 for(const [headers,status] of [[{authorization:''},401],[{authorization:'Bearer forged'},401],[{origin:'https://evil.test'},403]]){
  assert.equal((await h.handle(h.request(body,headers))).status,status);assert.equal(h.calls.length,0);
 }
 assert.equal((await h.handle(h.request({}, {},'OPTIONS'))).status,204);
 assert.equal((await h.handle(h.request(body))).status,200);
 assert.deepEqual(h.calls[0],{name:'push_register',args:{p_user:user,p_subscription:subscription,p_binding:binding}});
 assert.ok(h.tokens.includes('user-jwt'));
 assert.equal((await h.handle(h.request({action:'unsubscribe',endpoint,p_user:'different-user'}))).status,200);
 assert.deepEqual(h.calls[1],{name:'push_unregister',args:{p_user:user,p_endpoint:endpoint}});
});

test('subscription handler rejects invalid JSON, oversize bodies, off-policy endpoints and invalid EC points',async()=>{
 const h=edge('push-subscriptions');
 const bodies=['{',' '.repeat(8193),{action:'subscribe',subscription:{...subscription,endpoint:'https://127.0.0.1/private'},binding},
  {action:'subscribe',subscription:{...subscription,keys:{...subscription.keys,p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url')}},binding},
  {action:'unsubscribe',endpoint:'https://fcm.googleapis.com.evil.test/private'}];
 for(const body of bodies)assert.equal((await h.handle(h.request(body))).status,400);
 assert.equal(h.calls.length,0);
});

test('dispatcher requires the scheduler secret and sends binary request bytes with bounded, nonredirecting fetch',async()=>{
 let sends=0,cancelled=0;
 const batch={id:user,token:user,category:'friend_requests',devices:[{id:user,endpoint,keys:subscription.keys,binding}]};
 const h=edge('push-dispatch',{batch,onGenerate:(device,body,settings)=>{
  assert.equal(device.endpoint,endpoint);assert.deepEqual(body,{id:user,category:'friend_requests',binding});
  assert.equal(settings.TTL,300);assert.equal(settings.urgency,'high');assert.equal(settings.topic,user.replaceAll('-',''));
 },fetch:async(url,init)=>{
  sends++;assert.equal(url,endpoint);assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
  const outgoing=new Request(url,init);assert.equal(outgoing.headers.get('content-length'),String(encrypted.length));
  assert.equal(outgoing.headers.get('content-encoding'),'aes128gcm');assert.deepEqual(Buffer.from(await outgoing.arrayBuffer()),encrypted);
  return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:201});
 }});
 for(const [headers,method] of [[{authorization:''},'POST'],[{authorization:'Bearer user-jwt'},'POST'],[{},'GET']])assert.equal((await h.handle(h.request({},headers,method))).status,401);
 assert.equal(h.calls.length,0);
 const result=await h.handle(h.request({recipient:'ignored',body:'ignored'}));assert.equal(result.status,200);
 assert.equal((await result.json()).outcomes.sent,1);assert.equal(sends,1);assert.equal(cancelled,1);
 const noSecret=edge('push-dispatch',{env:{PUSH_DISPATCH_SECRET:''}});assert.equal((await noSecret.handle(noSecret.request())).status,401);
});

test('dispatcher revalidates access and endpoint policy before encryption or fetch; network errors remain retryable',async()=>{
 for(const [options,expected] of [
  [{allowed:false},'skipped'],[{endpoint:'https://fcm.googleapis.com.evil.test/private'},'permanent'],
  [{fetch:async()=>{throw new TypeError('Network or redirect rejected');}},'retry']
 ]){
  const h=edge('push-dispatch',{...options,batch:{id:user,token:user,category:'comments',devices:[{id:user,endpoint:options.endpoint||endpoint,keys:subscription.keys,binding}]}});
  const result=await h.handle(h.request());assert.equal(result.status,200);assert.equal((await result.json()).outcomes[expected],1);
  assert.equal(h.calls.find(c=>c.name==='push_complete').args.p_result,expected);
 }
});
