import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validEndpoint,validSubscription,payload,deliveryResult} from '../supabase/functions/_shared/push-policy.mjs';
import {createCloud} from '../cloud.js';

const ID='aa000000-0000-4000-8000-000000000001',binding='a'.repeat(64);
const endpoint='https://fcm.googleapis.com/fcm/send/opaque';
const key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
const subscription={endpoint,keys:{p256dh:key,auth:Buffer.alloc(16,1).toString('base64url')}};
test('preferences adapter supports PostgREST composite response shapes without accepting a recipient parameter',async()=>{
 for(const data of [{enabled:true,posting_reminders:false},[{enabled:true,posting_reminders:false}]]){
  const api=createCloud({rpc:async(name,args)=>{assert.equal(name,'save_notification_preferences');assert.deepEqual(Object.keys(args),['p_preferences']);return {data};}});
  assert.deepEqual(await api.saveNotificationPreferences({enabled:true}),{enabled:true,posting_reminders:false});
 }
});
test('subscription validation blocks SSRF, credentials, deceptive domains, malformed keys and bindings',()=>{
 assert.equal(validSubscription(subscription,binding),true);
 for(const url of ['http://fcm.googleapis.com/fcm/send/x','https://127.0.0.1/x','https://localhost/x','https://fcm.googleapis.com.evil.test/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://fcm.googleapis.com/x#fragment','file:///x'])assert.equal(validEndpoint(url),false,url);
 assert.equal(validSubscription({...subscription,keys:{...subscription.keys,auth:'bad'}},binding),false);
 assert.equal(validSubscription(subscription,'not-a-binding'),false);
 for(const url of ['https://web.push.apple.com/opaque','https://updates.push.services.mozilla.com/wpush/v2/opaque','https://abc.notify.windows.com/w/opaque'])assert.equal(validEndpoint(url),true);
});
test('payload whitelist cannot carry private content; delivery results distinguish expiry and retry',()=>{
 const result=payload({id:ID,category:'comments',reason:'secret',body:'private comment',photo:'private.jpg'},binding);
 assert.deepEqual(Object.keys(result).sort(),['binding','category','id']);assert.doesNotMatch(JSON.stringify(result),/secret|private/);
 assert.throws(()=>payload({id:ID,category:'__proto__'},binding));
 assert.deepEqual([201,404,410,429,503,400,401].map(deliveryResult),['sent','expired','expired','retry','retry','permanent','permanent']);
});

function worker(){
 const events={},notifications=[],opened=[],acks=[];let stored=null;
 const db={createObjectStore(){},close(){},transaction(){const tx={objectStore:()=>({get:()=>({result:stored}),put:value=>{stored=value;return {};}})};queueMicrotask(()=>tx.oncomplete());return tx;}};
 const context=vm.createContext({URL,Promise,Uint8Array,queueMicrotask,
  indexedDB:{open(){const request={result:db};queueMicrotask(()=>request.onsuccess());return request;}},
  self:{location:{origin:'https://azice.test'},addEventListener:(event,fn)=>{events[event]=fn;},registration:{showNotification:async(title,options)=>{notifications.push({title,...options});}},
   clients:{matchAll:async()=>[],openWindow:async url=>{opened.push(url);}}}});
 vm.runInContext(fs.readFileSync(new URL('../push-sw.js',import.meta.url),'utf8'),context);
 const dispatch=async(type,event)=>{let done;events[type]({...event,waitUntil:promise=>{done=promise;}});await done;};
 const bind=value=>dispatch('message',{source:{url:'https://azice.test/'},data:{type:'azice-push-binding',binding:value},ports:[{postMessage:v=>acks.push(v)}]});
 return {dispatch,bind,notifications,opened,acks};
}
test('service worker requires consent binding, uses generic lock-screen text, and clears stale-account pushes',async()=>{
 const w=worker(),send=data=>w.dispatch('push',{data:{json:()=>data}});
 await send({id:ID,category:'comments',binding});assert.equal(w.notifications.length,0);
 await w.bind(binding);await send({id:ID,category:'comments',binding,body:'PRIVATE COMMENT',reason:'SECRET'});
 assert.equal(w.notifications.length,1);assert.equal(w.notifications[0].body,'There is new activity on your post.');
 assert.doesNotMatch(JSON.stringify(w.notifications),/PRIVATE|SECRET/);
 await w.bind(null);await send({id:ID,category:'comments',binding});assert.equal(w.notifications.length,1);
 await w.bind('b'.repeat(64));await send({id:ID,category:'comments',binding});assert.equal(w.notifications.length,1);
 await send({id:ID,category:'__proto__',binding:'b'.repeat(64)});assert.equal(w.notifications.length,1);
});
test('push taps open only the same-origin opaque route, with binding rechecked',async()=>{
 const w=worker();let closed=0;
 const click=()=>w.dispatch('notificationclick',{notification:{data:{id:ID,binding,url:'https://evil.test/private'},close(){closed++;}}});
 await w.bind(binding);await click();assert.deepEqual(w.opened,['https://azice.test/?notification='+ID]);
 await w.bind(null);await click();assert.equal(w.opened.length,1);assert.equal(closed,2);
});

