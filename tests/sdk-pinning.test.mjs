import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createCloud,createRecoveryStorage} from '../cloud.js';

const VERSION='2.118.0';
const root=new URL('../',import.meta.url),read=file=>fs.readFileSync(new URL(file,root),'utf8');
const sdkURL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js';
const refs=source=>source.match(/(?:https:\/\/(?:cdn\.jsdelivr\.net\/npm\/|esm\.sh\/|unpkg\.com\/)|npm:|jsr:)@supabase\/[a-z-]+(?:@[^\s'"`<>;)]+)?/g)||[];
const exact=reference=>/@supabase\/[a-z-]+@\d+\.\d+\.\d+(?:\/[^\s'"`<>]*)?(?:\?[^\s'"`<>]*)?$/.test(reference);

test('browser and all three Edge SDK entry points use the reviewed exact version',()=>{
 const files=['app.js','supabase/functions/delete-account/index.ts','supabase/functions/push-subscriptions/index.ts','supabase/functions/push-dispatch/index.ts'];
 for(const file of files){const imports=refs(read(file));assert.equal(imports.length,1,file);assert.equal(exact(imports[0]),true,file);assert.ok(imports[0].includes('@'+VERSION),file);}
 assert.ok(read('app.js').includes(sdkURL));
});

test('SDK imports and any build/test package dependencies cannot silently become floating',()=>{
 const files=['app.js','cloud.js','demo.js','index.html'];
 const walk=folder=>{for(const entry of fs.readdirSync(new URL(folder,root),{withFileTypes:true})){if(['node_modules','.temp'].includes(entry.name))continue;const path=folder+'/'+entry.name;if(entry.isDirectory())walk(path);else if(/\.(?:[cm]?js|ts|html|json|toml)$/.test(path))files.push(path);}};
 for(const folder of ['scripts','tests','supabase/functions'])walk(folder);
 if(fs.existsSync(new URL('package.json',root)))files.push('package.json');
 for(const file of files){
  const source=read(file);for(const reference of refs(source))assert.equal(exact(reference),true,`${file}: SDK reference must use an exact release`);
  if(file.endsWith('package.json'))for(const kind of ['dependencies','devDependencies','optionalDependencies'])for(const [name,version] of Object.entries(JSON.parse(source)[kind]||{}))if(name.startsWith('@supabase/'))assert.match(version,/^\d+\.\d+\.\d+$/,file);
 }
 for(const value of ['2','latest','^'+VERSION,'~'+VERSION,'2.x'])assert.equal(exact(sdkURL.replace('@'+VERSION,'@'+value)),false);
 assert.equal(exact('https://esm.sh/'+'@supabase/supabase-js'),false);
});

test('existing PWA worker leaves the SDK to HTTP caching and retains network-first app-shell fallback',async()=>{
 const handlers={},cached=[],matches=[];let offline=false;
 const context=vm.createContext({URL,Promise,console,importScripts(){},
  self:{location:{origin:'https://azice.test'},addEventListener:(type,fn)=>{handlers[type]=fn;}},
  fetch:async()=>{if(offline)throw Error('Offline');return new Response('fresh app');},
  caches:{open:async()=>({put:async(request)=>{cached.push(request);}}),match:async request=>{matches.push(request);return new Response('cached app');}}
 });
 vm.runInContext(read('sw.js'),context);
 let externalHandled=false;handlers.fetch({request:new Request(sdkURL),respondWith(){externalHandled=true;}});assert.equal(externalHandled,false);
 let response;const request=new Request('https://azice.test/app.js');handlers.fetch({request,respondWith:value=>{response=value;}});assert.equal(await (await response).text(),'fresh app');assert.equal(cached.length,1);
 offline=true;handlers.fetch({request,respondWith:value=>{response=value;}});assert.equal(await (await response).text(),'cached app');assert.equal(matches.length,1);
});

// Optional real-bundle compatibility tests. No test downloads code or contacts a
// service. Supply a reviewed local artifact as documented in SDK_VERSIONS.md.
const bundlePath=process.env.AZICE_TEST_SUPABASE_UMD;
const bundle=bundlePath?fs.readFileSync(bundlePath,'utf8'):null;
const sdkTest=(name,fn)=>test(name,{skip:!bundle},fn);
const A='aa000000-0000-4000-8000-000000000001',B='bb000000-0000-4000-8000-000000000002';
const memory=map=>({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
const tokenCache=new Map();
const token=id=>{if(!tokenCache.has(id))tokenCache.set(id,Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.c3ludGhldGlj');return tokenCache.get(id);};
function sdk(){
 assert.equal(createHash('sha256').update(bundle).digest('hex'),'bee24fc29228ed5a370f76a2ba1ca3c399549edad2fef23453c80148856a49af','Use the reviewed exact browser artifact');
 const calls=[],shared=new Map(),tab=new Map(),state={removeError:false};
 const user=id=>({id,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}});
 const session=id=>({access_token:token(id),refresh_token:'synthetic-refresh-'+id,expires_in:3600,token_type:'bearer',user:user(id)});
 const transport=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);assert.equal(url.origin,'https://sdk-test.supabase.co','No real service calls allowed');
  const body=request.headers.get('content-type')?.includes('application/json')&&request.method!=='GET'?await request.clone().json():null;
  calls.push({url,request,body});const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/auth/v1/token')return json(session(url.searchParams.get('grant_type')==='pkce'?A:B));
  if(url.pathname==='/auth/v1/signup')return json(session(B));
  if(url.pathname==='/auth/v1/recover')return json({});
  if(url.pathname==='/auth/v1/verify')return json(session(A));
  if(url.pathname==='/auth/v1/logout')return new Response(null,{status:204});
  if(url.pathname==='/auth/v1/user')return json(user(request.headers.get('authorization')==='Bearer '+token(A)?A:B));
  if(url.pathname.startsWith('/auth/v1/admin/users/'))return json(user(B));
  if(url.pathname==='/rest/v1/profiles')return json([{...user(B),display_name:'Synthetic user'}]);
  if(url.pathname.startsWith('/rest/v1/rpc/'))return json({items:[],unread:false});
  if(url.pathname==='/functions/v1/delete-account')return json({ok:true});
  if(url.pathname.startsWith('/storage/v1/object/list/'))return json([{name:'1.jpg',id:'object-id',metadata:{mimetype:'image/jpeg'}}]);
  if(url.pathname.startsWith('/storage/v1/object/')&&request.method==='DELETE')return state.removeError?json({error:'Unauthorized',message:'Storage denied',statusCode:'403'},403):json([{name:'user/post/1.jpg'}]);
  if(url.pathname.startsWith('/storage/v1/object/')&&request.method==='POST')return json({Key:'post-images/user/post/1.jpg',Id:'object-id'});
  if(url.pathname.startsWith('/storage/v1/object/')&&request.method==='GET')return new Response(new Blob(['jpeg'],{type:'image/jpeg'}));
  throw Error('Unexpected synthetic SDK request: '+url.pathname);
 };
 const context=vm.createContext({URL,URLSearchParams,Headers,Request,Response,Blob,File,FormData,AbortController,AbortSignal,TextEncoder,TextDecoder,crypto,atob,btoa,WebSocket:class{constructor(){throw Error('Unexpected SDK WebSocket connection');}},setTimeout,clearTimeout,setInterval,clearInterval,console});
 vm.runInContext(bundle,context,{timeout:5000});const createClient=context.supabase.createClient;
 const make=(options={})=>createClient('https://sdk-test.supabase.co','synthetic-public-key',{...options,global:{fetch:transport,...options.global},auth:{autoRefreshToken:false,detectSessionInUrl:false,persistSession:true,...options.auth}});
 const primary=make({auth:{storageKey:'normal-session',storage:memory(shared)}});
 const recovery=make({auth:{storageKey:'azice-password-recovery',storage:createRecoveryStorage(memory(shared),memory(tab)),flowType:'pkce'}});
 return {calls,shared,tab,state,primary,recovery,make,api:createCloud(primary,{recoveryClient:recovery,origin:'https://azice.test'})};
}

sdkTest('actual pinned SDK preserves browser sign-in, verified user, profile and RPC response behavior',async()=>{
 const h=sdk();assert.equal((await h.api.signIn('synthetic@example.invalid','synthetic-password')).id,B);assert.equal((await h.api.getUser()).id,B);assert.equal((await h.api.getMyProfile()).id,B);
 assert.equal((await h.primary.auth.refreshSession()).data.user.id,B);assert.ok(h.calls.some(call=>call.url.searchParams.get('grant_type')==='refresh_token'&&call.body.refresh_token));
 assert.equal((await h.primary.auth.signUp({email:'synthetic@example.invalid',password:'synthetic-password',options:{emailRedirectTo:'https://azice.test'}})).data.user.id,B);
 const oauth=await h.primary.auth.signInWithOAuth({provider:'google',options:{redirectTo:'https://azice.test',skipBrowserRedirect:true}});assert.equal(new URL(oauth.data.url).searchParams.get('provider'),'google');
 const result=await h.primary.rpc('get_activity');assert.equal(result.error,null);assert.equal(result.data.unread,false);
 assert.ok(h.calls.every(call=>call.request.headers.get('x-client-info')?.includes(VERSION)));
});

sdkTest('actual pinned SDK preserves isolated PKCE and implicit recovery without changing the main account',async()=>{
 const h=sdk();await h.api.signIn('synthetic@example.invalid','synthetic-password');const normal=h.shared.get('normal-session');
 await h.api.requestPasswordReset('synthetic@example.invalid');const request=h.calls.find(call=>call.url.pathname==='/auth/v1/recover');assert.equal(request.url.searchParams.get('redirect_to'),'https://azice.test/?recovery=1');assert.ok(request.body.code_challenge);assert.ok(h.shared.get('azice-password-recovery-code-verifier'));
 assert.equal((await h.api.beginPasswordRecovery({kind:'pkce',code:'synthetic-code'})).id,A);assert.ok(h.calls.some(call=>call.body?.auth_code==='synthetic-code'&&call.body.code_verifier));
 await h.api.updateRecoveredPassword('synthetic-new-password',A);assert.equal(h.shared.get('normal-session'),normal);assert.ok(h.tab.get('azice-password-recovery'));assert.equal(h.shared.has('azice-password-recovery'),false);
 await h.api.endPasswordRecovery();assert.equal((await h.api.getUser()).id,B);
 assert.equal((await h.api.beginPasswordRecovery({kind:'implicit',accessToken:token(A),refreshToken:'synthetic-refresh-A'})).id,A);assert.equal((await h.api.getUser()).id,B);await h.api.endPasswordRecovery();
 assert.equal((await h.api.beginPasswordRecovery({kind:'token_hash',tokenHash:'synthetic-hash'})).id,A);assert.equal((await h.api.getUser()).id,B);await h.api.endPasswordRecovery();
});

sdkTest('actual pinned SDK preserves private Storage JPEG upload, list, download and returned remove errors',async()=>{
 const h=sdk();await h.api.signIn('synthetic@example.invalid','synthetic-password');const bucket=h.primary.storage.from('post-images');
 const uploaded=await bucket.upload('user/post/1.jpg',new Blob(['optimized'],{type:'image/jpeg'}),{contentType:'image/jpeg',upsert:false});assert.equal(uploaded.error,null);
 const call=h.calls.find(item=>item.url.pathname.startsWith('/storage/')&&item.request.method==='POST');assert.equal([...(await call.request.clone().formData()).values()].find(value=>value instanceof Blob).type,'image/jpeg');assert.equal(call.request.headers.get('authorization'),'Bearer '+token(B));
 assert.equal((await bucket.list('user/post')).data[0].name,'1.jpg');const downloaded=await bucket.download('user/post/1.jpg');assert.equal(downloaded.error,null);assert.equal(downloaded.data.type,'image/jpeg');
 h.state.removeError=true;assert.equal((await bucket.remove(['user/post/1.jpg'])).error.message,'Storage denied');h.state.removeError=false;assert.equal((await bucket.remove(['user/post/1.jpg'])).error,null);
});

sdkTest('actual pinned SDK retains the Edge-style getUser, admin deletion and function invocation APIs',async()=>{
 const h=sdk(),admin=h.make({auth:{persistSession:false}});assert.equal((await admin.auth.getUser(token(B))).data.user.id,B);
 const caller=h.make({auth:{persistSession:false},global:{headers:{Authorization:'Bearer '+token(B)}}});assert.equal((await caller.auth.getUser()).data.user.id,B);
 assert.equal((await admin.auth.admin.deleteUser(B)).error,null);assert.ok(h.calls.some(call=>call.url.pathname==='/auth/v1/admin/users/'+B&&call.request.method==='DELETE'));
 await h.api.signIn('synthetic@example.invalid','synthetic-password');assert.equal((await h.primary.functions.invoke('delete-account')).error,null);
});
