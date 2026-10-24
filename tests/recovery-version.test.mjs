import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCloud,createRecoveryStorage} from '../cloud.js';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
function setup({search='',hash='',session=new Map(),user=null,configured=false}={}){
 const root={innerHTML:''},toast={},events={},urls=[],shared=new Map();let authCallback,primaryReads=0;
 const location={origin:'https://azice.test',protocol:'https:',pathname:'/',search,hash};
 const api={mode:'cloud',getUser:async()=>{primaryReads++;return user;},onAuthChange:cb=>{authCallback=cb;return {};},getMyProfile:async()=>({id:user?.id,display_name:'Existing'}),getFeed:async()=>[],friendData:async()=>({friends:[],incoming:[],outgoing:[]}),getActivity:async()=>({items:[],unread:false}),getInvite:async()=>'invite',requestPasswordReset:async()=>{},beginPasswordRecovery:async()=>({id:'recovered-A'}),updateRecoveredPassword:async()=>{},endPasswordRecovery:async()=>{},signIn:async()=>({id:'normal'}),signUp:async()=>({id:'normal'})};
 const window={AZICE_CONFIG:configured?{supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public-test'}:{},history:{state:{existing:true},replaceState(state,title,path){urls.push(path);const parsed=new URL(path,location.origin);location.search=parsed.search;location.hash=parsed.hash;}},addEventListener:(t,fn)=>{events[t]=fn;},scrollTo(){}};
 const context=vm.createContext({URLSearchParams,URL,Intl,Map,Set,Date,Promise,console,createCloud,createRecoveryStorage,location,window,navigator:{},sessionStorage:storage(session),localStorage:storage(shared),setTimeout:()=>1,clearTimeout(){},FormData:class{constructor(form){return Object.entries(form.values||{});}},document:{visibilityState:'visible',querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:()=>[],addEventListener:(t,fn)=>{events[t]=fn;}}});
 vm.runInContext(source+'\nglobalThis.a={state,recovery,parseRecoveryLink,headerBrand,authView,passwordRecoveryView,boot,home,handleAction,refreshOnReturn,setCurrentUser,setApi:value=>{api=value;}};',context);context.a.setApi(api);
 return {a:context.a,api,context,root,toast,events,urls,session,shared,location,get primaryReads(){return primaryReads;},emit:(next,event='SIGNED_IN')=>authCallback?.(next,event),submit:(id,values)=>events.submit({preventDefault(){},target:{id,values}})};
}

test('header version is one explicit four-part deployed-code constant, independent of browser settings',()=>{
 const h=setup();h.shared.set('appVersion','999.0.0.0');assert.match(h.a.headerBrand(),/BETA v0\.1\.0\.2/);
 assert.equal((source.match(/0\.1\.0\.2/g)||[]).length,1);assert.match(source,/const APP_VERSION='\d+\.\d+\.\d+\.\d+'/);
 assert.match(h.a.authView(),/Forgot password\?/);h.a.state.authSignUp=true;assert.doesNotMatch(h.a.authView(),/Forgot password\?/);
});

test('recovery parser distinguishes implicit, PKCE, token-hash and ordinary OAuth redirects; scrubs credentials',()=>{
 const h=setup({search:'?recovery=1&code=sensitive-code&invite=keep'});assert.match(h.urls[0],/recovery=1/);assert.doesNotMatch(h.urls[0],/sensitive-code|code=/);assert.match(h.urls[0],/invite=keep/);
 assert.equal(h.a.parseRecoveryLink('?code=google',''),null);
 assert.equal(h.a.parseRecoveryLink('','#type=recovery&access_token=access&refresh_token=refresh').kind,'implicit');
 assert.equal(h.a.parseRecoveryLink('?token_hash=hash&type=recovery','').kind,'token_hash');
 assert.equal(h.a.parseRecoveryLink('?recovery=1','#error=access_denied&error_code=otp_expired').kind,'invalid');
});

test('request success and unknown-account errors produce the same generic email response',async()=>{
 for(const error of [null,{status:400,message:'Account not found',code:'user_not_found'}]){
  const h=setup();await h.a.handleAction({dataset:{action:'recovery-request'}});h.api.requestPasswordReset=async()=>{if(error)throw error;};
  await h.submit('reset-request-form',{email:'someone@example.com'});assert.equal(h.a.recovery.stage,'sent');assert.match(h.root.innerHTML,/If an account exists/);assert.doesNotMatch(h.root.innerHTML,/Account not found|someone@example.com/);
 }
});

test('request loading suppresses duplicate submission and normal routing; failure supports retry',async()=>{
 const h=setup();await h.a.boot();await h.a.handleAction({dataset:{action:'recovery-request'}});let resolve,calls=0;
 h.api.requestPasswordReset=()=>{calls++;return new Promise(r=>{resolve=r;});};const pending=h.submit('reset-request-form',{email:'test@example.com'});
 assert.match(h.root.innerHTML,/Sending…/);assert.match(h.root.innerHTML,/disabled/);await h.submit('reset-request-form',{email:'test@example.com'});assert.equal(calls,1);
 h.emit({id:'other'},'SIGNED_IN');await h.a.refreshOnReturn();await h.a.handleAction({dataset:{action:'feed'}});assert.equal(h.a.state.view,'recovery');resolve();await pending;
 await h.a.handleAction({dataset:{action:'recovery-request'}});h.api.requestPasswordReset=async()=>{throw {status:503,message:'Internal SMTP detail'};};await h.submit('reset-request-form',{email:'test@example.com'});assert.match(h.root.innerHTML,/Check your connection/);assert.doesNotMatch(h.root.innerHTML,/Internal SMTP detail/);
 h.api.requestPasswordReset=async()=>{};await h.submit('reset-request-form',{email:'test@example.com'});assert.equal(h.a.recovery.stage,'sent');
});

test('recovery boot never routes through another primary user or onboarding; invalid and used links remain protected',async()=>{
 for(const code of ['otp_expired','flow_state_not_found','invalid_grant']){
  const h=setup({search:'?recovery=1&code=used',user:{id:'signed-in-B'}});h.api.beginPasswordRecovery=async()=>{throw {code};};await h.a.boot();
  assert.equal(h.primaryReads,0);assert.equal(h.a.recovery.stage,'invalid');assert.match(h.root.innerHTML,/expired or already used/);await h.a.home();assert.equal(h.a.state.view,'recovery');assert.doesNotMatch(h.root.innerHTML,/code=used/);
 }
});

test('new password validates length and confirmation; success clears temporary state and retains primary account B',async()=>{
 const h=setup({search:'?recovery=1&code=valid',user:{id:'signed-in-B'}});let updates=0,ended=0;
 h.api.updateRecoveredPassword=async(password,id)=>{updates++;assert.equal(password,'new secure password');assert.equal(id,'recovered-A');};h.api.endPasswordRecovery=async()=>{ended++;};
 await h.a.boot();assert.equal(h.a.recovery.stage,'ready');assert.ok(h.session.has('azice_recovery_target'));
 await h.submit('reset-password-form',{password:'short',confirm_password:'short'});assert.match(h.root.innerHTML,/8–128 characters/);
 await h.submit('reset-password-form',{password:'new secure password',confirm_password:'different'});assert.match(h.root.innerHTML,/Passwords do not match/);assert.equal(updates,0);
 h.session.set('azice-password-recovery','temporary tokens');await h.submit('reset-password-form',{password:'new secure password',confirm_password:'new secure password'});
 assert.equal(updates,1);assert.equal(ended,1);assert.equal(h.a.recovery.stage,'success');assert.equal(h.session.has('azice_recovery_target'),false);assert.equal(h.session.has('azice-password-recovery'),false);
 await h.a.handleAction({dataset:{action:'recovery-exit'}});assert.equal(h.a.state.user.id,'signed-in-B');assert.equal(h.a.state.view,'feed');assert.equal(h.a.recovery.active,false);
});

test('resume requires a nonexpired tab marker; fresh invalid credentials cannot resurrect an older recovery account',async()=>{
 const session=new Map([['azice_recovery_target',JSON.stringify({userId:'A',expires:Date.now()+60000})]]);
 const resumed=setup({search:'?recovery=1',session});let link;resumed.api.beginPasswordRecovery=async value=>{link=value;return {id:'A'};};await resumed.a.boot();assert.equal(link.kind,'resume');assert.equal(link.userId,'A');
 const invalid=setup({search:'?recovery=1&code=bad',session});assert.equal(session.has('azice_recovery_target'),false);invalid.api.beginPasswordRecovery=async()=>{throw Error('Invalid');};await invalid.a.boot();
 const reloaded=setup({search:'?recovery=1',session});await reloaded.a.boot();assert.equal(reloaded.a.recovery.stage,'invalid');
 const expired=setup({search:'?recovery=1',session:new Map([['azice_recovery_target',JSON.stringify({userId:'A',expires:1})]])});await expired.a.boot();assert.equal(expired.a.recovery.stage,'invalid');
});

test('weak password and changed/expired recovery session show safe feedback; server failure can retry',async()=>{
 const h=setup({hash:'#type=recovery&access_token=access&refresh_token=refresh'});await h.a.boot();
 for(const [code,copy,stage]of [['weak_password','stronger password','ready'],['recovery_invalid','expired or changed','invalid']]){
  h.a.recovery.stage='ready';h.api.updateRecoveredPassword=async()=>{throw {code,message:'Private server detail'};};await h.submit('reset-password-form',{password:'valid-password',confirm_password:'valid-password'});assert.match(h.root.innerHTML,new RegExp(copy));assert.equal(h.a.recovery.stage,stage);assert.doesNotMatch(h.root.innerHTML,/Private server detail/);
 }
});

test('ordinary sign-in and onboarding still route normally, and exiting a request keeps the PKCE verifier',async()=>{
 const h=setup();await h.a.boot();assert.equal(h.a.state.view,'auth');h.api.getMyProfile=async()=>null;await h.submit('auth-form',{email:'user@example.com',password:'password'});assert.equal(h.a.state.view,'onboard');
 const request=setup();let ended=0;request.api.endPasswordRecovery=async()=>{ended++;};await request.a.handleAction({dataset:{action:'recovery-request'}});request.shared.set('azice-password-recovery-code-verifier','verifier');await request.a.handleAction({dataset:{action:'recovery-exit'}});assert.equal(ended,0);assert.equal(request.shared.get('azice-password-recovery-code-verifier'),'verifier');
});

test('recovery storage shares only PKCE verifier; auth tokens and the normal session remain isolated',()=>{
 const shared=new Map([['sb-normal-auth-token','normal-B']]),tabA=new Map(),tabB=new Map();const a=createRecoveryStorage(storage(shared),storage(tabA)),b=createRecoveryStorage(storage(shared),storage(tabB));
 a.setItem('azice-password-recovery-code-verifier','verifier');a.setItem('azice-password-recovery','A tokens');
 assert.equal(b.getItem('azice-password-recovery-code-verifier'),'verifier');assert.equal(b.getItem('azice-password-recovery'),null);assert.equal(shared.get('sb-normal-auth-token'),'normal-B');
});

test('a sign-in response already in flight cannot replace a newly opened recovery form',async()=>{
 const h=setup();await h.a.boot();let finish;h.api.signIn=()=>new Promise(resolve=>{finish=resolve;});
 const pending=h.submit('auth-form',{email:'user@example.com',password:'password'});
 await h.a.handleAction({dataset:{action:'recovery-request'}});finish({id:'normal'});await pending;
 assert.equal(h.a.state.view,'recovery');assert.equal(h.a.recovery.stage,'request');assert.match(h.root.innerHTML,/Reset your password/);
});

test('adapter requests exact same-origin redirect, exchanges all supported links and never updates/signs out main account',async()=>{
 const calls=[],primary={auth:{updateUser:()=>{throw Error('Wrong client');},signOut:()=>{throw Error('Wrong client');}}};
 const auth={resetPasswordForEmail:async(email,options)=>{calls.push({email,options});return {};},exchangeCodeForSession:async code=>{calls.push({code});return {data:{user:{id:'A'}}};},setSession:async tokens=>{calls.push(tokens);return {data:{session:{user:{id:'A'}}}};},verifyOtp:async options=>{calls.push(options);return {data:{user:{id:'A'}}};},getUser:async()=>({data:{user:{id:'A'}}}),updateUser:async options=>{calls.push(options);return {data:{user:{id:'A'}}};},signOut:async options=>{calls.push(options);return {};}};
 const api=createCloud(primary,{recoveryClient:{auth},origin:'https://azice.example'});await api.requestPasswordReset('a@example.com');assert.equal(calls[0].options.redirectTo,'https://azice.example/?recovery=1');
 for(const link of [{kind:'pkce',code:'code'},{kind:'implicit',accessToken:'access',refreshToken:'refresh'},{kind:'token_hash',tokenHash:'hash'}])assert.equal((await api.beginPasswordRecovery(link)).id,'A');
 assert.equal(calls.some(c=>c.scope),false);await api.updateRecoveredPassword('password','A');await api.endPasswordRecovery();assert.deepEqual(calls.at(-1),{scope:'local'});
 auth.getUser=async()=>({data:{user:{id:'B'}}});const count=calls.length;await assert.rejects(api.updateRecoveredPassword('password','A'),error=>error.code==='recovery_invalid');assert.equal(calls.length,count);
});

test('Supabase initialization disables primary callback consumption and uses an isolated PKCE client',async()=>{
 const h=setup({search:'?recovery=1&code=secret',configured:true}),created=[];h.a.setApi(null);
 h.context.window.supabase={createClient:(url,key,options)=>{created.push(options);return {auth:{exchangeCodeForSession:async()=>({data:{user:{id:'A'}}})}};}};
 await h.a.boot();assert.equal(created.length,2);assert.equal(created[0].auth.detectSessionInUrl,false);
 assert.equal(created[1].auth.storageKey,'azice-password-recovery');assert.equal(created[1].auth.flowType,'pkce');assert.equal(created[1].auth.detectSessionInUrl,false);assert.equal(h.a.recovery.stage,'ready');
});