function app({storage=new Map(),now=Date.now(),standalone=true}={}){
 const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
 const session=new Map(),events={},root={},toast={},bindings=[],calls=[],dialogs=[],timers=new Map(),gestures=[];let sub=null,permission='default',asks=0,timerId=0,inClick=false;
 class ClockDate extends Date{static now(){return now;}}
 const document={visibilityState:'visible',activeElement:{isConnected:true,focus(){}},body:{append:dialog=>dialogs.push(dialog)},
  querySelector:s=>s==='#app'?root:s==='#toast'?toast:s.startsWith('dialog')?document.blockingDialog||dialogs.find(d=>d.open)||null:null,
  querySelectorAll:()=>[],addEventListener:(e,f)=>{events[e]=f;},
  createElement:()=>{
   const listeners={},dialog={open:false,innerHTML:'',setAttribute(){},querySelector:()=>({focus(){}}),
    addEventListener:(event,fn)=>{listeners[event]=fn;},showModal(){this.open=true;},close(){if(!this.open)return;this.open=false;listeners.close?.();},remove(){dialogs.splice(dialogs.indexOf(this),1);},
    click(choice){inClick=true;try{listeners.click({target:{closest:()=>({dataset:{choice}})}});}finally{inClick=false;}}};return dialog;
  }};
 const reg={active:{postMessage(data,ports){bindings.push(data.binding);ports[0].peer.onmessage();}},pushManager:{getSubscription:async()=>sub,subscribe:async options=>{calls.push(options);sub={endpoint,toJSON:()=>subscription,unsubscribe:async()=>{sub=null;}};return sub;}}};
 const api={mode:'cloud',getUser:async()=>({id:ID}),getMyProfile:async()=>({id:ID,display_name:'Test',username:'test'}),saveProfile:async p=>({id:ID,...p}),getHistory:async()=>[],getFeed:async()=>[],getInvite:async()=>'token',friendData:async()=>({friends:[],incoming:[],outgoing:[]}),getNotificationPreferences:async()=>null,saveNotificationPreferences:async p=>({enabled:false,posting_reminders:false,...p}),pushSubscription:async body=>calls.push(body),resolveNotification:async()=>null};
 const Notification={get permission(){return permission;},requestPermission:async()=>{asks++;gestures.push(inClick);return permission='granted';}};
 class Channel{constructor(){this.port1={close(){}};this.port2={peer:this.port1};}}
 const context=vm.createContext({URLSearchParams,Map,Set,Date:ClockDate,Intl,crypto,Uint8Array,atob,console,MessageChannel:Channel,Notification,
  navigator:{userAgent:'Android Chrome',serviceWorker:{register:async()=>reg,getRegistration:async()=>reg}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},
  location:{search:'',pathname:'/',protocol:'https:',origin:'https://azice.test'},history:{replaceState(){}},
  FormData:class{constructor(form){return Object.entries(form.values);}},
  setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),document,
  window:{AZICE_CONFIG:{pushPublicKey:key},Notification,PushManager:class{},matchMedia:()=>({matches:standalone}),addEventListener(){},scrollTo(){}}});
 vm.runInContext(source+'\nglobalThis.testApp={state,setCurrentUser,enablePush,forgetPushDevice,syncPushAccount,openNotification,notificationsSection,notificationsView,openNotifications,handleAction,pushDefaults,boot,home,loadPushSettings,pushInvitationEligible,schedulePushInvitation,installEligible,scheduleInstall,profileView,setApi:v=>{api=v;}};',context);
 const a=context.testApp;a.setApi(api);a.setCurrentUser({id:ID});a.state.profile={id:ID,display_name:'Test'};a.state.view='feed';
 return {a,api,context,session,storage,bindings,calls,toast,root,events,dialogs,gestures,timers,advance:ms=>{now+=ms;},
  fire:delay=>{const entry=[...timers].find(([,timer])=>timer.delay===delay);assert.ok(entry,'Expected scheduled invitation');timers.delete(entry[0]);return entry[1].fn();},get asks(){return asks;}};
}
test('permission is never requested by load or preferences; explicit enable and disable manage this device',async()=>{
 const h=app();await Promise.resolve();assert.equal(h.asks,0);assert.equal(h.a.pushDefaults().posting_reminders,false);
 const markup=h.a.notificationsView();assert.match(markup,/Notifications/);assert.equal((markup.match(/data-push-category=/g)||[]).length,5);
 await h.a.enablePush();assert.equal(h.asks,1);assert.ok(h.storage.get('azice_push_device'));assert.equal(h.calls.at(-1).action,'subscribe');assert.equal(h.bindings.at(-1).length,64);
 const record=JSON.parse(h.storage.get('azice_push_device'));record.renewAfter=0;h.storage.set('azice_push_device',JSON.stringify(record));
 await h.a.syncPushAccount(h.a.state.user);assert.equal(h.asks,1);assert.ok(JSON.parse(h.storage.get('azice_push_device')).renewAfter>Date.now());
 await h.a.forgetPushDevice();assert.equal(h.storage.has('azice_push_device'),false);assert.equal(h.bindings.at(-1),null);assert.equal(h.calls.at(-1).action,'unsubscribe');
});
test('iPhone requires installation before permission; account change during permission cannot register',async()=>{
 const h=app({standalone:false});h.context.navigator.userAgent='iPhone Safari';await assert.rejects(h.a.enablePush(),/Home Screen/);assert.equal(h.asks,0);
 h.context.navigator.userAgent='Android';let resolve;h.context.Notification.requestPermission=()=>new Promise(r=>{resolve=r;});
 const enabling=h.a.enablePush();h.a.setCurrentUser({id:'another-account'});resolve('granted');await enabling;
 assert.equal(h.calls.length,0);assert.equal(h.storage.has('azice_push_device'),false);
});
test('notification navigation rechecks authenticated target and RLS post fetch; stale accounts cannot open it',async()=>{
 const h=app();h.session.set('azice_notification',ID);await h.a.openNotification();assert.equal(h.a.state.view,'feed');assert.match(h.toast.textContent,/no longer available/);
 h.api.resolveNotification=async()=>({screen:'friends'});h.session.set('azice_notification',ID);await h.a.openNotification();assert.equal(h.a.state.view,'friends');
 h.api.resolveNotification=async()=>({screen:'post',post_id:ID});h.api.getPost=async()=>null;h.a.state.view='feed';h.session.set('azice_notification',ID);await h.a.openNotification();assert.equal(h.a.state.view,'feed');
 h.api.getPost=async()=>({id:ID,author_id:ID,author:{display_name:'Owner'},published_at:new Date().toISOString(),kind:'sober',reason:'Authorized post',post_photos:[],comments:[],reactions:[]});
 h.session.set('azice_notification',ID);await h.a.openNotification();assert.equal(h.a.state.view,'post');assert.match(h.root.innerHTML,/Authorized post/);
 h.a.state.view='feed';
 let resolve;h.api.resolveNotification=()=>new Promise(r=>{resolve=r;});h.session.set('azice_notification',ID);const opening=h.a.openNotification();h.a.setCurrentUser({id:'b'});resolve({screen:'friends'});await opening;assert.equal(h.a.state.view,'feed');
});

