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
const SUGGEST = {
  drank: ["It's a special occasion. Don't ask whose.", "I only came for water. Things escalated.", "My dog had a birthday party. 🐶", "A small victory deserves a story."],
  sober: ["Tea and an early night. ☕", "I'm under the weather today. 🤧", "Just didn't feel like it.", "Big plans tomorrow. Staying fresh!"]
};
const state = {
  view:'loading', user:null, profile:null, friends:{friends:[],incoming:[],outgoing:[]},
  feed:[], history:[], month:new Date(), selectedDate:'', target:null, inviteToken:null,
  activeComments:new Set(), activeReactions:null, authSignUp:false,
  draft:{kind:'drank',reason:'',files:[],step:0},
  cameraStream:null, cameraError:null, installPrompt:null, installHelp:false,
  cache:new Map(), demo:false
};
let api;
const html = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = date => new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const dayISO = value => {const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const isActive = post => Date.now()-new Date(post.published_at).getTime()<48*HOUR;
const who = post => post.author_id===state.user?.id ? 'You' : (post.author?.display_name || 'Friend');
const own = p => p.author_id===state.user?.id;
function showToast(message) { const el=$('#toast'); el.textContent=message; el.hidden=false; clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.hidden=true,3800); }
// App-styled confirmation; no browser-native confirm() popup.
function confirmInApp(message, { title = 'Are you sure?', action = 'Confirm', danger = false } = {}) {
 return new Promise(resolve => {
  const dialog = document.createElement('dialog');
  dialog.className = 'azice-confirm';
  dialog.setAttribute('aria-labelledby', 'azice-confirm-title');
  dialog.innerHTML = `<div class="azice-confirm-content">
   <h2 id="azice-confirm-title">${html(title)}</h2>
   <p>${html(message)}</p>
   <div class="azice-confirm-actions">
    <button type="button" class="secondary" data-choice="cancel">Cancel</button>
    <button type="button" class="${danger ? 'azice-danger-button' : 'primary'}" data-choice="accept">${html(action)}</button>
   </div>
  </div>`;
  let accepted = false;
  const previousFocus = document.activeElement;
  dialog.addEventListener('click', e => {
   const choice = e.target.closest('[data-choice]');
   if (choice) { accepted = choice.dataset.choice === 'accept'; dialog.close(); }
   else if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
   dialog.remove();
   if (previousFocus?.isConnected) previousFocus.focus();
   resolve(accepted);
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('[data-choice="cancel"]').focus();
 });
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
   api=await loadSupabase();
   state.demo=api.mode==='demo';
   state.user=await api.getUser();
   if(!state.user){
     state.view='auth';
     render();
     return;
   }
   const profile=await api.getMyProfile();
   if(!profile){
     state.view='onboard';
     render();
     return;
   }
   state.profile=profile;
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
async function home(){state.feed=await hydrate(await api.getFeed());state.view='feed';render();}
async function openProfile(){state.profile=await api.getMyProfile();state.history=await hydrate(await api.getHistory(state.user.id));state.view='profile';render();}
async function openFriendProfile(id){const p=await api.getProfile(id);if(!p)throw Error('Profile unavailable');state.target=p;state.history=await hydrate(await api.getHistory(id));state.view='friendProfile';render();}
async function openFriends(){state.friends=await api.friendData();state.inviteToken=await api.getInvite();state.view='friends';render();}
function brand(){return `<div class="brand">AziCe<span>?</span></div>`;}
function headerAvatar(){
 const p=state.profile;const path=p?.avatar_path;
 const src=path?(path.startsWith('data:')?path:(path.startsWith('avatar:')?path:`avatar:${path}`)):null;
 return `<button aria-label="Open profile" class="avatar mini" data-action="profile">${src?`<img data-private-photo="${html(src)}" alt="${html(p?.display_name||'User')} avatar">`:initials(p?.display_name)}</button>`;
}
function shell(content, tab='feed'){
 return `<div class="app-shell">
  <header class="header">${brand()}${headerAvatar()}</header>
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
function photoCard(photo,idx){const path=html(photo.path);return `<div class="photo-slide"><div class="photo-loading">📷</div><img data-private-photo="${path}" alt="Photo ${idx+1}" loading="lazy"></div>`;}
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
     ${(p.comments||[]).length ? p.comments.map(c=>`<div class="comment"><b>${html(c.author_id===state.user.id?'You':c.author_name)}</b> ${html(c.body)}<small>${fmt(c.created_at)}</small></div>`).join(''):'<p class="muted small-text">No comments yet.</p>'}
     ${active?`<form data-form="comment" data-post="${html(p.id)}" class="comment-form"><input name="body" maxlength="300" required placeholder="Write a comment..." aria-label="Write a comment"><button type="submit" aria-label="Post comment">➤</button></form>`:'<div class="muted small-text">Comments are closed after 48 hours.</div>'}
   </section>`:''}
 </article>`;
}
function emptyFeed(){return `<div class="empty-state"><div class="empty-art">👀</div><h2>Pretty quiet in here...</h2><p>The crew hasn't shown up yet. Invite your friends and see what their excuse is today.</p><button class="primary" data-action="friends">Invite Friends ↗</button><button class="text-button" data-action="start-post">Or be the first to post →</button></div>`;}
function feedView(){return shell(`<div class="page-title"><h1>What's happening?</h1><span>Last 48 hours</span></div>
 ${state.feed.length?state.feed.map(postCard).join(''):emptyFeed()}`,'feed');}
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
 const p=state.profile;return shell(`${profileHeader(p,true)}<button class="wide-outline" data-action="friends">♧ Friends & Invites →</button>
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
 return shell(`${backBar('Friends & Invites')}<section class="invite-card"><div class="invite-head">↗ &nbsp;Invite your crew</div><p>Share your link. Every friendship request needs your approval.</p><div class="invite-url">${html(link)}</div><div class="button-pair"><button class="primary" data-action="share-invite">Share Link</button><button class="secondary" data-action="rotate-invite">New Link</button></div></section>
 <div class="section-heading"><h2>Requests Received</h2><span>${f.incoming.length}</span></div>
 ${f.incoming.length?f.incoming.map(r=>friendRow(r.profile,`<button class="small-primary" data-action="request" data-id="${html(r.id)}" data-value="accept">Accept</button><button class="small-secondary" data-action="request" data-id="${html(r.id)}" data-value="decline">Decline</button>`)).join(''):'<p class="muted small-text">No pending requests.</p>'}
 <div class="section-heading"><h2>Requests Sent</h2><span>${f.outgoing.length}</span></div>
 ${f.outgoing.length?f.outgoing.map(r=>friendRow(r.profile,`<button class="small-secondary" data-action="request" data-id="${html(r.id)}" data-value="cancel">Cancel</button>`)).join(''):'<p class="muted small-text">No sent requests.</p>'}
 <div class="section-heading"><h2>Friends</h2><span>${f.friends.length}</span></div>
 ${f.friends.length?f.friends.map(p=>friendRow(p,`<button class="small-secondary" data-action="friend-profile" data-id="${html(p.id)}">View</button><button class="small-danger" data-action="unfriend" data-id="${html(p.id)}">Remove</button>`)).join(''):'<p class="muted small-text">Your friends will appear here.</p>'}`,'profile');
}
function authView(){const signup=state.authSignUp;return `<main class="centered auth-screen">${brand()}<p class="tagline">Every day has a story.</p><div class="auth-panel"><h1>${signup?'Create your account':'Welcome back'}</h1><p>${signup?'Join the crew. Just be yourself.':'See what the crew is up to.'}</p><form id="auth-form"><label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" minlength="6" autocomplete="${signup?'new-password':'current-password'}" required placeholder="At least 6 characters"></label><button class="primary" type="submit">${signup?'Sign Up':'Sign In'}</button></form><div class="or">or</div><button class="wide-outline" data-action="google">Continue with Google</button><p class="auth-switch">${signup?'Already have an account?':'New here?'} <button class="inline-link" data-action="toggle-auth">${signup?'Sign In':'Sign Up'}</button></p></div>${state.demo?'<div class="demo-banner auth-demo">Preview mode — Supabase is not configured. Explore the interface locally.</div><button class="secondary" data-action="demo-enter">Explore Demo</button>':''}</main>`;}
function onboardView(){return `<main class="centered auth-screen">${brand()}<p class="tagline">One last thing...</p><div class="auth-panel"><h1>Set up your profile</h1><p>Your story, your identity.</p><form id="onboard-form"><label>Display Name<input name="display_name" maxlength="60" required placeholder="Alex"></label><label>Username<input name="username" pattern="[a-zA-Z0-9_]{3,24}" required maxlength="24" placeholder="alex_22" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label><label class="checkline"><input name="adult" type="checkbox" required> I confirm I am at least 18 years old.</label><button class="primary" type="submit">Let's Go →</button></form></div></main>`;}
function editProfileView(){const p=state.profile;return shell(`${backBar('Edit Profile')}<form id="edit-profile" class="edit-form"><div class="profile-avatar-center">${avatar(p,'large')}<label class="gallery-label">Choose from Gallery<input type="file" accept="image/*" id="avatar-input" hidden></label></div><label>Display Name<input name="display_name" required maxlength="60" value="${html(p.display_name)}"></label><label>Username<input name="username" required pattern="[a-zA-Z0-9_]{3,24}" maxlength="24" value="${html(p.username)}" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label><label>Bio<textarea name="bio" maxlength="150" rows="3" placeholder="Tell your story...">${html(p.bio||'')}</textarea><small>Max. 150 characters</small></label><button class="primary" type="submit">Save Changes</button></form>`,'profile');}
function newPostView(){const d=state.draft;
 let content='';
 if(d.step===0)content=`<h1>What's the story today?</h1><p class="muted">Choose one. No pressure either way.</p><div class="choice-grid"><button class="choice ${d.kind==='drank'?'chosen':''}" data-action="choose-kind" data-value="drank"><span>🍺</span>I Drank</button><button class="choice ${d.kind==='sober'?'chosen':''}" data-action="choose-kind" data-value="sober"><span>🧃</span>I Didn't Drink</button></div>`;
 if(d.step===1)content=`<h1>Capture the moment</h1><p class="muted">Up to 3 photos, straight from your camera. ${d.kind==='drank'?'At least 1 required.':'Photos are optional.'}</p><div class="capture-list">${d.files.map((f,i)=>`<div class="capture-thumb"><img src="${URL.createObjectURL(f)}" alt="Captured photo"><button data-action="remove-photo" data-id="${i}" aria-label="Remove photo">×</button></div>`).join('')}${d.files.length<3?'<button class="capture-add" data-action="open-camera">＋<small>Take Photo</small></button>':''}</div><div class="camera-note">📷 Photos must be taken in the app. Gallery uploads are disabled for posts.</div>`;
 if(d.step===2)content=`<h1>What's your reason?</h1><p class="muted">A good excuse makes a good story.</p><textarea id="post-reason" maxlength="300" rows="5" placeholder="Tell your story...">${html(d.reason)}</textarea><div class="char-count"><span>Required</span><span id="reason-counter">${d.reason.length}/300</span></div><p class="section-label">Need inspiration?</p><div class="suggestions">${SUGGEST[d.kind].map((s,i)=>`<button data-action="suggest" data-id="${i}">${html(s)}</button>`).join('')}</div>`;
 if(d.step===3)content=`<h1>Review your post</h1><p class="muted">Once published, posts can't be edited.</p><div class="review-card"><span class="kind ${d.kind==='drank'?'drink':'sober'}">${d.kind==='drank'?'🍺 I Drank':'🧃 I Didn\'t Drink'}</span><div class="capture-list">${d.files.map(f=>`<div class="capture-thumb"><img src="${URL.createObjectURL(f)}" alt="Preview"></div>`).join('')}</div><p>${html(d.reason)}</p></div><p class="safety-note">Your post is shared only with confirmed friends. It stays in Feed for 48 hours, then moves to your private archive.</p>`;
 return shell(`${backBar('New Post','cancel-post')}<div class="step-indicator">STEP ${d.step+1} OF 4</div><div class="new-post">${content}</div><div class="post-actions">${d.step>0?'<button class="secondary" data-action="post-back">Back</button>':''}<button class="primary" data-action="post-next">${d.step===3?'Publish Post':'Continue →'}</button></div>`,'feed');
}
function cameraView(){return `<main class="camera-screen"><div class="camera-header"><button data-action="close-camera" aria-label="Close camera">×</button><span>Take Photo</span><button data-action="flip-camera" aria-label="Switch camera">⟳</button></div>${state.cameraError?`<div class="camera-error">${html(state.cameraError)}</div>`:'<video id="camera-preview" autoplay playsinline muted></video>'}<div class="camera-footer"><span>${state.draft.files.length}/3 photos</span><button class="shutter" data-action="capture-photo" aria-label="Capture photo"></button><span>Camera only</span></div></main>`;}
function inviteView(preview){return `<main class="centered auth-screen">${brand()}<div class="auth-panel"><h1>Friend Invitation</h1>${preview?`<p><b>${html(preview.display_name)}</b> invited you to connect on AziCe?.</p><p class="muted">@${html(preview.username)} · Posts remain private until accepted.</p><button class="primary" data-action="send-request">Send Friend Request</button>`:'<p>This invite link has expired or was revoked.</p>'}<button class="secondary" data-action="dismiss-invite">Go to Feed</button></div></main>`;}
function installInfo(){return `<div class="modal-backdrop" data-action="close-install"><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><h2>Install AziCe?</h2><p>On iPhone: open in Safari, tap Share, then <b>Add to Home Screen</b> and enable <b>Open as Web App</b> if offered.</p><p>On Android: open the browser menu and select <b>Install app</b> or <b>Add to Home screen</b>.</p><button class="primary" data-action="close-install">Got It</button></div></div>`;}
function render(){
 const root=$('#app');
 switch(state.view){
 case 'auth':root.innerHTML=authView();break;
 case 'onboard':root.innerHTML=onboardView();break;
 case 'feed':root.innerHTML=feedView();break;
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
}
function loadImages(){
 for(const img of document.querySelectorAll('[data-private-photo]')){
  const path=img.dataset.privatePhoto;if(!path)continue;
  const load=state.cache.has(path)?Promise.resolve(state.cache.get(path)):api.imageUrl(path).then(url=>{state.cache.set(path,url);return url;});
  load.then(url=>{if(img.isConnected){img.src=url;img.classList.add('loaded');}}).catch(()=>{if(img.isConnected)img.alt='Photo unavailable';});
 }
}
let cameraFacing='environment';
async function startCamera(){
 if(!navigator.mediaDevices?.getUserMedia){state.cameraError='Camera unavailable. Use HTTPS or localhost and a phone with a camera.';state.view='camera';render();return;}
 state.cameraError=null;state.view='camera';render();
 try{
  state.cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:cameraFacing},width:{ideal:1280},height:{ideal:1280}}});
  attachCamera();
 }catch(e){state.cameraError=`Could not open camera: ${e.message}`;render();}
}
function attachCamera(){const video=$('#camera-preview');if(video&&state.cameraStream){video.srcObject=state.cameraStream;video.play().catch(()=>{});}}
function stopCamera(){if(state.cameraStream){state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;}}
async function canvasBlob(source,width,height){
 const canvas=document.createElement('canvas');const max=1280;const factor=Math.min(1,max/Math.max(width,height));canvas.width=Math.round(width*factor);canvas.height=Math.round(height*factor);
 const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Photo conversion failed')),'image/jpeg',.78));
}
async function capture(){
 const video=$('#camera-preview');if(!video||!video.videoWidth)throw Error('Camera is not ready.');
 const file=await canvasBlob(video,video.videoWidth,video.videoHeight);
 state.draft.files.push(file);stopCamera();state.view='new';render();
}
async function galleryAvatar(file){
 if(!file?.type?.startsWith('image/'))throw Error('Choose an image.');
 const image=await createImageBitmap(file);let blob;
 try{
  const n=Math.min(image.width,image.height),x=(image.width-n)/2,y=(image.height-n)/2;
  const c=document.createElement('canvas');c.width=512;c.height=512;c.getContext('2d').drawImage(image,x,y,n,n,0,0,512,512);
  blob=await new Promise((ok,no)=>c.toBlob(b=>b?ok(b):no(Error('Avatar conversion failed')),'image/jpeg',.85));
 }finally{image.close();}
 const path=await api.saveAvatar(blob);state.profile.avatar_path=path;showToast('Profile photo updated.');render();
}
async function refreshPosts(){if(state.view==='feed')state.feed=await hydrate(await api.getFeed());else if(['profile','friendProfile','day'].includes(state.view))state.history=await hydrate(await api.getHistory(state.view==='friendProfile'?state.target.id:state.user.id));render();}
async function handleAction(button){const a=button.dataset.action,id=button.dataset.id,val=button.dataset.value;
 switch(a){
 case 'feed': stopCamera();await home();break;
 case 'profile':stopCamera();await openProfile();break;
 case 'friends':stopCamera();await openFriends();break;
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
 case 'send-request':await api.sendRequest(savedInvite());sessionStorage.removeItem('azice_pending_invite');history.replaceState({},'',location.pathname);await home();showToast('Friend request sent!');break;
 case 'dismiss-invite':sessionStorage.removeItem('azice_pending_invite');history.replaceState({},'',location.pathname);await home();break;
 case 'toggle-auth':state.authSignUp=!state.authSignUp;render();break;
 case 'google':await api.google();break;
 case 'demo-enter':state.user=await api.getUser();state.profile=await api.getMyProfile();await home();break;
 case 'sign-out':await api.signOut();state.user=null;state.profile=null;state.view='auth';render();break;
 case 'reset-demo':if(await confirmInApp('This clears your local demo posts and comments.', {title:'Reset demo data?',action:'Reset demo',danger:true})){await api.resetDemo();await openProfile();showToast('Demo reset.');}break;
 case 'delete-account':{
   if(!await confirmInApp('All your posts, photos, comments, and friendships will be permanently erased. This cannot be undone.', {title:'Delete your account?',action:'Continue',danger:true}))return;
   if(!await confirmInApp('This permanently deletes your AziCe? account and cannot be undone.', {title:'Final confirmation',action:'Delete account',danger:true}))return;
   button.disabled=true;button.textContent='Deleting...';
   try{await api.deleteAccount();state.user=null;state.profile=null;state.view='auth';render();showToast('Your account and data have been deleted.');}
   finally{button.disabled=false;}
   break;
 }
 case 'install':if(state.installPrompt){await state.installPrompt.prompt();state.installPrompt=null;}else{state.installHelp=true;render();}break;
 case 'close-install':state.installHelp=false;render();break;
 }
}
document.addEventListener('click',async event=>{
 const btn=event.target.closest('[data-action]');if(!btn)return;
 event.preventDefault();
 try{await handleAction(btn);}catch(e){
  console.error(e);
  if(isSessionMissingOrInvalid(e)){state.user=null;state.profile=null;state.view='auth';render();showToast('Your session expired. Please sign in again.');}
  else showToast(e.message||'Something went wrong.');
 }
});
document.addEventListener('input',event=>{if(event.target.id==='post-reason'){state.draft.reason=event.target.value.slice(0,300);const c=$('#reason-counter');if(c)c.textContent=`${state.draft.reason.length}/300`;}});
document.addEventListener('change',async event=>{if(event.target.id==='avatar-input'&&event.target.files?.[0])try{await galleryAvatar(event.target.files[0]);}catch(e){showToast(e.message);}});
document.addEventListener('submit',async event=>{
 const form=event.target;event.preventDefault();const values=Object.fromEntries(new FormData(form));
 try{
  if(form.id==='auth-form'){
   const res=state.authSignUp?await api.signUp(values.email,values.password):await api.signIn(values.email,values.password);
   if(!res){showToast('Check your email for a confirmation link.');return;}
   state.user=res;state.profile=await api.getMyProfile();state.view=state.profile?'feed':'onboard';
   if(state.profile){
     const pending=savedInvite();
     if(pending){try{state.invitePreview=await api.previewInvite(pending);state.view='invite';}catch(e){showToast(e.message);}}
     if(state.view!=='invite')await home();else render();
   }else render();
  } else if(form.id==='onboard-form'){
   if(!values.adult)throw Error('You must be at least 18.');
   state.profile=await api.saveProfile({display_name:values.display_name.trim(),username:values.username.toLowerCase(),is_18_plus_confirmed:true});await home();const pending=savedInvite();if(pending){state.invitePreview=await api.previewInvite(pending);state.view='invite';render();}
  } else if(form.id==='edit-profile'){
   state.profile=await api.saveProfile({display_name:values.display_name.trim(),username:values.username.toLowerCase(),bio:values.bio.trim()});showToast('Profile updated.');await openProfile();
  } else if(form.dataset.form==='comment'){
   if(!values.body?.trim())return;
   if(!await confirmInApp('It cannot be edited later.', {title:'Post this comment?',action:'Post comment'}))return;
   await api.comment(form.dataset.post,values.body.trim());await refreshPosts();showToast('Comment posted.');
  }
 }catch(e){console.error(e);showToast(e.message||'Could not save.');}
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installPrompt=event;});
if('serviceWorker' in navigator&&['http:','https:'].includes(location.protocol))navigator.serviceWorker.register('/sw.js').catch(()=>{});
(async()=>{
 state.view='loading';render();await boot();
})();
