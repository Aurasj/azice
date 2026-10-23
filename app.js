import { createDemo } from './demo.js';
import { createCloud, isSessionMissingOrInvalid } from './cloud.js';
const $ = s => document.querySelector(s);
const config = window.AZICE_CONFIG || {};
const incomingInvite = new URLSearchParams(location.search).get('invite');
if (incomingInvite) sessionStorage.setItem('azice_pending_invite', incomingInvite);
const savedInvite = () => sessionStorage.getItem('azice_pending_invite');
const cloudEnabled = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const HOUR = 3600000, DAY = 86400000;
const EMOJI = ['😂','❤️','😮','🔥','👏'];
const USERNAME_FORMAT_MESSAGE='Use 3–24 lowercase letters, numbers or underscores.';
function validateUsername(username){
 if(!/^[a-z0-9_]{3,24}$/.test(username))throw Error(USERNAME_FORMAT_MESSAGE);
 return username;
}
function profileErrorMessage(error){
 // PostgREST includes the constraint name in message; direct PG errors may expose it separately.
 const constraint=error.constraint||error.message?.match(/constraint "([^"]+)"/)?.[1];
 if(error.code==='23505'&&constraint==='profiles_username_key')return 'This username is already taken.';
 if(error.code==='23514'&&constraint==='profiles_username_check')return USERNAME_FORMAT_MESSAGE;
 return error.message||'Could not save.';
}
const SUGGEST = {
  drank: ["It's a special occasion. Don't ask whose.", "I only came for water. Things escalated.", "My dog had a birthday party. 🐶", "A small victory deserves a story."],
  sober: ["Tea and an early night. ☕", "I'm under the weather today. 🤧", "Just didn't feel like it.", "Big plans tomorrow. Staying fresh!"]
};
const state = {
  view:'loading', user:null, profile:null, friends:{friends:[],incoming:[],outgoing:[]}, friendsLoaded:false,
  feed:[], history:[], month:new Date(), selectedDate:'', target:null, inviteToken:null,
  activeComments:new Set(), activeReactions:null, authSignUp:false,
  draft:{kind:'drank',reason:'',files:[],step:0},
  cameraStream:null, cameraError:null, installPrompt:null, installHelp:false,
  cache:new Map(), demo:false
};
let api;
const PUSH_CATEGORIES={friend_requests:'Friend requests',new_posts:'New posts',comments:'Comments',reactions:'Reactions',posting_reminders:'Posting reminders (optional)'};
const pushDefaults=()=>({enabled:false,friend_requests:true,new_posts:true,comments:true,reactions:true,posting_reminders:false});
let pushSettings=pushDefaults(),pushSettingsLoaded=false,pushBusy=false,pushSync=Promise.resolve(),pendingNotification=new URLSearchParams(location.search).get('notification');
let pushInviteTimer=null,pushInviteDialog=null;
const pushInviteDismissed=new Map();
if(pendingNotification&&/^[a-f0-9-]{36}$/i.test(pendingNotification))sessionStorage.setItem('azice_notification',pendingNotification);
function localPush(){try{return JSON.parse(localStorage.getItem('azice_push_device')||'null');}catch{return null;}}
async function writePushBinding(binding,version=accountVersion){
 if(!navigator.serviceWorker)return;
 const registration=await navigator.serviceWorker.getRegistration();if(!registration?.active||version!==accountVersion)return;
 await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('Notification setup timed out.')),5000);
  channel.port1.onmessage=()=>{clearTimeout(timer);channel.port1.close();resolve();};
  registration.active.postMessage({type:'azice-push-binding',binding},[channel.port2]);});
}
async function syncPushAccount(user){
 if(!navigator.serviceWorker)return;
 const version=accountVersion,record=localPush();
 if(!record&&!config.pushPublicKey)return;
 if(record&&record.owner===user?.id&&config.pushPublicKey){
  const registration=await navigator.serviceWorker.getRegistration();if(version!==accountVersion)return;
  const sub=await registration?.pushManager?.getSubscription();if(version!==accountVersion)return;
  if(sub&&sub.endpoint===record.endpoint&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
   try{
    if((record.renewAfter||0)<=Date.now()){
     await api.pushSubscription({action:'subscribe',subscription:sub.toJSON(),binding:record.binding});if(version!==accountVersion)return;
     record.renewAfter=Date.now()+30*DAY;localStorage.setItem('azice_push_device',JSON.stringify(record));
    }
    await writePushBinding(record.binding,version);return;
   }catch{if(version!==accountVersion)return;}
  }
 }
 try{localStorage.removeItem('azice_push_device');}catch{}
 await writePushBinding(null,version);
 if(version!==accountVersion)return;
 const registration=await navigator.serviceWorker.getRegistration();if(version!==accountVersion||!registration)return;
 const sub=await registration.pushManager?.getSubscription();if(version===accountVersion)await sub?.unsubscribe();
}
async function forgetPushDevice(){
 const version=accountVersion,record=localPush();try{localStorage.removeItem('azice_push_device');}catch{}
 await writePushBinding(null,version).catch(()=>{});if(version!==accountVersion)return;
 try{if(navigator.serviceWorker){const registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager?.getSubscription();if(version!==accountVersion)return;await sub?.unsubscribe();}}catch{/* Local cleanup must not prevent logout. */}
 if(record?.owner===state.user?.id&&api.pushSubscription)await api.pushSubscription({action:'unsubscribe',endpoint:record.endpoint}).catch(()=>{});
}
async function loadPushSettings(){
 if(!config.pushPublicKey||!api.getNotificationPreferences)return;
 pushSettingsLoaded=false;
 const version=accountVersion;
 try{const settings=await api.getNotificationPreferences();if(version!==accountVersion)return;pushSettings=settings||pushDefaults();
  if(!pushSettings.enabled&&localPush()?.owner===state.user?.id){await forgetPushDevice();if(version!==accountVersion)return;}
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  if(settings?.enabled&&settings.timezone!==zone){const updated=await api.saveNotificationPreferences({timezone:zone});if(version===accountVersion)pushSettings=updated;}
  if(version===accountVersion)pushSettingsLoaded=true;
 }catch{if(version===accountVersion)pushSettings=pushDefaults();}
}
function pushInvitationEligible(){
 if(!config.pushPublicKey||!api?.pushSubscription||!api?.saveNotificationPreferences||!pushSettingsLoaded||pushSettings.enabled||pushBusy||!state.user||!state.profile||state.view!=='feed')return false;
 const ua=navigator.userAgent||'',ios=/iPhone|iPad/i.test(ua),version=ua.match(/OS (\d+)[_.](\d+)/);
 // Safari exposes Push APIs only after installation; offer installation guidance on supported iOS.
 const iosInstall=ios&&!installed()&&/Safari/i.test(ua)&&version&&(Number(version[1])>16||Number(version[1])===16&&Number(version[2])>=4);
 if(!navigator.serviceWorker||!(('Notification' in window&&'PushManager' in window)||iosInstall)||typeof Notification!=='undefined'&&Notification.permission==='denied'||localPush()?.owner===state.user.id)return false;
 let until=pushInviteDismissed.get(state.user.id)||0;try{until=Math.max(until,Number(localStorage.getItem('azice_push_invite_after:'+state.user.id))||0);}catch{}
 return Date.now()>=until&&document.visibilityState!=='hidden'&&!photoViewer&&!state.cameraStream&&!installNudgeDialog&&!pushInviteDialog&&!document.querySelector('dialog[open],.modal-backdrop');
}
function schedulePushInvitation(){
 if(pushInviteTimer||!pushInvitationEligible())return;
 const account=accountVersion,owner=state.user.id;
 pushInviteTimer=setTimeout(async()=>{
  pushInviteTimer=null;if(account!==accountVersion||!pushInvitationEligible())return;
  const ios=/iPhone|iPad/i.test(navigator.userAgent||'')&&!installed();
  const choice=confirmInApp("Get notified when friends post, comment, react, or send you friend requests."+(ios?' On iPhone, use Safari’s Share → Add to Home Screen, then open the installed app to enable notifications.':''),{
   title:'Stay in the loop!',action:'Enable Notifications',cancel:'Maybe Later',
   onAccept:()=>{
    if(account!==accountVersion)return;
    // Keep the permission call in the button's click handler, preserving browser user activation.
    enablePush().catch(error=>{if(account===accountVersion)showToast(error.message||'Could not enable notifications.');}).finally(()=>{if(account===accountVersion)scheduleInstall();});
   }
  });
  const dialog=$('dialog.azice-confirm[open]');pushInviteDialog=dialog;
  await choice;if(pushInviteDialog===dialog)pushInviteDialog=null;
  if(account!==accountVersion)return;
  const until=Date.now()+2*DAY;pushInviteDismissed.set(owner,until);try{localStorage.setItem('azice_push_invite_after:'+owner,String(until));}catch{}
  scheduleInstall();
 },1500);
}
function notificationsSection(){
 const configured=Boolean(config.pushPublicKey&&api?.saveNotificationPreferences);
 const ios=/iPhone|iPad/i.test(navigator.userAgent||'');
 const note=!configured?'Notifications are not configured yet.':ios&&!installed()?'On iPhone, use Share → Add to Home Screen, then open the installed app to enable notifications.':'Quiet hours: 10 PM–9 AM. Friend requests can arrive anytime. Reminders are off by default.';
 return `<section class="notifications-section" aria-labelledby="notifications-title"><h2 id="notifications-title">Notifications</h2><p class="muted small-text">${note}</p><div class="button-pair">${pushSettings.enabled?'<button type="button" class="secondary" data-action="push-disable">Disable Notifications</button>':''}${!pushSettings.enabled||localPush()?.owner!==state.user?.id?`<button type="button" class="primary" data-action="push-enable" ${!configured||pushBusy?'disabled':''}>${pushSettings.enabled?'Enable on this device':'Enable Notifications'}</button>`:''}</div><fieldset ${!configured||pushBusy?'disabled':''}><legend class="small-text">Notification categories</legend>${Object.entries(PUSH_CATEGORIES).map(([key,label])=>`<label class="checkline"><input type="checkbox" data-push-category="${key}" ${pushSettings[key]?'checked':''}>${label}</label>`).join('')}</fieldset></section>`;
}
async function enablePush(){
 if(pushBusy)return;
 if(!config.pushPublicKey||!api.pushSubscription)throw Error('Notifications are not configured yet.');
 if(/iPhone|iPad/i.test(navigator.userAgent||'')&&!installed())throw Error('On iPhone, add AziCe? to your Home Screen and open it there first.');
 if(!('Notification' in window)||!('PushManager' in window)||!navigator.serviceWorker)throw Error('Web Push is unavailable in this browser.');
 const version=accountVersion,owner=state.user?.id;if(!owner)return;pushBusy=true;
 let sub;
 try{
  // Called only from an explicit button action, before any network request.
  const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
  if(permission!=='granted')throw Error('Notifications are blocked. You can change this in your browser settings.');
  await pushSync;
  if(version!==accountVersion)return;
  const registration=await navigator.serviceWorker.getRegistration();if(version!==accountVersion)return;if(!registration?.active)throw Error('Please reload the app before enabling notifications.');
  const key=Uint8Array.from(atob(config.pushPublicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  if(version!==accountVersion){await sub.unsubscribe();return;}
  const binding=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const settings=await api.saveNotificationPreferences({...pushSettings,enabled:true,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
  if(version!==accountVersion){await sub.unsubscribe();return;}
  await api.pushSubscription({action:'subscribe',subscription:sub.toJSON(),binding});
  if(version!==accountVersion){await sub.unsubscribe();return;}
  localStorage.setItem('azice_push_device',JSON.stringify({owner,binding,endpoint:sub.endpoint,renewAfter:Date.now()+30*DAY}));await writePushBinding(binding,version);
  if(version!==accountVersion){await sub.unsubscribe();return;}pushSettings=settings;showToast('Notifications enabled.');
 }catch(error){await sub?.unsubscribe().catch(()=>{});if(version===accountVersion)await writePushBinding(null,version).catch(()=>{});throw error;}
 finally{if(version===accountVersion){pushBusy=false;if(state.view==='profile')render();}}
}
async function openNotification(){
 const id=sessionStorage.getItem('azice_notification');if(!id||!api.resolveNotification)return;
 sessionStorage.removeItem('azice_notification');const version=accountVersion;
 history.replaceState({},'',location.pathname);
 try{const target=await api.resolveNotification(id);if(version!==accountVersion)return;
  if(target?.screen==='friends'){await openFriends();return;}
  if(target?.screen==='post'){
   const post=await api.getPost(target.post_id);if(version!==accountVersion)return;
   if(post){state.openedPost=(await hydrate([post]))[0];if(version!==accountVersion)return;state.view='post';render();return;}
  }else if(target?.screen==='feed')return;
  showToast('This update is no longer available.');
 }catch{if(version===accountVersion)showToast('This update is no longer available.');}
}
const draftPhotoURLs=new Map(), imageLoads=new Map();
let photoViewer=null, photoViewerSequence=0, photoCacheVersion=0;
const revokePhotoURL=url=>{if(typeof url==='string'&&url.startsWith('blob:'))URL.revokeObjectURL(url);};
function draftPhotoURL(file){if(!draftPhotoURLs.has(file))draftPhotoURLs.set(file,URL.createObjectURL(file));return draftPhotoURLs.get(file);}
function cleanDraftPhotoURLs(){for(const [file,url] of draftPhotoURLs)if(!state.draft.files.includes(file)){revokePhotoURL(url);draftPhotoURLs.delete(file);}}
function clearPhotoCache(){photoCacheVersion++;for(const url of state.cache.values())revokePhotoURL(url);state.cache.clear();imageLoads.clear();}
// Share authenticated downloads between thumbnails and the viewer; retain only a bounded session cache.
async function privatePhotoURL(path){
 if(path.startsWith('blob:')||path.startsWith('data:'))return path;
 if(state.cache.has(path))return state.cache.get(path);
 if(imageLoads.has(path))return imageLoads.get(path);
 const account=accountVersion, cacheVersion=photoCacheVersion;
 const loading=api.imageUrl(path).then(url=>{
  if(account!==accountVersion||cacheVersion!==photoCacheVersion){revokePhotoURL(url);throw Error('Photo unavailable.');}
  state.cache.set(path,url);
  if(state.cache.size>32){const oldest=[...state.cache.keys()].find(key=>key!==photoViewer?.path);if(oldest){revokePhotoURL(state.cache.get(oldest));state.cache.delete(oldest);}}
  return url;
 }).finally(()=>{if(imageLoads.get(path)===loading)imageLoads.delete(path);});
 imageLoads.set(path,loading);return loading;
}
function closePhotoViewer(goBack=true){
 const viewer=photoViewer;if(!viewer)return;
 photoViewer=null;viewer.dialog.close();viewer.dialog.remove();document.body.style.overflow=viewer.overflow;
 if(viewer.focus?.isConnected)viewer.focus.focus();
 if(goBack&&history.state?.azicePhoto===viewer.id)history.back();
}
async function openPhotoViewer(path){
 closePhotoViewer(false);
 const dialog=document.createElement('dialog'),id=++photoViewerSequence;
 dialog.className='full-photo-viewer';dialog.setAttribute('aria-label','Full photo');
 dialog.innerHTML='<button type="button" class="viewer-close" aria-label="Close full photo">×</button><p role="status">Loading photo...</p><img alt="Full uncropped photo" hidden>';
 const viewer={dialog,id,path,focus:document.activeElement,overflow:document.body.style.overflow};photoViewer=viewer;
 dialog.querySelector('button').addEventListener('click',()=>closePhotoViewer());
 dialog.addEventListener('cancel',event=>{event.preventDefault();closePhotoViewer();});
 document.body.append(dialog);document.body.style.overflow='hidden';dialog.showModal();dialog.querySelector('button').focus();
 history.pushState({...history.state,azicePhoto:id},'');
 try{const url=await privatePhotoURL(path);if(photoViewer!==viewer)return;const img=dialog.querySelector('img');img.onload=()=>{if(photoViewer===viewer)dialog.querySelector('p').hidden=true;};img.onerror=()=>{if(photoViewer===viewer)dialog.querySelector('p').textContent='Photo unavailable.';};img.src=url;img.hidden=false;}
 catch{if(photoViewer===viewer)dialog.querySelector('p').textContent='Photo unavailable.';}
}
let commentCard=null, commentCardVersion=0;
let accountVersion=0, friendRefreshVersion=0, returnRefresh=null, authSubscription=null;
let seenIncoming=null, installTimer=null, installNudgeDialog=null, installDismissedUntil=0;
const INSTALL_REMINDER=30*DAY;
function installed(){return Boolean(navigator.standalone||window.matchMedia?.('(display-mode: standalone)').matches);}
function installEligible(){
 let until=installDismissedUntil;try{until=Math.max(until,Number(localStorage.getItem('azice_install_remind_after'))||0);}catch{}
 const mobile=/Android|iPhone|iPad/i.test(navigator.userAgent||'');
 const ios=/iPhone|iPad/i.test(navigator.userAgent||'')&&/Safari/i.test(navigator.userAgent||'');
 return Boolean(mobile&&(ios||state.installPrompt)&&!installed()&&Date.now()>=until&&state.user&&state.profile&&['feed','profile','friends'].includes(state.view));
}
function dismissInstall(){installDismissedUntil=Date.now()+INSTALL_REMINDER;try{localStorage.setItem('azice_install_remind_after',String(installDismissedUntil));}catch{}}
function scheduleInstall(){
 if(installTimer||!installEligible())return;
 installTimer=setTimeout(async()=>{
  installTimer=null;
  if(!installEligible()||document.visibilityState==='hidden'||pushBusy||photoViewer||state.cameraStream||document.querySelector('dialog[open],.modal-backdrop'))return;
  const account=accountVersion;
  const choice=confirmInApp('Add it to your Home Screen for a faster, app-like experience.',{title:'Get AziCe? on your phone',action:'Install App',cancel:'Not Now'});
  installNudgeDialog=document.querySelector('dialog.azice-confirm');
  dismissInstall();
  const accepted=await choice;
  if(accepted&&account===accountVersion&&!installed())try{await handleAction({dataset:{action:'install'}});}catch(error){showToast(error.message||'Could not open installation.');}
  installNudgeDialog=null;schedulePushInvitation();
 },8000);
}
function setCurrentUser(user){
 if(state.user?.id!==user?.id){
  clearTimeout(pushInviteTimer);pushInviteTimer=null;pushInviteDialog?.close();pushInviteDialog=null;pushSettingsLoaded=false;
  seenIncoming=null;clearTimeout(installTimer);installTimer=null;installNudgeDialog?.close();installNudgeDialog=null;
  clearTimeout(showToast.timer);const toast=$('#toast');if(toast)toast.hidden=true;
  closePhotoViewer();stopCamera();state.draft.files=[];cleanDraftPhotoURLs();clearPhotoCache();
  closeCommentCard();
  accountVersion++;friendRefreshVersion++;
  state.friends={friends:[],incoming:[],outgoing:[]};state.friendsLoaded=false;state.inviteToken=null;
  state.profile=null;state.feed=[];state.history=[];state.cache.clear();
  state.openedPost=null;pushSettings=pushDefaults();pushBusy=false;
 }
 state.user=user;
 pushSync=syncPushAccount(user).catch(()=>{});
}
function friendsButtonContent(){
 return `<svg aria-hidden="true" focusable="false" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-3-5"/></svg><span>Friends</span>${state.friends.incoming.length?'<span class="friend-request-dot" aria-hidden="true"></span>':''}`;
}
function updateFriendsButton(){
 const button=$('.friends-button');if(!button)return;
 button.innerHTML=friendsButtonContent();
 button.setAttribute('aria-label',state.friends.incoming.length?'Friends & Invites, pending incoming friend requests':'Friends & Invites');
}
async function refreshFriends(){
 if(!state.user)return false;
 const account=accountVersion, refresh=++friendRefreshVersion;
 const friends=await api.friendData();
 if(account!==accountVersion||refresh!==friendRefreshVersion)return false;
 const fresh=seenIncoming!==null&&friends.incoming.some(request=>!seenIncoming.has(request.id));
 if(seenIncoming===null)seenIncoming=new Set();
 for(const request of friends.incoming)seenIncoming.add(request.id);
 state.friends=friends;state.friendsLoaded=true;updateFriendsButton();
 if(fresh&&document.visibilityState!=='hidden')showToast('You have a new friend request!',true);
 const invite=$('#feed-invite');if(invite)invite.innerHTML=feedInviteCard();
 scheduleInstall();
 schedulePushInvitation();
 return true;
}
function refreshOnReturn(){
 if(!api||document.visibilityState==='hidden'||returnRefresh)return returnRefresh;
 const account=accountVersion;
 returnRefresh=(async()=>{
  const user=await api.getUser();
  if(account!==accountVersion)return;
  if(state.user?.id!==user?.id){setCurrentUser(user);state.view=user?'loading':'auth';render();if(user)await boot();return;}
  if(!pushBusy)await syncPushAccount(user).catch(()=>{});
  if(account!==accountVersion)return;
  if(user&&!pushBusy&&(!pushSettingsLoaded||pushSettings.enabled&&pushSettings.timezone!==Intl.DateTimeFormat().resolvedOptions().timeZone))await loadPushSettings();
  if(account!==accountVersion)return;
  if(await refreshFriends()&&state.view==='friends')render();
 })().catch(e=>console.warn('Could not refresh friend requests.',e)).finally(()=>{returnRefresh=null;});
 return returnRefresh;
}
const html = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = date => new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const dayISO = value => {const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const isActive = post => Date.now()-new Date(post.published_at).getTime()<48*HOUR;
const who = post => post.author_id===state.user?.id ? 'You' : (post.author?.display_name || 'Friend');
const own = p => p.author_id===state.user?.id;
function showToast(message,friendRequest=false) { const el=$('#toast'); el.textContent=message;if(friendRequest)el.innerHTML=`<button type="button" class="toast-action" data-action="friend-toast" data-account="${accountVersion}">${html(message)}</button>`;el.hidden=false; clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.hidden=true,friendRequest?8000:3800); }
// App-styled confirmation; no browser-native confirm() popup.
function confirmInApp(message, { title = 'Are you sure?', action = 'Confirm', danger = false, cancel = 'Cancel', onAccept } = {}) {
 return new Promise(resolve => {
  const dialog = document.createElement('dialog');
  dialog.className = 'azice-confirm';
  dialog.setAttribute('aria-labelledby', 'azice-confirm-title');
  dialog.innerHTML = `<div class="azice-confirm-content">
   <h2 id="azice-confirm-title">${html(title)}</h2>
   <p>${html(message)}</p>
   <div class="azice-confirm-actions">
    <button type="button" class="secondary" data-choice="cancel">${html(cancel)}</button>
    <button type="button" class="${danger ? 'azice-danger-button' : 'primary'}" data-choice="accept">${html(action)}</button>
   </div>
  </div>`;
  let accepted = false;
  const previousFocus = document.activeElement;
  dialog.addEventListener('click', e => {
   const choice = e.target.closest('[data-choice]');
   if (choice) { accepted = choice.dataset.choice === 'accept'; dialog.close();if(accepted)onAccept?.(); }
   else if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
   dialog.remove();
   if (previousFocus?.isConnected) previousFocus.focus();
   resolve(accepted);
   schedulePushInvitation();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('[data-choice="cancel"]').focus();
 });
}
function closeCommentCard(){
 commentCardVersion++;
 if(commentCard){commentCard.dialog.close();commentCard=null;}
}
function renderCommentCard(card){
 const p=card.profile;
 const actions=p.relationship==='none'?'<button type="button" class="primary" data-card-action="send">Add Friend</button>':
  p.relationship==='incoming'?'<button type="button" class="primary" data-card-action="accept">Accept</button><button type="button" class="secondary" data-card-action="decline">Decline</button>':
  p.relationship==='outgoing'?'<button type="button" class="secondary" disabled>Request Sent</button>':
  p.relationship==='friends'?'<button type="button" class="secondary" disabled>Friends</button>':'';
 card.dialog.innerHTML=`<div class="azice-confirm-content"><div class="comment-user-heading">${avatar(p,'small')}<div><h2 id="comment-user-title">${html(p.display_name)}</h2><p>@${html(p.username)}</p></div></div><div class="azice-confirm-actions" aria-live="polite">${actions}<button type="button" class="secondary" data-card-action="close">Close</button></div></div>`;
 loadImages();
 scheduleInstall();
}
async function openCommentAuthor(commentId){
 closeCommentCard();
 const version=commentCardVersion,account=accountVersion,previousFocus=document.activeElement;
 const profile=await api.commentAuthor(commentId);
 if(version!==commentCardVersion||account!==accountVersion)return;
 const dialog=document.createElement('dialog');
 dialog.className='azice-confirm comment-user-card';dialog.setAttribute('aria-labelledby','comment-user-title');
 const card={dialog,profile,commentId,account,busy:false};commentCard=card;
 dialog.addEventListener('close',()=>{
  dialog.remove();if(commentCard===card){commentCard=null;commentCardVersion++;}
  if(previousFocus?.isConnected)previousFocus.focus();
 },{once:true});
 dialog.addEventListener('click',async event=>{
  const action=event.target.closest('[data-card-action]')?.dataset.cardAction;
  if(action==='close'||event.target===dialog){closeCommentCard();return;}
  if(!action||card.busy)return;
  card.busy=true;
  for(const button of dialog.querySelectorAll('button'))if(button.dataset.cardAction!=='close')button.disabled=true;
  try{
   // Recheck visibility and current relationship; never trust a stale card or DOM request ID.
   const current=await api.commentAuthor(card.commentId);
   if(commentCard!==card||card.account!==accountVersion)return;
   if(action==='send'&&current.relationship==='none')await api.sendCommentRequest(card.commentId);
   else if(['accept','decline'].includes(action)&&current.relationship==='incoming')await api.requestAction(current.request_id,action);
   if(card.account!==accountVersion)return;
   await refreshFriends();
   if(commentCard!==card||card.account!==accountVersion)return;
   const updated=await api.commentAuthor(card.commentId);
   if(commentCard!==card||card.account!==accountVersion)return;
   card.profile=updated;renderCommentCard(card);
   dialog.querySelector('[data-card-action]:not([disabled])')?.focus();
  }catch(error){
   if(commentCard!==card||card.account!==accountVersion)return;
   // Close stale cards rather than leaving details visible after access is removed.
   closeCommentCard();
   const safe=['Too many friend requests. Try again later.','A request is already pending','Already friends'];
   showToast(safe.includes(error.message)?error.message:'User unavailable.');
  }finally{card.busy=false;}
 });
 document.body.append(dialog);renderCommentCard(card);dialog.showModal();
 dialog.querySelector('[data-card-action]:not([disabled])')?.focus();
}
async function loadSupabase(){
 if(!cloudEnabled) return createDemo();
 const src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
 await new Promise((resolve,reject)=>{
   if(window.supabase?.createClient)return resolve();
   const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Could not load Supabase. Check your connection.'));document.head.append(s);
 });
 return createCloud(window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}));
}
async function boot(){
 try {
   api ||= await loadSupabase();
   state.demo=api.mode==='demo';
   const previousAccount=accountVersion;
   const user=await api.getUser();if(previousAccount!==accountVersion)return;
   setCurrentUser(user);
   if(!authSubscription&&api.onAuthChange)authSubscription=api.onAuthChange(user=>{
     if(state.user?.id===user?.id)return;
     setCurrentUser(user);state.view=user?'loading':'auth';render();
     // Leave the synchronous Supabase auth callback before making API calls.
     if(user)setTimeout(()=>boot(),0);
   });
   if(!state.user){
     state.view='auth';
     render();
     return;
   }
   const account=accountVersion;
   const profile=await api.getMyProfile();
   if(account!==accountVersion)return;
   if(!profile){
     state.view='onboard';
     render();
     return;
   }
   state.profile=profile;await loadPushSettings();
   await refreshFriends().catch(e=>console.warn('Could not refresh friend requests.',e));
   if(account!==accountVersion)return;
   const pending=savedInvite();
   if(pending){
     try {
       state.invitePreview=await api.previewInvite(pending);
       state.view='invite';
       render();
       return;
     } catch(e) {
       showToast(e.message);
     }
   }
   await home();
 } catch(e) {
   console.error(e);
   $('#app').innerHTML=`<main class="centered"><div class="brand">AziCe<span>?</span></div><p>App could not start.</p><p class="muted">${html(e.message)}</p><button class="primary" onclick="location.reload()">Try Again</button></main>`;
 }
}
async function hydrate(posts){
 const ids=[...new Set(posts.filter(p=>!p.author).map(p=>p.author_id))];
 if(ids.length){const profiles=await api.getProfiles(ids);const map=new Map(profiles.map(p=>[p.id,p]));for(const p of posts) if(!p.author)p.author=map.get(p.author_id) || {display_name:'Friend'};}
 return posts;
}
async function home(){const account=accountVersion;const feed=await hydrate(await api.getFeed());if(account!==accountVersion)return;if(!pushSettingsLoaded)await loadPushSettings();if(account!==accountVersion)return;state.feed=feed;state.view='feed';render();await openNotification();}
async function openProfile(){state.profile=await api.getMyProfile();state.history=await hydrate(await api.getHistory(state.user.id));await loadPushSettings();state.view='profile';render();}
async function openFriendProfile(id){const p=await api.getProfile(id);if(!p)throw Error('Profile unavailable');state.target=p;state.history=await hydrate(await api.getHistory(id));state.view='friendProfile';render();}
async function openFriends(){
 if(!state.user)return;
 const account=accountVersion;
 await refreshFriends();if(account!==accountVersion)return;
 const token=await api.getInvite();if(account!==accountVersion)return;
 state.inviteToken=token;state.view='friends';render();
 window.scrollTo(0,0);
 $('#friends-title')?.focus({preventScroll:true});
}
function brand(){return `<div class="brand">AziCe<span>?</span></div>`;}
function headerAvatar(){
 const p=state.profile;const path=p?.avatar_path;
 const src=path?(path.startsWith('data:')?path:(path.startsWith('avatar:')?path:`avatar:${path}`)):null;
 return `<button aria-label="Open profile" class="avatar mini" data-action="profile">${src?`<img data-private-photo="${html(src)}" alt="${html(p?.display_name||'User')} avatar">`:initials(p?.display_name)}</button>`;
}
function shell(content, tab='feed'){
 return `<div class="app-shell">
  <header class="header">${brand()}<div class="header-actions">${state.view==='feed'?`<button type="button" class="friends-button" data-action="friends" aria-label="${state.friends.incoming.length?'Friends & Invites, pending incoming friend requests':'Friends & Invites'}">${friendsButtonContent()}</button>`:''}${headerAvatar()}</div></header>
  ${state.demo?'<div class="demo-banner">DEMO MODE · Only on this device · No real friends connected</div>':''}
  <main class="content">${content}</main>
  <nav class="bottom-nav" aria-label="Main navigation">
    <button class="nav-item ${tab==='feed'?'selected':''}" data-action="feed"><span class="nav-icon">⌂</span><span>Feed</span></button>
    <button class="add-button" data-action="start-post" aria-label="New post">+</button>
    <button class="nav-item ${tab==='profile'?'selected':''}" data-action="profile"><span class="nav-icon">◎</span><span>Profile</span></button>
  </nav>
 </div>`;
}
function initials(name){return html((name||'?').trim().slice(0,1).toUpperCase());}
function backBar(title, action='profile'){return `<div class="subheader"><button class="icon-btn" data-action="${action}" aria-label="Back">‹</button><h1>${html(title)}</h1></div>`;}
function photoCard(photo,idx){const path=html(photo.path);return `<button type="button" class="photo-slide" data-action="view-photo" data-path="${path}" aria-label="Open full photo ${idx+1}"><span class="photo-loading" aria-hidden="true">📷</span><img data-private-photo="${path}" alt="Photo ${idx+1}" loading="lazy"></button>`;}
function avatar(p,cls=''){const path=p?.avatar_path;const src=path?(path.startsWith('data:')?path:(path.startsWith('avatar:')?path:`avatar:${path}`)):null;return `<div class="avatar ${cls}">${src?`<img data-private-photo="${html(src)}" alt="${html(p?.display_name||'User')} avatar">`:initials(p?.display_name)}</div>`;}
function postCard(p){
 const counts=Object.fromEntries(EMOJI.map(e=>[e,(p.reactions||[]).filter(r=>r.emoji===e).length]));
 const myEmoji=(p.reactions||[]).find(r=>r.user_id===state.user.id)?.emoji;
 const open=state.activeComments.has(p.id);const active=isActive(p);
 const ownPost=own(p);
 const rawPhotos=p.post_photos||[];
 return `<article class="post-card" data-post="${html(p.id)}">
   <div class="post-head">
     ${avatar(p.author,'small')}
     <div class="post-by"><button class="name-button" data-action="${ownPost?'profile':'friend-profile'}" data-id="${html(p.author_id)}">${html(who(p))}</button><span>${fmt(p.published_at)}</span></div>
     <span class="kind ${p.kind==='drank'?'drink':'sober'}">${p.kind==='drank'?'🍺 I Drank':'🧃 I Didn\'t Drink'}</span>
   </div>
   ${rawPhotos.length ? `<div class="photo-scroller" aria-label="Photos">${rawPhotos.map(photoCard).join('')}</div>${rawPhotos.length>1?`<span class="photo-count">Swipe to view ${rawPhotos.length} photos →</span>`:''}`:''}
   <p class="reason">${html(p.reason)}</p>
   <div class="engagement">
     ${EMOJI.filter(e=>counts[e]>0).map(e=>`<span class="count-pill ${myEmoji===e?'mine':''}">${e} ${counts[e]}</span>`).join('')}
     ${active?`<button class="outlined-pill" data-action="toggle-react" data-id="${html(p.id)}" aria-label="React to post">${myEmoji?'Change':'＋ React'}</button>`:''}
     <button class="comments-trigger" data-action="toggle-comments" data-id="${html(p.id)}">◌ ${(p.comments||[]).length} Comments ${open?'⌃':'⌄'}</button>
   </div>
   ${state.activeReactions===p.id&&active?`<div class="reaction-picker">${EMOJI.map(e=>`<button data-action="react" data-id="${html(p.id)}" data-emoji="${e}" aria-label="React ${e}" class="emoji-btn ${myEmoji===e?'active':''}">${e}</button>`).join('')}${myEmoji?`<button data-action="react" data-id="${html(p.id)}" data-emoji="" class="unreact">Remove</button>`:''}</div>`:''}
   ${open?`<section class="comments-area" aria-label="Comments">
     ${(p.comments||[]).length ? p.comments.map(c=>`<div class="comment"><button type="button" class="comment-author" data-action="comment-user" data-id="${html(c.id)}">${html(c.author_id===state.user.id?'You':c.author_name)}</button> ${html(c.body)}<small>${fmt(c.created_at)}</small></div>`).join(''):'<p class="muted small-text">No comments yet.</p>'}
     ${active?`<form data-form="comment" data-post="${html(p.id)}" class="comment-form"><input name="body" maxlength="300" required placeholder="Write a comment..." aria-label="Write a comment"><button type="submit" aria-label="Post comment">➤</button></form>`:'<div class="muted small-text">Comments are closed after 48 hours.</div>'}
   </section>`:''}
 </article>`;
}
function feedInviteCard(){
 const hasFriends=state.friends.friends.length>0;
 return state.user&&state.friendsLoaded?`<section class="feed-invite-card" aria-labelledby="feed-invite-title"><h2 id="feed-invite-title">${hasFriends?'The more, the merrier!':'Better with friends'}</h2><p>${hasFriends?'Got room for one more friend? Bring them in!':"Invite your friends and see what they're up to."}</p><button type="button" class="primary" data-action="friends">Invite Friends</button></section>`:'';
}
function emptyFeed(){return `<div class="empty-state"><div class="empty-art">👀</div><h2>Pretty quiet in here...</h2><p>The crew hasn't shown up yet.</p><button class="text-button" data-action="start-post">Or be the first to post →</button></div>`;}
function feedView(){return shell(`<div class="page-title"><h1>What's happening?</h1><span>Last 48 hours</span></div>
 ${state.feed.length?state.feed.map(postCard).join(''):emptyFeed()}<div id="feed-invite">${feedInviteCard()}</div>`,'feed');}
function profileHeader(p,me=false){return `<div class="profile-header"><div class="profile-avatar">${avatar(p,'large')}</div><div class="profile-identity"><h1>${html(p.display_name)}</h1><p>@${html(p.username)}</p>${me?'<button class="tiny-link" data-action="edit-profile">Edit Profile</button>':''}</div></div>
 ${p.bio?`<p class="profile-bio">${html(p.bio)}</p>`:''}`;}
function monthGrid(){
 const start=new Date(state.month.getFullYear(),state.month.getMonth(),1);
 const year=start.getFullYear(),month=start.getMonth();const max=new Date(year,month+1,0).getDate();const offset=(start.getDay()+6)%7;
 const marks={};for(const p of state.history){const k=dayISO(p.published_at);(marks[k]||=new Set()).add(p.kind);}
 let cells=['M','T','W','T','F','S','S'].map(d=>`<span class="weekday">${d}</span>`).join('');
 for(let i=0;i<offset;i++)cells+='<span></span>';
 for(let n=1;n<=max;n++){
 const date=`${year}-${String(month+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
 const val=marks[date];const dots=val?`<div class="dots">${val.has('drank')?'<i class="dot orange"></i>':''}${val.has('sober')?'<i class="dot teal"></i>':''}</div>`:'';
 cells+=`<button class="day" data-action="open-day" data-id="${date}"><span>${n}</span>${dots}</button>`;
 }
 const monthTitle=start.toLocaleString('en-US',{month:'long',year:'numeric'});
 return `<section class="calendar"><div class="section-heading"><h2>My Calendar</h2><div class="month-control"><button data-action="prev-month" aria-label="Previous month">‹</button><span>${html(monthTitle)}</span><button data-action="next-month" aria-label="Next month">›</button></div></div><div class="calendar-grid">${cells}</div><div class="calendar-legend"><span><i class="dot orange"></i> I Drank</span><span><i class="dot teal"></i> I Didn't Drink</span></div></section>`;
}
function profileView(){
 const p=state.profile;return shell(`${profileHeader(p,true)}
 ${notificationsSection()}
 ${monthGrid()}<div class="section-heading"><h2>Recent Posts</h2><span>${state.history.length} posts</span></div>
 ${state.history.length?state.history.slice(0,8).map(postCard).join(''):'<div class="empty-small">Your memories will appear here.</div>'}
 <div class="profile-actions"><button class="text-button" data-action="install">Install App</button><button class="text-button" data-action="sign-out">Sign Out</button>${state.demo?'<button class="text-button" data-action="reset-demo">Reset Demo</button>':'<button class="text-button danger-text" data-action="delete-account">Delete Account</button>'}</div>
 <p class="privacy-contact">Safety & Privacy: Contact <b>privacy@azice.aagameri.tech</b> for content removal or takedown assistance.</p>`,'profile');
}
function friendProfileView(){const p=state.target;return shell(`${backBar('Profile','friends')}${profileHeader(p)}<div class="section-heading"><h2>Last 30 Days</h2></div>${state.history.length?state.history.map(postCard).join(''):'<div class="empty-small">No recent posts to show.</div>'}`,'profile');}
function dayView(){const posts=state.history.filter(p=>dayISO(p.published_at)===state.selectedDate);const title=new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});return shell(`${backBar(title)}<div class="section-heading"><h2>Your Memories</h2><span>${posts.length} posts</span></div>${posts.length?posts.map(postCard).join(''):'<div class="empty-small">Nothing posted on this day.</div>'}`,'profile');}
function friendRow(p,actions=''){return `<div class="friend-row">${avatar(p,'small')}<div><strong>${html(p.display_name)}</strong><span>@${html(p.username)}</span></div><div class="friend-action">${actions}</div></div>`;}
function friendsView(){
 const f=state.friends;const link=`${location.origin}/?invite=${encodeURIComponent(state.inviteToken||'')}`;
 const received=`<section class="friends-section"><div class="section-heading"><h2>Requests Received</h2><span>${f.incoming.length}</span></div>
 ${f.incoming.length?f.incoming.map(r=>friendRow(r.profile,`<button class="small-primary" data-action="request" data-id="${html(r.id)}" data-value="accept">Accept</button><button class="small-secondary" data-action="request" data-id="${html(r.id)}" data-value="decline">Decline</button>`)).join(''):'<p class="muted small-text">No pending requests.</p>'}</section>`;
 const invite=`<section class="invite-card"><div class="invite-head">↗ &nbsp;Invite your crew</div><p>Share your link. Every friendship request needs your approval.</p><div class="invite-url">${html(link)}</div><div class="button-pair"><button class="primary" data-action="share-invite">Share Link</button><button class="secondary" data-action="rotate-invite">New Link</button></div></section>`;
 return shell(`<div class="friends-screen">${backBar('Friends & Invites','feed').replace('<h1>','<h1 id="friends-title" tabindex="-1">')}${f.incoming.length?received+invite:invite+received}
 <section class="friends-section"><div class="section-heading"><h2>Requests Sent</h2><span>${f.outgoing.length}</span></div>
 ${f.outgoing.length?f.outgoing.map(r=>friendRow(r.profile,`<button class="small-secondary" data-action="request" data-id="${html(r.id)}" data-value="cancel">Cancel</button>`)).join(''):'<p class="muted small-text">No sent requests.</p>'}</section>
 <section class="friends-section"><div class="section-heading"><h2>Friends</h2><span>${f.friends.length}</span></div>
 ${f.friends.length?f.friends.map(p=>friendRow(p,`<button class="small-secondary" data-action="friend-profile" data-id="${html(p.id)}">View</button><button class="small-danger" data-action="unfriend" data-id="${html(p.id)}">Remove</button>`)).join(''):'<p class="muted small-text">Your friends will appear here.</p>'}</section></div>`,'profile');
}
function authView(){const signup=state.authSignUp;return `<main class="centered auth-screen">${brand()}<p class="tagline">Every day has a story.</p><div class="auth-panel"><h1>${signup?'Create your account':'Welcome back'}</h1><p>${signup?'Join the crew. Just be yourself.':'See what the crew is up to.'}</p><form id="auth-form"><label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" minlength="6" autocomplete="${signup?'new-password':'current-password'}" required placeholder="At least 6 characters"></label><button class="primary" type="submit">${signup?'Sign Up':'Sign In'}</button></form><div class="or">or</div><button class="wide-outline" data-action="google">Continue with Google</button><p class="auth-switch">${signup?'Already have an account?':'New here?'} <button class="inline-link" data-action="toggle-auth">${signup?'Sign In':'Sign Up'}</button></p></div>${state.demo?'<div class="demo-banner auth-demo">Preview mode — Supabase is not configured. Explore the interface locally.</div><button class="secondary" data-action="demo-enter">Explore Demo</button>':''}</main>`;}
function onboardView(){return `<main class="centered auth-screen">${brand()}<p class="tagline">One last thing...</p><div class="auth-panel"><h1>Set up your profile</h1><p>Your story, your identity.</p><form id="onboard-form"><label>Display Name<input name="display_name" maxlength="60" required placeholder="Alex"></label><label>Username<input name="username" pattern="[a-z0-9_]{3,24}" required maxlength="24" placeholder="alex_22" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label><label class="checkline"><input name="adult" type="checkbox" required> I confirm I am at least 18 years old.</label><button class="primary" type="submit">Let's Go →</button></form></div></main>`;}
function editProfileView(){const p=state.profile;return shell(`${backBar('Edit Profile')}<form id="edit-profile" class="edit-form"><div class="profile-avatar-center">${avatar(p,'large')}<label class="gallery-label">Choose from Gallery<input type="file" accept="image/*" id="avatar-input" hidden></label></div><label>Display Name<input name="display_name" required maxlength="60" value="${html(p.display_name)}"></label><label>Username<input name="username" required pattern="[a-z0-9_]{3,24}" maxlength="24" value="${html(p.username)}" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label><label>Bio<textarea name="bio" maxlength="150" rows="3" placeholder="Tell your story...">${html(p.bio||'')}</textarea><small>Max. 150 characters</small></label><button class="primary" type="submit">Save Changes</button></form>`,'profile');}
function newPostView(){const d=state.draft;
 let content='';
 if(d.step===0)content=`<h1>What's the story today?</h1><p class="muted">Choose one. No pressure either way.</p><div class="choice-grid"><button class="choice ${d.kind==='drank'?'chosen':''}" data-action="choose-kind" data-value="drank"><span>🍺</span>I Drank</button><button class="choice ${d.kind==='sober'?'chosen':''}" data-action="choose-kind" data-value="sober"><span>🧃</span>I Didn't Drink</button></div>`;
 if(d.step===1)content=`<h1>Capture the moment</h1><p class="muted">Up to 3 photos, straight from your camera. ${d.kind==='drank'?'At least 1 required.':'Photos are optional.'}</p><div class="capture-list">${d.files.map((f,i)=>`<div class="capture-thumb"><button type="button" class="preview-photo" data-action="view-draft-photo" data-id="${i}" aria-label="Open full captured photo ${i+1}"><img src="${draftPhotoURL(f)}" alt="Captured photo"></button><button data-action="remove-photo" data-id="${i}" aria-label="Remove photo">×</button></div>`).join('')}${d.files.length<3?'<button class="capture-add" data-action="open-camera">＋<small>Take Photo</small></button>':''}</div><div class="camera-note">📷 Photos must be taken in the app. Gallery uploads are disabled for posts.</div>`;
 if(d.step===2)content=`<h1>What's your reason?</h1><p class="muted">A good excuse makes a good story.</p><textarea id="post-reason" maxlength="300" rows="5" placeholder="Tell your story...">${html(d.reason)}</textarea><div class="char-count"><span>Required</span><span id="reason-counter">${d.reason.length}/300</span></div><p class="section-label">Need inspiration?</p><div class="suggestions">${SUGGEST[d.kind].map((s,i)=>`<button data-action="suggest" data-id="${i}">${html(s)}</button>`).join('')}</div>`;
 if(d.step===3)content=`<h1>Review your post</h1><p class="muted">Once published, posts can't be edited.</p><div class="review-card"><span class="kind ${d.kind==='drank'?'drink':'sober'}">${d.kind==='drank'?'🍺 I Drank':'🧃 I Didn\'t Drink'}</span><div class="photo-scroller" aria-label="Preview photos">${d.files.map((f,i)=>photoCard({path:draftPhotoURL(f)},i)).join('')}</div><p>${html(d.reason)}</p></div><p class="safety-note">Your post is shared only with confirmed friends. It stays in Feed for 48 hours, then moves to your private archive.</p>`;
 return shell(`${backBar('New Post','cancel-post')}<div class="step-indicator">STEP ${d.step+1} OF 4</div><div class="new-post">${content}</div><div class="post-actions">${d.step>0?'<button class="secondary" data-action="post-back">Back</button>':''}<button class="primary" data-action="post-next">${d.step===3?'Publish Post':'Continue →'}</button></div>`,'feed');
}
function cameraView(){return `<main class="camera-screen"><div class="camera-header"><button data-action="close-camera" aria-label="Close camera">×</button><span>Take Photo</span><button data-action="flip-camera" aria-label="Switch camera">⟳</button></div>${state.cameraError?`<div class="camera-error">${html(state.cameraError)}</div>`:'<video id="camera-preview" autoplay playsinline muted></video>'}<div class="camera-footer"><span>${state.draft.files.length}/3 photos</span><button class="shutter" data-action="capture-photo" aria-label="Capture photo"></button><span>Camera only</span></div></main>`;}
function inviteView(preview){return `<main class="centered auth-screen">${brand()}<div class="auth-panel"><h1>Friend Invitation</h1>${preview?`<p><b>${html(preview.display_name)}</b> invited you to connect on AziCe?.</p><p class="muted">@${html(preview.username)} · Posts remain private until accepted.</p><button class="primary" data-action="send-request">Send Friend Request</button>`:'<p>This invite link has expired or was revoked.</p>'}<button class="secondary" data-action="dismiss-invite">Go to Feed</button></div></main>`;}
function installInfo(){return `<div class="modal-backdrop" data-action="close-install"><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><h2>Install AziCe?</h2><p>On iPhone: open in Safari, tap Share, then <b>Add to Home Screen</b> and enable <b>Open as Web App</b> if offered.</p><p>On Android: open the browser menu and select <b>Install app</b> or <b>Add to Home screen</b>.</p><button class="primary" data-action="close-install">Got It</button></div></div>`;}
function render(){
 cleanDraftPhotoURLs();
 const root=$('#app');
 switch(state.view){
 case 'auth':root.innerHTML=authView();break;
 case 'onboard':root.innerHTML=onboardView();break;
 case 'feed':root.innerHTML=feedView();break;
 case 'post':root.innerHTML=shell(`${backBar('Post','feed')}${postCard(state.openedPost)}`);break;
 case 'profile':root.innerHTML=profileView();break;
 case 'friends':root.innerHTML=friendsView();break;
 case 'friendProfile':root.innerHTML=friendProfileView();break;
 case 'day':root.innerHTML=dayView();break;
 case 'editProfile':root.innerHTML=editProfileView();break;
 case 'new':root.innerHTML=newPostView();break;
 case 'camera':root.innerHTML=cameraView();attachCamera();break;
 case 'invite':root.innerHTML=inviteView(state.invitePreview);break;
 default:root.innerHTML=`<main class="centered">${brand()}<p class="muted">Loading...</p></main>`;
 }
 if(state.installHelp)root.insertAdjacentHTML('beforeend',installInfo());
 loadImages();
 schedulePushInvitation();
}
let photoObserver;
function loadImages(){
 const load=img=>{
  const path=img.dataset.privatePhoto;if(!path)return;
  privatePhotoURL(path).then(url=>{if(img.isConnected){img.src=url;img.classList.add('loaded');}}).catch(()=>{if(img.isConnected)img.alt='Photo unavailable';});
 };
 if(typeof IntersectionObserver!=='undefined'&&!photoObserver)photoObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){photoObserver.unobserve(entry.target);load(entry.target);}},{rootMargin:'300px'});
 photoObserver?.disconnect();
 for(const img of document.querySelectorAll('[data-private-photo]')){
  if(img.loading==='lazy'&&photoObserver)photoObserver.observe(img);else load(img);
 }
}
let cameraFacing='environment',cameraVersion=0,capturing=false;
async function startCamera(){
 stopCamera();const version=cameraVersion;
 if(state.draft.files.length>=3)throw Error('You can add up to 3 photos.');
 if(!navigator.mediaDevices?.getUserMedia){state.cameraError='Camera unavailable. Use HTTPS or localhost and a phone with a camera.';state.view='camera';render();return;}
 state.cameraError=null;state.view='camera';render();
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:cameraFacing},width:{ideal:1600},height:{ideal:1600}}});
  if(version!==cameraVersion||state.view!=='camera'){stream.getTracks().forEach(track=>track.stop());return;}
  state.cameraStream=stream;
  attachCamera();
 }catch(e){if(version===cameraVersion){state.cameraError=`Could not open camera: ${e.message}`;render();}}
}
function attachCamera(){const video=$('#camera-preview');if(video&&state.cameraStream){video.srcObject=state.cameraStream;video.play().catch(()=>{});}}
function stopCamera(){cameraVersion++;if(state.cameraStream){state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;}}
async function canvasBlob(source,width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Photo dimensions are invalid.');
 // Draw the entire frame proportionally. A fresh canvas JPEG carries no source EXIF/GPS.
 const canvas=document.createElement('canvas'),factor=Math.min(1,1600/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*factor));canvas.height=Math.max(1,Math.round(height*factor));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable.');ctx.drawImage(source,0,0,canvas.width,canvas.height);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?.type==='image/jpeg'?resolve(b):reject(Error('Could not process photo. Please try again.')),'image/jpeg',.80));
}
async function capture(){
 if(capturing)return;
 if(state.draft.files.length>=3)throw Error('You can add up to 3 photos.');
 const video=$('#camera-preview');if(!video||!video.videoWidth)throw Error('Camera is not ready.');
 const version=cameraVersion,draft=state.draft;capturing=true;
 try{const file=await canvasBlob(video,video.videoWidth,video.videoHeight);
 if(version!==cameraVersion||state.view!=='camera'||draft!==state.draft)return;
 state.draft.files.push(file);stopCamera();state.view='new';render();}finally{capturing=false;}
}
async function galleryAvatar(file){
 if(!file?.type?.startsWith('image/'))throw Error('Choose an image.');
 const image=await decodeAvatar(file);let blob;
 try{
  const n=Math.min(image.width,image.height),x=(image.width-n)/2,y=(image.height-n)/2;
  const c=document.createElement('canvas'),size=Math.min(512,n);c.width=size;c.height=size;const ctx=c.getContext('2d');if(!ctx)throw Error('Avatar processing is unavailable.');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.drawImage(image,x,y,n,n,0,0,size,size);
  blob=await new Promise((ok,no)=>c.toBlob(b=>b?.type==='image/jpeg'?ok(b):no(Error('Avatar conversion failed')),'image/jpeg',.80));
 }finally{image.close?.();}
 const path=await api.saveAvatar(blob);state.profile.avatar_path=path;showToast('Profile photo updated.');render();
}
async function decodeAvatar(file){
 try{
  if(typeof createImageBitmap==='function')return await createImageBitmap(file,{imageOrientation:'from-image'});
  const url=URL.createObjectURL(file),image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});return image;}finally{URL.revokeObjectURL(url);}
 }catch{throw Error('Could not read this image. Please choose a supported image.');}
}
async function refreshPosts(){if(state.view==='post'){const version=accountVersion,post=await api.getPost(state.openedPost.id);if(version!==accountVersion)return;if(!post){showToast('This update is no longer available.');await home();return;}state.openedPost=(await hydrate([post]))[0];}else if(state.view==='feed')state.feed=await hydrate(await api.getFeed());else if(['profile','friendProfile','day'].includes(state.view))state.history=await hydrate(await api.getHistory(state.view==='friendProfile'?state.target.id:state.user.id));render();}
async function handleAction(button){const a=button.dataset.action,id=button.dataset.id,val=button.dataset.value;
 switch(a){
 case 'push-enable':await enablePush();break;
 case 'push-disable':{const version=accountVersion;await forgetPushDevice();if(version!==accountVersion)break;
  try{const settings=await api.saveNotificationPreferences({enabled:false});if(version!==accountVersion)break;pushSettings=settings;render();showToast('Notifications disabled.');}
  catch{throw Error('Disabled on this device. Reconnect to disable notifications on all devices.');}break;}
 case 'friend-toast':if(Number(button.dataset.account)===accountVersion&&state.user){$('#toast').hidden=true;await openFriends();}break;
 case 'view-photo':await openPhotoViewer(button.dataset.path);break;
 case 'view-draft-photo':if(state.draft.files[Number(id)])await openPhotoViewer(draftPhotoURL(state.draft.files[Number(id)]));break;
 case 'feed': stopCamera();await home();break;
 case 'profile':stopCamera();await openProfile();break;
 case 'friends':stopCamera();await openFriends();break;
 case 'comment-user':await openCommentAuthor(id);break;
 case 'friend-profile':stopCamera();await openFriendProfile(id);break;
 case 'start-post':state.draft={kind:'drank',reason:'',files:[],step:0};state.view='new';render();break;
 case 'cancel-post':stopCamera();state.draft.files=[];await home();break;
 case 'choose-kind':state.draft.kind=val;render();break;
 case 'post-back':state.draft.step=Math.max(0,state.draft.step-1);render();break;
 case 'post-next':{
  const d=state.draft;
  if(d.step===1&&d.kind==='drank'&&!d.files.length)throw Error('Take at least one photo to continue.');
  if(d.step===2){
    const reasonEl=$('#post-reason');
    if(reasonEl)d.reason=reasonEl.value.slice(0,300);
    if(!d.reason.trim())throw Error('Your reason is required.');
  }
  if(d.step===3){
    if(button.disabled)return; // prevent duplicate publish on rapid taps
    if(!await confirmInApp('You cannot edit it later.', {title:'Publish this post?',action:'Publish'}))return;
    button.disabled=true;button.textContent='Publishing...';
    try{
      await api.createPost(d.kind,d.reason.trim(),d.files);
      // Success: clear draft and go to feed
      d.files=[];d.reason='';d.step=0;
      showToast('Post published!');
      await home();
    }catch(err){
      // Failure: restore UI so user can retry with their photos and reason preserved
      button.disabled=false;button.textContent='Publish Post';
      // Do NOT clear d.files or d.reason — user keeps their work
      showToast(err.message||'Failed to publish. Please try again.');
      console.error('[publish] error:', err);
    }
    return;
  }
  d.step+=1;render();break;
 }
 case 'open-camera':await startCamera();break;
 case 'close-camera':stopCamera();state.view='new';render();break;
 case 'flip-camera':cameraFacing=cameraFacing==='environment'?'user':'environment';stopCamera();await startCamera();break;
 case 'capture-photo':await capture();break;
 case 'remove-photo':state.draft.files.splice(Number(id),1);render();break;
 case 'suggest':state.draft.reason=SUGGEST[state.draft.kind][Number(id)];render();break;
 case 'toggle-comments':state.activeComments.has(id)?state.activeComments.delete(id):state.activeComments.add(id);render();break;
 case 'toggle-react':state.activeReactions=state.activeReactions===id?null:id;render();break;
 case 'react':await api.react(id,button.dataset.emoji||null);state.activeReactions=null;await refreshPosts();break;
 case 'edit-profile':state.view='editProfile';render();break;
 case 'open-day':state.selectedDate=id;state.view='day';render();break;
 case 'prev-month':state.month=new Date(state.month.getFullYear(),state.month.getMonth()-1,1);render();break;
 case 'next-month':state.month=new Date(state.month.getFullYear(),state.month.getMonth()+1,1);render();break;
 case 'request':await api.requestAction(id,val);await openFriends();showToast('Request updated.');break;
 case 'unfriend':if(await confirmInApp('They will no longer see your posts.', {title:'Remove this friend?',action:'Remove friend',danger:true})){await api.unfriend(id);await openFriends();showToast('Friend removed.');}break;
 case 'share-invite':{
   const link=`${location.origin}/?invite=${encodeURIComponent(state.inviteToken)}`;
   if(navigator.share)try{await navigator.share({title:'Join me on AziCe?',text:'Here is my friend invitation.',url:link});}catch(e){if(e.name!=='AbortError')throw e;}
   else{await navigator.clipboard.writeText(link);showToast('Invitation link copied!');}
   break;
 }
 case 'rotate-invite':if(await confirmInApp('Your previous link will stop working.', {title:'Create a new invitation link?',action:'Create new link'})){state.inviteToken=await api.rotateInvite();render();showToast('New invitation link created.');}break;
 case 'send-request':await api.sendRequest(savedInvite());await refreshFriends();sessionStorage.removeItem('azice_pending_invite');history.replaceState({},'',location.pathname);await home();showToast('Friend request sent!');break;
 case 'dismiss-invite':sessionStorage.removeItem('azice_pending_invite');history.replaceState({},'',location.pathname);await home();break;
 case 'toggle-auth':state.authSignUp=!state.authSignUp;render();break;
 case 'google':await api.google();break;
 case 'demo-enter':setCurrentUser(await api.getUser());await refreshFriends();state.profile=await api.getMyProfile();await home();break;
 case 'sign-out':await forgetPushDevice();await api.signOut();setCurrentUser(null);state.profile=null;state.view='auth';render();break;
 case 'reset-demo':if(await confirmInApp('This clears your local demo posts and comments.', {title:'Reset demo data?',action:'Reset demo',danger:true})){await api.resetDemo();await refreshFriends();await openProfile();showToast('Demo reset.');}break;
 case 'delete-account':{
   if(!await confirmInApp('All your posts, photos, comments, and friendships will be permanently erased. This cannot be undone.', {title:'Delete your account?',action:'Continue',danger:true}))return;
   if(!await confirmInApp('This permanently deletes your AziCe? account and cannot be undone.', {title:'Final confirmation',action:'Delete account',danger:true}))return;
   button.disabled=true;button.textContent='Deleting...';
   try{await api.deleteAccount();setCurrentUser(null);state.profile=null;state.view='auth';render();showToast('Your account and data have been deleted.');}
   finally{button.disabled=false;}
   break;
 }
 case 'install':if(installed())break;dismissInstall();if(state.installPrompt){const prompt=state.installPrompt;state.installPrompt=null;await prompt.prompt();}else if(/iPhone|iPad/i.test(navigator.userAgent||'')){await confirmInApp('In Safari, tap Share → Add to Home Screen, then tap Add. Enable Open as Web App if offered.',{title:'Install AziCe?',action:'Got It'});}else{state.installHelp=true;render();}break;
 case 'close-install':state.installHelp=false;render();break;
 }
}
document.addEventListener('click',async event=>{
 const btn=event.target.closest('[data-action]');if(!btn)return;
 event.preventDefault();
 try{await handleAction(btn);}catch(e){
  console.error(e);
  if(isSessionMissingOrInvalid(e)){setCurrentUser(null);state.profile=null;state.view='auth';render();showToast('Your session expired. Please sign in again.');}
  else showToast(e.message||'Something went wrong.');
 }
});
const isProfileUsername = input => input.name==='username'&&['onboard-form','edit-profile'].includes(input.form?.id);
document.addEventListener('invalid',event=>{if(isProfileUsername(event.target))event.target.setCustomValidity(USERNAME_FORMAT_MESSAGE);},true);
document.addEventListener('input',event=>{if(isProfileUsername(event.target))event.target.setCustomValidity('');if(event.target.id==='post-reason'){state.draft.reason=event.target.value.slice(0,300);const c=$('#reason-counter');if(c)c.textContent=`${state.draft.reason.length}/300`;}});
document.addEventListener('change',async event=>{if(event.target.dataset?.pushCategory){const key=event.target.dataset.pushCategory;if(!PUSH_CATEGORIES[key])return;const version=accountVersion;try{const settings=await api.saveNotificationPreferences({[key]:event.target.checked});if(version===accountVersion){pushSettings=settings;showToast('Notification preferences updated.');}}catch{if(version===accountVersion){event.target.checked=!event.target.checked;showToast('Could not update notifications.');}}}else if(event.target.id==='avatar-input'&&event.target.files?.[0])try{await galleryAvatar(event.target.files[0]);}catch(e){showToast(e.message);}});
document.addEventListener('submit',async event=>{
 const form=event.target;event.preventDefault();const values=Object.fromEntries(new FormData(form));
 try{
  if(form.id==='auth-form'){
   const res=state.authSignUp?await api.signUp(values.email,values.password):await api.signIn(values.email,values.password);
   if(!res){showToast('Check your email for a confirmation link.');return;}
   setCurrentUser(res);const account=accountVersion;
   await refreshFriends().catch(e=>console.warn('Could not refresh friend requests.',e));
   if(account!==accountVersion)return;
   const profile=await api.getMyProfile();if(account!==accountVersion)return;
   state.profile=profile;state.view=state.profile?'feed':'onboard';
   if(state.profile){
     const pending=savedInvite();
     if(pending){try{state.invitePreview=await api.previewInvite(pending);state.view='invite';}catch(e){showToast(e.message);}}
     if(state.view!=='invite')await home();else render();
   }else render();
  } else if(form.id==='onboard-form'){
   if(!values.adult)throw Error('You must be at least 18.');
   state.profile=await api.saveProfile({display_name:values.display_name.trim(),username:validateUsername(values.username),is_18_plus_confirmed:true});await home();const pending=savedInvite();if(pending){state.invitePreview=await api.previewInvite(pending);state.view='invite';render();}
  } else if(form.id==='edit-profile'){
   state.profile=await api.saveProfile({display_name:values.display_name.trim(),username:validateUsername(values.username),bio:values.bio.trim()});showToast('Profile updated!');await openProfile();
  } else if(form.dataset.form==='comment'){
   if(!values.body?.trim())return;
   if(!await confirmInApp('It cannot be edited later.', {title:'Post this comment?',action:'Post comment'}))return;
   await api.comment(form.dataset.post,values.body.trim());await refreshPosts();showToast('Comment posted.');
  }
 }catch(e){console.error(e);showToast(['onboard-form','edit-profile'].includes(form.id)?profileErrorMessage(e):(e.message||'Could not save.'));}
});
document.addEventListener('visibilitychange',refreshOnReturn);
window.addEventListener('focus',refreshOnReturn);
window.addEventListener('pageshow',event=>{if(event?.persisted&&state.view==='camera'&&!state.cameraStream)startCamera();return refreshOnReturn();});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installPrompt=event;scheduleInstall();});
window.addEventListener('appinstalled',()=>{state.installPrompt=null;dismissInstall();installNudgeDialog?.close();});
if('serviceWorker' in navigator&&['http:','https:'].includes(location.protocol))navigator.serviceWorker.register('/sw.js').catch(()=>{});
window.addEventListener('popstate',()=>closePhotoViewer(false));
window.addEventListener('pagehide',event=>{stopCamera();if(!event.persisted){closePhotoViewer(false);clearPhotoCache();for(const url of draftPhotoURLs.values())revokePhotoURL(url);draftPhotoURLs.clear();}});

(async()=>{
 state.view='loading';render();await boot();
})();