test('new and existing users get one notification invitation in installed Android and iPhone PWAs without a permission prompt',async()=>{
 for(const platform of ['Android','iPhone'])for(const entry of ['existing','onboarding']){
  const h=app();
  if(platform==='iPhone'){h.context.navigator.userAgent='iPhone Safari';h.context.navigator.standalone=true;h.context.window.matchMedia=()=>({matches:false});}
  if(entry==='existing')await h.a.boot();
  else{
   h.a.state.profile=null;h.a.state.view='onboard';
   await h.events.submit({preventDefault(){},target:{id:'onboard-form',values:{display_name:'Test',username:'test_user',adult:'on'}}});
  }
  assert.equal(h.a.state.view,'feed');assert.equal(h.asks,0);
  h.a.schedulePushInvitation();assert.equal([...h.timers.values()].filter(t=>t.delay===1500).length,1);
  const showing=h.fire(1500),dialog=h.dialogs[0];
  assert.equal(dialog.className,'azice-confirm');assert.match(dialog.innerHTML,/Stay in the loop!/);
  assert.match(dialog.innerHTML,/Get notified when friends post, comment, react, or send you friend requests\./);
  assert.match(dialog.innerHTML,/>Enable Notifications<\/button>/);assert.match(dialog.innerHTML,/>Maybe Later<\/button>/);assert.equal(h.asks,0);
  dialog.click('cancel');await showing;
  const profile=h.a.profileView();assert.equal((profile.match(/class="notifications-entry"/g)||[]).length,1);
  assert.ok(profile.indexOf('My Calendar')<profile.indexOf('class="notifications-entry"'));
  assert.ok(profile.indexOf('class="notifications-entry"')<profile.indexOf('Recent Posts'));
  assert.match(profile,/Manage your alerts/);assert.match(profile,/class="notifications-chevron"/);
  assert.doesNotMatch(profile,/data-push-category=|data-action="push-enable"|data-action="push-disable"/);
 }
});

