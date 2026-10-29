import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {moduleRuntime,browserContext} from './module-harness.mjs';
import {moduleOrigin,moduleGraph,projectRoot} from './public-modules.mjs';
import {workerRuntime,shellNetwork} from './service-worker-harness.mjs';

const scenario=process.argv[2];
function listeners(h){
  assert.deepEqual([...h.events.document.keys()].sort(),['click','invalid','input','change','submit','visibilitychange'].sort());
  assert.deepEqual([...h.events.window.keys()].sort(),['focus','pageshow','beforeinstallprompt','appinstalled','popstate','pagehide'].sort());
  for(const name of ['click','invalid','input','change','submit','visibilitychange'])assert.equal(h.events.document.get(name)?.length,1,name);
  for(const name of ['focus','pageshow','beforeinstallprompt','appinstalled','popstate','pagehide'])assert.equal(h.events.window.get(name)?.length,1,name);
  assert.deepEqual(h.registrations,['/sw.js']);assert.deepEqual(h.errors,[]);
}
async function boot({cloud=false,readSource}={}){
  const h=browserContext({cloud}),runtime=moduleRuntime({context:h.context,readSource});
  const [a,b]=await Promise.all([runtime.load('/app.js'),runtime.load('/app.js')]);
  await h.settled();assert.equal(a,b);listeners(h);
  return {h,runtime};
}
if(scenario==='exports'){
  const h=browserContext(),runtime=moduleRuntime({context:h.context});
  const processing=await runtime.load('/src/image-processing.js');
  assert.deepEqual(Object.keys(processing).sort(),['canvasBlob','decodeAvatar']);
  const presentation=await runtime.load('/src/presentation.js');
  assert.deepEqual(Object.keys(presentation).sort(),['activityBellIcon','avatar','backBar','brand','dayISO','fmt','html','initials','photoCard']);
  const cloud=await runtime.load('/cloud.js'),demo=await runtime.load('/demo.js');
  assert.deepEqual(Object.keys(cloud).sort(),['createCloud','createRecoveryStorage','isSessionMissingOrInvalid']);
  const auth=await runtime.load('/src/auth-helpers.js');
  assert.deepEqual(Object.keys(auth).sort(),['createRecoveryStorage','isSessionMissingOrInvalid']);
  assert.equal(cloud.createRecoveryStorage,auth.createRecoveryStorage);
  assert.equal(cloud.isSessionMissingOrInvalid,auth.isSessionMissingOrInvalid);
  assert.equal(runtime.modules.has(moduleOrigin+'/src/auth-helpers.js'),true);
  assert.deepEqual(Object.keys(demo),['createDemo']);
  const api=cloud.createCloud({auth:{onAuthStateChange(){}}});
  const expected='mode getUser onAuthChange requestPasswordReset beginPasswordRecovery updateRecoveredPassword endPasswordRecovery signIn signUp google signOut deleteAccount getMyProfile saveProfile getProfile getNotificationPreferences getDailyPostingStatus saveNotificationPreferences pushSubscription resolveNotification getPost getActivity markActivityRead getProfiles getInvite rotateInvite previewInvite sendRequest sendUsernameRequest commentAuthor sendCommentRequest friendData requestAction unfriend getFeed getHistory imageUrl retryPostCleanup createPost comment react saveAvatar'.split(' ');
  assert.deepEqual(Object.keys(api).sort(),expected.sort());
  const local=demo.createDemo();assert.equal(local.mode,'demo');
  const demoSurface='comment commentAuthor createPost deleteAccount friendData getDailyPostingStatus getFeed getHistory getInvite getMyProfile getPhotos getProfile getProfiles getUser google imageUrl mode previewInvite react requestAction resetDemo rotateInvite saveAvatar saveProfile sendCommentRequest sendRequest sendUsernameRequest signIn signOut signUp unfriend'.split(' ');
  assert.deepEqual(Object.keys(local).sort(),demoSurface.sort());
  for(const name of demoSurface.filter(name=>name!=='mode'))assert.equal(typeof local[name],'function',name);
  assert.equal(h.events.document.size,0);assert.equal(h.registrations.length,0);
}else if(scenario==='demo-compat'){
  const h=browserContext();let clockReads=0;
  const epoch=Date.UTC(2026,9,29,12);
  h.context.Date=class extends Date{
    constructor(...args){super(...(args.length?args:[epoch]));}
    static now(){clockReads++;return epoch;}
  };
  const runtime=moduleRuntime({context:h.context});
  const [entry,again]=await Promise.all([runtime.load('/demo.js'),runtime.load('/./demo.js')]);
  assert.equal(entry,again);assert.deepEqual(Object.keys(entry),['createDemo']);
  assert.equal(clockReads,1,'Starter clock captured once at module evaluation');
  assert.equal(h.reads.size,0,'Import must not read persistence or create an adapter');
  const implementation=await runtime.load('/src/demo.js');
  assert.deepEqual(Object.keys(implementation),['createDemo']);
  assert.equal(entry.createDemo,implementation.createDemo);
  assert.equal(clockReads,1,'Root and implementation paths share one module evaluation');
  const api=entry.createDemo();assert.equal(h.reads.get('azice-demo-v1'),1);
  assert.equal(api.mode,'demo');assert.equal((await api.getUser()).id,'demo-me');
  const feed=await api.getFeed();assert.deepEqual(Array.from(feed,p=>p.id),['sample-1','sample-2']);
  assert.equal(feed[0].post_photos[0].path,'/assets/demo-beer.svg');
  assert.equal(feed[0].published_at,new Date(epoch-35*60000).toISOString());
  await api.saveProfile({display_name:'Persisted Demo',bio:'Preserved local data'});
  const raw=h.context.localStorage.getItem('azice-demo-v1'),saved=JSON.parse(raw);
  assert.deepEqual(Object.keys(saved).sort(),['comments','friends','posts','profiles','reactions','requests','token','user']);
  assert.equal(saved.profiles[0].display_name,'Persisted Demo');assert.equal(saved.token,'demo-invite');
  const reloaded=implementation.createDemo();assert.equal((await reloaded.getMyProfile()).bio,'Preserved local data');
  assert.equal(h.context.localStorage.getItem('azice-demo-v1'),raw,'Reload must not rewrite persistence');
  await reloaded.resetDemo();assert.equal((await reloaded.getMyProfile()).display_name,'You');
  assert.equal((await reloaded.getFeed())[0].published_at,new Date(epoch-35*60000).toISOString());
  h.context.localStorage.setItem('azice-demo-v1','invalid JSON');
  assert.equal((await entry.createDemo().getUser()).id,'demo-me','Malformed data retains starter fallback');
  assert.equal(h.context.localStorage.getItem('azice-demo-v1'),'invalid JSON','Fallback does not eagerly persist');
  assert.equal(h.events.document.size,0);assert.equal(h.events.window.size,0);
  assert.equal(h.registrations.length,0);assert.equal(h.clients.length,0);
}else if(scenario==='cloud-compat'){
  const h=browserContext(),runtime=moduleRuntime({context:h.context});
  const [entry,again]=await Promise.all([runtime.load('/cloud.js'),runtime.load('/./cloud.js')]);
  assert.equal(entry,again);assert.deepEqual(Object.keys(entry).sort(),['createCloud','createRecoveryStorage','isSessionMissingOrInvalid']);
  const implementation=await runtime.load('/src/cloud.js');
  assert.deepEqual(Object.keys(implementation).sort(),['createCloud','createRecoveryStorage','isSessionMissingOrInvalid']);
  assert.equal(entry.createCloud,implementation.createCloud);
  const auth=await runtime.load('/src/auth-helpers.js');
  assert.equal(entry.createRecoveryStorage,auth.createRecoveryStorage);assert.equal(entry.isSessionMissingOrInvalid,auth.isSessionMissingOrInvalid);
  assert.equal(h.clients.length,0);assert.equal(h.subscriptions,0);assert.equal(h.reads.size,0);
  const make=id=>{
    const state={id,callbacks:[],reads:0,signouts:0,journal:[]};
    const client={auth:{
      onAuthStateChange(callback){state.callbacks.push(callback);return {data:{subscription:{unsubscribe(){}}}};},
      async getUser(){state.reads++;return {data:{user:{id:state.id}}};},
      async signOut(){state.signouts++;return {};}
    }};
    const store={getItem(key){state.journal.push(['get',key]);return null;},setItem(key){state.journal.push(['set',key]);}};
    return {state,client,store};
  };
  const primary=make('A'),other=make('C'),recovery=make('R'),locks=[];
  h.context.navigator.locks={async request(name,options,task){locks.push({name,options});return task({name});}};
  const api=entry.createCloud(primary.client,{recoveryClient:recovery.client,origin:moduleOrigin,postCleanupStorage:primary.store});
  const second=implementation.createCloud(other.client,{postCleanupStorage:other.store});
  assert.equal(primary.state.callbacks.length,1);assert.equal(other.state.callbacks.length,1);assert.equal(recovery.state.callbacks.length,0);
  assert.equal(primary.state.reads,0);assert.equal(primary.state.journal.length,0);assert.equal(locks.length,0);
  assert.equal((await api.getUser()).id,'A');assert.equal((await second.getUser()).id,'C');
  primary.state.id='B';primary.state.callbacks[0]('SIGNED_IN',{user:{id:'B'}});
  assert.equal((await api.getUser()).id,'B');assert.equal((await second.getUser()).id,'C');
  assert.equal((await api.beginPasswordRecovery({kind:'resume',userId:'R'})).id,'R');
  assert.equal(recovery.state.reads,1);assert.equal(primary.state.signouts,0);assert.equal(other.state.signouts,0);
  assert.equal(JSON.stringify(await api.retryPostCleanup()),'{"published":[],"retained":[]}');
  await second.retryPostCleanup();
  assert.deepEqual(primary.state.journal,[['get','azice_post_cleanup_v1:B']]);
  assert.deepEqual(other.state.journal,[['get','azice_post_cleanup_v1:C']]);
  assert.deepEqual(locks.map(lock=>lock.name),['azice:post-operation:B','azice:post-operation:C']);
  assert.ok(locks.every(lock=>lock.options.ifAvailable===true));assert.equal(h.clients.length,0);
  assert.equal(h.events.document.size,0);assert.equal(h.events.window.size,0);assert.equal(h.registrations.length,0);
}else if(scenario==='demo-boot'||scenario==='cloud-boot'){
  const cloud=scenario==='cloud-boot',{h,runtime}=await boot({cloud});
  await runtime.load('/./app.js');await h.settled();listeners(h);
  if(cloud){assert.equal(h.clients.length,2);assert.equal(h.subscriptions,2);assert.match(h.root.innerHTML,/Welcome back/);
    assert.equal(h.clients[0][2].auth.persistSession,true);assert.equal(h.clients[1][2].auth.storageKey,'azice-password-recovery');assert.equal(h.clients[1][2].auth.detectSessionInUrl,false);}
  else{assert.equal(h.reads.get('azice-demo-v1'),1);assert.match(h.root.innerHTML,/What's happening\?/);assert.equal(h.clients.length,0);}
}else if(scenario==='nested'){
  const sources=new Map([
    ['/entry.js',"import {token} from './src/shared.js'; import {token as other} from './src/reexport.js'; export const same=token===other; export const later=()=>import('./src/later.mjs'); export const url=import.meta.url;"],
    ['/src/shared.js','globalThis.evaluations=(globalThis.evaluations||0)+1; export const token={};'],
    ['/src/reexport.js',"export {token} from './shared.js';"],
    ['/src/later.mjs',"import {token} from './shared.js'; export {token};"],
    ['/bad-export.js',"import {missing} from './src/shared.js'; export {missing};"],
    ['/cycle-a.mjs',"import {read} from './cycle-b.mjs'; export const value=1; export function through(){return read();}"],
    ['/cycle-b.mjs',"import {value} from './cycle-a.mjs'; export function read(){return value;}"]]);
  const context=vm.createContext({}),runtime=moduleRuntime({context,readSource:id=>{const value=sources.get(new URL(id).pathname);if(value===undefined)throw Error('Missing module');return value;}});
  const [a,b]=await Promise.all([runtime.load('/entry.js'),runtime.load('/entry.js')]);
  assert.equal(a,b);assert.equal(a.same,true);assert.equal(a.url,moduleOrigin+'/entry.js');
  assert.equal((await a.later()).token,(await runtime.load('/src/shared.js')).token);assert.equal(context.evaluations,1);
  await assert.rejects(async()=>runtime.load('https://outside.invalid/test.js'),/Nonlocal/);
  await assert.rejects(runtime.load('/missing.js'),/Missing/);
  await assert.rejects(runtime.load('/bad-export.js'),/does not provide an export/);
  assert.equal((await runtime.load('/cycle-a.mjs')).through(),1);
}else if(scenario==='offline'){
  const worker=workerRuntime();
  for(const id of moduleGraph().keys())assert.ok(worker.inventory.includes(new URL(id).pathname),'Module absent from precache: '+id);
  await worker.lifecycle('install');await worker.lifecycle('activate');worker.network.online=false;
  assert.match(await (await worker.fetch('/')).text(),/type="module"/);
  await boot({readSource:async id=>{const response=await worker.fetch(id);assert.ok(response?.ok,'Uncached module '+id);return response.text();}});
  assert.equal(await worker.fetch('/config.js'),undefined,'Configuration intentionally bypasses worker interception');
  assert.equal(await worker.fetch('/private/photo.jpg'),undefined);
  assert.equal(await worker.fetch('https://synthetic.supabase.co/storage/v1/object/private'),undefined);
}else if(scenario==='cloud-relocation'){
  const network=shellNetwork(),stores=new Map(),source=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
  const shim=network.resources.get('/cloud.js'),implementation=network.resources.get('/src/cloud.js');
  const legacyImplementation=Buffer.from(implementation.toString().replaceAll("'./auth-helpers.js'","'./src/auth-helpers.js'"));
  const legacySource=source.replace("'azice-shell-v7-cloud-adapter'","'fixture-legacy-cloud-shell'").replace(", '/src/cloud.js'",'');
  network.resources.set('/cloud.js',legacyImplementation);network.resources.delete('/src/cloud.js');
  const legacy=workerRuntime({network,stores,source:legacySource});await legacy.lifecycle('install');await legacy.lifecycle('activate');
  const old=await boot({cloud:true,readSource:async id=>(await legacy.fetch(id)).text()});
  const oldFactory=(await old.runtime.load('/cloud.js')).createCloud;
  network.resources.set('/cloud.js',shim);network.resources.set('/src/cloud.js',implementation);
  const updated=workerRuntime({network,stores});await updated.lifecycle('install');await updated.lifecycle('activate');
  assert.equal((await old.runtime.load('/cloud.js')).createCloud,oldFactory,'Evaluated legacy client remains stable');
  listeners(old.h);assert.equal(old.h.clients.length,2);assert.equal(old.h.subscriptions,2);
  network.online=false;
  const fresh=await boot({cloud:true,readSource:async id=>(await updated.fetch(id)).text()});
  const freshFactory=(await fresh.runtime.load('/cloud.js')).createCloud;
  assert.equal(freshFactory,(await fresh.runtime.load('/src/cloud.js')).createCloud);
  assert.equal(fresh.h.clients.length,2);assert.equal(fresh.h.subscriptions,2,'Re-export must not add subscriptions');
  network.online=true;network.resources.set('/cloud.js',legacyImplementation);network.resources.delete('/src/cloud.js');
  const rollback=workerRuntime({network,stores,source:legacySource});await rollback.lifecycle('install');await rollback.lifecycle('activate');network.online=false;
  await boot({cloud:true,readSource:async id=>(await rollback.fetch(id)).text()});
  assert.equal(await rollback.fetch('/src/cloud.js'),undefined);
  assert.equal((await fresh.runtime.load('/cloud.js')).createCloud,freshFactory,'Evaluated new client remains stable after rollback');
  network.online=true;const incomplete=workerRuntime({network,stores});
  await assert.rejects(incomplete.lifecycle('install'),/Precache failed/);
  assert.ok(stores.get(rollback.cacheName).size>0,'Incomplete cloud relocation cannot erase the working shell');
}else if(scenario==='demo-relocation'){
  const network=shellNetwork(),stores=new Map(),source=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
  const shim=network.resources.get('/demo.js'),implementation=network.resources.get('/src/demo.js');
  // Model the pre-move artifact using the byte-identical implementation at its
  // old URL and an inventory without src/demo.js; no copied legacy fixture drifts.
  const legacySource=source.replace("'azice-shell-v7-cloud-adapter'","'fixture-legacy-demo-shell'").replace(", '/src/demo.js'",'');
  network.resources.set('/demo.js',implementation);network.resources.delete('/src/demo.js');
  const legacy=workerRuntime({network,stores,source:legacySource});await legacy.lifecycle('install');await legacy.lifecycle('activate');
  const old=await boot({readSource:async id=>(await legacy.fetch(id)).text()});
  const oldFactory=(await old.runtime.load('/demo.js')).createDemo;
  network.resources.set('/demo.js',shim);network.resources.set('/src/demo.js',implementation);
  const updated=workerRuntime({network,stores});await updated.lifecycle('install');await updated.lifecycle('activate');
  assert.equal((await old.runtime.load('/demo.js')).createDemo,oldFactory,'An evaluated legacy client remains stable');
  listeners(old.h);assert.equal(old.h.reads.get('azice-demo-v1'),1);
  network.online=false;
  const fresh=await boot({readSource:async id=>(await updated.fetch(id)).text()});
  const freshFactory=(await fresh.runtime.load('/demo.js')).createDemo;
  assert.equal(freshFactory,(await fresh.runtime.load('/src/demo.js')).createDemo);
  assert.equal(fresh.h.reads.get('azice-demo-v1'),1,'Shim must not create a second adapter');
  network.online=true;network.resources.set('/demo.js',implementation);network.resources.delete('/src/demo.js');
  const rollback=workerRuntime({network,stores,source:legacySource});await rollback.lifecycle('install');await rollback.lifecycle('activate');network.online=false;
  await boot({readSource:async id=>(await rollback.fetch(id)).text()});
  assert.equal(await rollback.fetch('/src/demo.js'),undefined);
  assert.equal((await fresh.runtime.load('/demo.js')).createDemo,freshFactory,'Already evaluated new client remains stable after rollback');
  network.online=true;const incomplete=workerRuntime({network,stores});
  await assert.rejects(incomplete.lifecycle('install'),/Precache failed/);
  assert.ok(stores.get(rollback.cacheName).size>0,'Missing relocated implementation cannot erase the prior working shell');
}else if(scenario==='upgrade-rollback'){
  const network=shellNetwork(),stores=new Map(),original=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
  const v1=workerRuntime({network,stores});await v1.lifecycle('install');await v1.lifecycle('activate');
  const originalApp=network.resources.get('/app.js');
  network.resources.set('/app.js',Buffer.from(originalApp.toString()+"\nimport {version} from './src/version.mjs'; globalThis.fixtureRelease=version;\n"));
  network.resources.set('/src/version.mjs',Buffer.from('export const version="one";'));
  const old=await boot({readSource:async id=>{const response=await network.fetch(id);assert.ok(response.ok);return response.text();}});
  assert.equal(old.h.context.fixtureRelease,'one');
  network.resources.set('/src/version.mjs',Buffer.from('export const version="two";'));
  const upgradedSource=original.replace("'azice-shell-v7-cloud-adapter'","'test-upgrade-shell'").replace("const ASSETS = [","const ASSETS = ['/src/version.mjs',");
  const v2=workerRuntime({network,stores,source:upgradedSource});await v2.lifecycle('install');await v2.lifecycle('activate');
  await old.runtime.load('/app.js');assert.equal(old.h.context.fixtureRelease,'one','Already evaluated client stays stable');listeners(old.h);
  network.online=false;
  const fresh=await boot({readSource:async id=>(await v2.fetch(id)).text()});assert.equal(fresh.h.context.fixtureRelease,'two');
  network.online=true;network.resources.delete('/src/version.mjs');network.resources.set('/app.js',originalApp);
  const rollback=workerRuntime({network,stores});await rollback.lifecycle('install');await rollback.lifecycle('activate');network.online=false;
  assert.deepEqual([...stores.keys()],[rollback.cacheName]);
  await boot({readSource:async id=>{const r=await rollback.fetch(id);assert.ok(r?.ok);return r.text();}});
  assert.equal(await rollback.fetch('/src/version.mjs'),undefined);
  network.online=true;network.resources.set('/src/version.mjs',Buffer.from('export const version="two";'));network.resources.delete('/cloud.js');
  const broken=workerRuntime({network,stores,source:upgradedSource});await assert.rejects(broken.lifecycle('install'),/Precache failed/);
  assert.ok(stores.get(rollback.cacheName).size>0,'A failed install does not erase the working shell');
}else throw Error('Unknown module gate');
console.log(JSON.stringify({scenario,passed:true}));