test('invitation requires configured support and known disabled preferences, and defers to protected screens and overlays',async()=>{
 const h=app();assert.equal(h.a.pushInvitationEligible(),false);await h.a.loadPushSettings();assert.equal(h.a.pushInvitationEligible(),true);
 h.context.window.AZICE_CONFIG.pushPublicKey='';assert.equal(h.a.pushInvitationEligible(),false);h.context.window.AZICE_CONFIG.pushPublicKey=key;
 delete h.context.window.PushManager;assert.equal(h.a.pushInvitationEligible(),false);h.context.window.PushManager=class{};
 for(const view of ['auth','onboard','loading','new','camera','profile','friends','notifications']){h.a.state.view=view;assert.equal(h.a.pushInvitationEligible(),false,view);}
 h.a.state.view='feed';h.context.document.visibilityState='hidden';assert.equal(h.a.pushInvitationEligible(),false);h.context.document.visibilityState='visible';
 h.context.document.blockingDialog={};assert.equal(h.a.pushInvitationEligible(),false);h.context.document.blockingDialog=null;
 for(const overlay of ['photoViewer','installNudgeDialog']){
  vm.runInContext(overlay+'={};',h.context);assert.equal(h.a.pushInvitationEligible(),false);vm.runInContext(overlay+'=null;',h.context);
 }
 h.a.state.cameraStream={};assert.equal(h.a.pushInvitationEligible(),false);h.a.state.cameraStream=null;
 h.storage.set('azice_push_device',JSON.stringify({owner:ID}));assert.equal(h.a.pushInvitationEligible(),false);h.storage.delete('azice_push_device');
 h.api.getNotificationPreferences=async()=>({enabled:true,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});await h.a.loadPushSettings();assert.equal(h.a.pushInvitationEligible(),false);
 h.api.getNotificationPreferences=async()=>{throw Error('Offline');};await h.a.loadPushSettings();assert.equal(h.a.pushInvitationEligible(),false);
 h.api.getNotificationPreferences=async()=>null;await h.a.loadPushSettings();h.a.schedulePushInvitation();
 h.context.document.blockingDialog={};await h.fire(1500);assert.equal(h.dialogs.length,0);h.context.document.blockingDialog=null;
 h.a.schedulePushInvitation();h.a.setCurrentUser({id:'another'});assert.equal([...h.timers.values()].filter(t=>t.delay===1500).length,0);
 assert.equal(h.a.pushInvitationEligible(),false);assert.equal(h.asks,0);
});

test('Maybe Later persists exactly two days per account across reloads; switching accounts closes the invitation safely',async()=>{
 const now=Date.now(),storage=new Map(),h=app({storage,now});await h.a.home();const showing=h.fire(1500);h.dialogs[0].click('cancel');await showing;
 assert.equal(Number(storage.get('azice_push_invite_after:'+ID)),now+2*86400000);
 const reload=app({storage,now:now+2*86400000-1});await reload.a.home();assert.equal(reload.a.pushInvitationEligible(),false);
 reload.advance(1);assert.equal(reload.a.pushInvitationEligible(),true);
 h.a.setCurrentUser({id:'another'});h.a.state.profile={display_name:'Another'};await h.a.home();assert.equal(h.a.pushInvitationEligible(),true);
 const another=h.fire(1500);assert.equal(h.dialogs.length,1);h.a.setCurrentUser(null);await another;
 assert.equal(h.dialogs.length,0);assert.equal(storage.has('azice_push_invite_after:another'),false);assert.equal(h.asks,0);
});

test('Enable invokes the existing flow during the direct click; browser iPhone guidance stays in permanent settings',async()=>{
 const h=app();await h.a.home();const showing=h.fire(1500);assert.equal(h.asks,0);
 h.dialogs[0].click('accept');assert.equal(h.asks,1);assert.deepEqual(h.gestures,[true]);await showing;await new Promise(r=>setImmediate(r));
 assert.equal(h.calls.filter(c=>c.action==='subscribe').length,1);assert.match(h.a.notificationsSection(),/Disable Notifications/);assert.equal(h.a.pushInvitationEligible(),false);
 const ios=app({standalone:false});ios.context.navigator.userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) Version/17.6 Mobile Safari/604.1';
 delete ios.context.window.Notification;delete ios.context.window.PushManager;
 await ios.a.home();assert.equal([...ios.timers.values()].some(t=>t.delay===1500),false);
 assert.match(ios.a.notificationsView(),/Share → Add to Home Screen/);
 assert.equal(ios.asks,0);assert.equal(ios.calls.length,0);
 assert.equal(ios.a.pushInvitationEligible(),false);
});

test('compact Profile entry opens Notifications and its Back action returns to Profile; stale accounts cannot open it',async()=>{
 const h=app();h.a.state.view='profile';
 await h.a.handleAction({dataset:{action:'notifications'}});assert.equal(h.a.state.view,'notifications');assert.equal(h.asks,0);
 assert.match(h.root.innerHTML,/<h1 id="notifications-title" tabindex="-1">Notifications<\/h1>/);
 assert.match(h.root.innerHTML,/class="nav-item selected" data-action="profile"/);
 const back=h.root.innerHTML.match(/class="icon-btn" data-action="([^"]+)" aria-label="Back"/)[1];assert.equal(back,'profile');
 await h.a.handleAction({dataset:{action:back}});assert.equal(h.a.state.view,'profile');assert.match(h.root.innerHTML,/Manage your alerts/);
 let resolve;h.api.getNotificationPreferences=()=>new Promise(r=>{resolve=r;});const opening=h.a.openNotifications();
 h.a.setCurrentUser({id:'other'});h.a.state.view='loading';resolve({enabled:true});await opening;assert.equal(h.a.state.view,'loading');
});

test('permanent browser settings preserve enable/disable lifecycle, device status and account-scoped activation',async()=>{
 const h=app({standalone:false});await h.a.openNotifications();assert.match(h.root.innerHTML,/Not enabled on this device/);
 assert.match(h.root.innerHTML,/>Enable on this device<\/button>/);assert.doesNotMatch(h.root.innerHTML,/data-action="push-disable"/);
 await h.a.handleAction({dataset:{action:'push-enable'}});assert.equal(h.asks,1);
 assert.match(h.root.innerHTML,/Enabled on this device/);assert.doesNotMatch(h.root.innerHTML,/data-action="push-enable"/);
 assert.match(h.root.innerHTML,/class="secondary notification-disable"/);
 h.storage.set('azice_push_device',JSON.stringify({owner:'other'}));assert.match(h.a.notificationsView(),/Not enabled on this device/);
 assert.match(h.a.notificationsView(),/data-action="push-enable"/);
 h.storage.delete('azice_push_device');await h.a.handleAction({dataset:{action:'push-disable'}});
 assert.match(h.root.innerHTML,/Not enabled on this device/);assert.doesNotMatch(h.root.innerHTML,/data-action="push-disable"/);
 Object.defineProperty(h.context.Notification,'permission',{value:'denied'});assert.match(h.a.notificationsView(),/blocked in browser settings/);
 h.context.navigator.userAgent='iPhone Safari';assert.match(h.a.notificationsView(),/Share → Add to Home Screen/);
});

test('five native switch rows preserve category saving, reminder defaults, delivery timing and failed-save rollback',async()=>{
 const h=app();await h.a.openNotifications();
 const markup=h.root.innerHTML;assert.equal((markup.match(/role="switch"/g)||[]).length,5);
 assert.equal((markup.match(/class="notification-switch-row"/g)||[]).length,5);
 assert.match(markup,/role="group" aria-label="Notification preferences"/);assert.doesNotMatch(markup,/<fieldset|<legend|Notification categories/);
 assert.equal((markup.match(/<label class="notification-switch-row">[\s\S]*?<input type="checkbox" role="switch"/g)||[]).length,5);
 assert.doesNotMatch(markup.match(/<input[^>]+data-push-category="posting_reminders"[^>]*>/)[0],/checked/);
 assert.match(markup,/Notifications can arrive anytime/);assert.match(markup,/device’s Do Not Disturb/);assert.match(markup,/Optional posting reminders arrive around 8 PM/);assert.doesNotMatch(markup,/Quiet hours/);assert.match(markup,/Optional · off by default/);
 let saved;h.api.saveNotificationPreferences=async p=>{saved=p;return {...h.a.pushDefaults(),...p};};
 const input={dataset:{pushCategory:'posting_reminders'},checked:true};await h.events.change({target:input});
 assert.equal(saved.posting_reminders,true);assert.match(h.a.notificationsView(),/data-push-category="posting_reminders" checked/);assert.equal(h.asks,0);
 h.api.saveNotificationPreferences=async()=>{throw Error('Offline');};input.checked=false;await h.events.change({target:input});assert.equal(input.checked,true);
});

test('compact notification group keeps each native switch disabled when configuration is missing',()=>{
 const h=app();h.context.window.AZICE_CONFIG.pushPublicKey='';const markup=h.a.notificationsView();
 assert.match(markup,/role="group" aria-label="Notification preferences" aria-disabled="true"/);
 const inputs=markup.match(/<input[^>]+data-push-category[^>]*>/g);assert.equal(inputs.length,5);
 for(const input of inputs)assert.match(input,/\bdisabled\b/);
});

test('regular browser tabs show only installation when eligible; standalone Android and iOS never show installation',async()=>{
 for(const browser of ['Android Chrome','iPhone Safari','Android Firefox']){
  const h=app({standalone:false});h.context.navigator.userAgent=browser;
  if(browser==='Android Chrome')h.a.state.installPrompt={};
  await h.a.home();assert.equal(h.a.pushInvitationEligible(),false);assert.equal([...h.timers.values()].some(t=>t.delay===1500),false);
  if(browser!=='Android Firefox'){
   assert.equal(h.a.installEligible(),true);const showing=h.fire(8000);assert.match(h.dialogs[0].innerHTML,/Get AziCe\? on your phone/);
   h.dialogs[0].click('cancel');await showing;assert.equal([...h.timers.values()].some(t=>t.delay===1500),false);
  }else assert.equal(h.a.installEligible(),false);
  assert.equal(h.asks,0);
 }
 for(const ios of [false,true]){
  const h=app({standalone:!ios});if(ios){h.context.navigator.userAgent='iPhone Safari';h.context.navigator.standalone=true;}
  h.a.state.installPrompt={};await h.a.home();assert.equal(h.a.installEligible(),false);
  assert.equal([...h.timers.values()].some(t=>t.delay===8000),false);assert.equal(h.a.pushInvitationEligible(),true);assert.equal(h.asks,0);
 }
});

test('notification invitation waits for pending friend invitation completion after onboarding and returning login',async()=>{
 for(const entry of ['onboarding','existing']){
  const h=app();h.session.set('azice_pending_invite','friend-token');let resolve;
  h.api.previewInvite=()=>new Promise(r=>{resolve=r;});
  h.a.state.profile=null;h.a.state.view=entry==='onboarding'?'onboard':'loading';
  const entering=entry==='onboarding'?h.events.submit({preventDefault(){},target:{id:'onboard-form',values:{display_name:'Test',username:'test_user',adult:'on'}}}):h.a.boot();
  await new Promise(r=>setImmediate(r));assert.equal(typeof resolve,'function');
  assert.equal([...h.timers.values()].some(t=>[1500,8000].includes(t.delay)),false);assert.equal(h.a.pushInvitationEligible(),false);
  resolve({display_name:'Friend',username:'friend'});await entering;assert.equal(h.a.state.view,'invite');assert.equal(h.asks,0);
  await h.a.handleAction({dataset:{action:'dismiss-invite'}});assert.equal(h.a.state.view,'feed');assert.equal(h.session.has('azice_pending_invite'),false);
  const showing=h.fire(1500);assert.match(h.dialogs[0].innerHTML,/Stay in the loop!/);assert.equal(h.asks,0);h.dialogs[0].click('cancel');await showing;
 }
});

test('queued invitations recheck installed mode before opening',async()=>{
 const h=app();await h.a.home();h.context.window.matchMedia=()=>({matches:false});await h.fire(1500);assert.equal(h.dialogs.length,0);
 h.a.state.installPrompt={};h.a.scheduleInstall();h.context.navigator.standalone=true;await h.fire(8000);
 assert.equal(h.dialogs.length,0);assert.equal(h.asks,0);
});
