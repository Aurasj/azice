// Optional local layout check: actual UI/CSS, synthetic data and simulated safe insets.
// No camera permission, Supabase, configuration loading or service worker is involved.
import http from 'node:http';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL(`../../${name}`,import.meta.url),'utf8');
const source=read('app.js').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'').replace(/^if\('serviceWorker'.*$/gm,'');
const viewport=read('index.html').match(/<meta name="viewport"[^>]+>/)[0];
const fixture=`
const params=new URLSearchParams(location.search),preset=params.get('safe')||'portrait';
const insets=({portrait:[59,0,34,0],landscape:[0,59,21,59],zero:[0,0,0,0]})[preset]||[59,0,34,0];
for(const [i,side] of ['top','right','bottom','left'].entries())document.documentElement.style.setProperty('--safe-'+side,insets[i]+'px');
const me={id:'test',display_name:'Test User',username:'test_user',bio:'A test profile.'},friend={id:'friend',display_name:'Test Friend',username:'test_friend'};
const friends={friends:[friend],incoming:[{id:'request',profile:friend}],outgoing:[]};
api={mode:'demo',getUser:async()=>({id:'test'}),getMyProfile:async()=>me,friendData:async()=>friends,getInvite:async()=>'test-invite',
 getFeed:async()=>state.feed,getHistory:async()=>[],imageUrl:async path=>path,
 commentAuthor:async()=>({...friend,relationship:'none'})};
setCurrentUser({id:'test'});state.profile=me;state.friends=friends;state.friendsLoaded=true;state.inviteToken='test-invite';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#a95328"/><rect x="20" y="20" width="1160" height="1560" fill="none" stroke="#f2a65a" stroke-width="20"/></svg>');
state.feed=[{id:'post',author_id:'test',published_at:new Date().toISOString(),kind:'drank',reason:'Safe-area layout verification',post_photos:[{path:image}],comments:[{id:'comment',author_id:'friend',author_name:'Test Friend',body:'A test comment.',created_at:new Date().toISOString()}],reactions:[]}];
state.activeComments.add('post');state.draft={kind:'sober',reason:'Safe-area layout verification',files:[],step:2};
const view=params.get('view')||'feed';state.view=['viewer','dialog','comment-card','install'].includes(view)?'feed':view;
const activityItems=[{event_key:'comment:layout',actor:{display_name:'Test Friend'},category:'comment',post_id:'post',created_at:new Date().toISOString(),read_at:null},{event_key:'reaction:layout',actor:{display_name:'Test Friend'},category:'reaction',post_id:'post',created_at:new Date(Date.now()-300000).toISOString(),read_at:null}];
api.getActivity=async()=>({items:activityItems,unread:activityItems.some(item=>!item.read_at)});
api.markActivityRead=async key=>{activityItems.find(item=>item.event_key===key).read_at=new Date().toISOString();return true;};
api.getPost=async id=>{const post=state.feed.find(post=>post.id===id);return post?{...post,author:me}:null;};
state.activity={items:activityItems,unread:true,loading:false,error:null};
if(view==='activity-empty'||view==='activity-error'){state.view='activity';state.activity.items=[];state.activity.unread=false;if(view==='activity-error')state.activity.error='Could not load activity. Please try again.';}
if(['notifications','profile'].includes(view)){
 config.pushPublicKey='layout-only-not-a-vapid-key';let preferences=pushDefaults();
 api.getNotificationPreferences=async()=>preferences;
 api.saveNotificationPreferences=async changes=>(preferences={...preferences,...changes});
 window.notificationLayout={view:()=>state.view,reminders:()=>pushSettings.posting_reminders,installed:()=>installed(),showDisable:()=>{pushSettings={...pushDefaults(),enabled:true};render();}};
}
if(view==='camera')state.cameraError='Camera permission is disabled in this layout fixture.';
if(view==='install')state.installHelp=true;
render();
if(view==='viewer')await openPhotoViewer(image);
if(view==='dialog')confirmInApp('Check that this confirmation remains readable and its actions stay reachable on short screens. '.repeat(8),{title:'Layout test',action:'Continue'});
if(view==='comment-card')await openCommentAuthor('comment');
const report=document.createElement('pre');report.id='safe-area-results';report.style='margin:20px;white-space:pre-wrap;font-size:12px';document.body.append(report);
function checkLayout(){
 const [top,right,bottom,left]=insets,results=[];
 const check=(name,pass,detail)=>results.push({name,pass,detail});
 const box=e=>e.getBoundingClientRect(),style=e=>getComputedStyle(e),number=(e,key)=>parseFloat(style(e)[key]);
 const xSafe=e=>box(e).left>=left-1&&box(e).right<=innerWidth-right+1;
 const header=document.querySelector('.header'),nav=document.querySelector('.bottom-nav'),content=document.querySelector('.content');
 const scroll=scrollY;window.scrollTo(0,0);
 check('No horizontal document overflow',document.documentElement.scrollWidth<=innerWidth,{viewport:innerWidth,document:document.documentElement.scrollWidth});
 if(header){check('Shared header reserves top inset once',Math.abs(box(header).height-(68+top))<2,box(header).height);
  check('Header actions do not overlap brand',box(header.querySelector('.brand')).right<=box(header.querySelector('.header-actions')).left+1);
  for(const control of header.querySelectorAll('button,.friend-request-dot'))check('Header control clears cutout',box(control).top>=top-1&&xSafe(control),control.getAttribute('aria-label')||'request dot');}
 if(content){check('Content clears expanded navigation',number(content,'paddingBottom')-box(nav).height>=30,{padding:number(content,'paddingBottom'),nav:box(nav).height});
  const back=content.querySelector('.subheader');if(back)check('Page title/Back follows shared header',box(back).top>=box(header).bottom-1);
  check('Content clears horizontal cutout',box(content).left+number(content,'paddingLeft')>=left-1&&box(content).right-number(content,'paddingRight')<=innerWidth-right+1);}
 if(nav){check('Navigation grows by bottom inset',Math.abs(box(nav).height-(78+bottom))<2,box(nav).height);
  for(const control of nav.querySelectorAll('button'))check('Navigation control clears Home indicator',box(control).bottom<=innerHeight-bottom+1&&xSafe(control),control.getAttribute('aria-label')||control.textContent.trim());}
 const camera=document.querySelector('.camera-screen');if(camera){
  check('Camera header clears cutout',[...camera.querySelectorAll('.camera-header button')].every(e=>box(e).top>=top-1&&xSafe(e)));
  const before=camera.scrollTop;camera.scrollTop=camera.scrollHeight;
  check('Camera shutter reachable above Home indicator',box(camera.querySelector('.shutter')).bottom<=innerHeight-bottom+1&&xSafe(camera.querySelector('.shutter')));
  check('Camera allows short-height scrolling',style(camera).overflowY==='auto');camera.scrollTop=before;}
 for(const dialog of document.querySelectorAll('dialog[open],.modal')){
  const fullPhoto=dialog.classList.contains('full-photo-viewer'),surface=fullPhoto?dialog.querySelector('img'):dialog;
  const b=box(surface);check('Dialog content stays in safe vertical viewport',b.top>=top-1&&b.bottom<=innerHeight-bottom+1,{top:b.top,bottom:b.bottom});check('Dialog content stays in safe horizontal viewport',xSafe(surface));
  if(!fullPhoto)check('Short dialogs can scroll',style(dialog).overflowY==='auto');}
 const close=document.querySelector('.viewer-close');if(close)check('Full-photo close clears cutout',box(close).top>=top+11&&xSafe(close));
 const entry=document.querySelector('.notifications-entry');if(entry){check('Profile notification entry is comfortably tappable',box(entry).height>=44&&xSafe(entry));check('Profile notification entry follows calendar and precedes history',box(entry).top>=box(document.querySelector('.calendar')).bottom&&box(entry).bottom<=box(entry.nextElementSibling).top);}
 const activityRows=[...document.querySelectorAll('.activity-row')];if(activityRows.length){
  for(const row of activityRows)check('Activity row is safe and tappable',box(row).height>=44&&xSafe(row));
  activityRows.at(-1).scrollIntoView({block:'start'});check('Last Activity row clears navigation',box(activityRows.at(-1)).bottom<=box(nav).top+1);
 }
 const notificationRows=[...document.querySelectorAll('.notification-switch-row')];if(notificationRows.length){
  check('Exactly five notification switch rows',notificationRows.length===5);
  for(const row of notificationRows)check('Notification row has a safe, full-width tap target',box(row).height>=44&&xSafe(row)&&box(row.querySelector('.notification-switch')).right<=box(row).right);
  check('Posting reminders default off',!document.querySelector('[data-push-category="posting_reminders"]').checked);
  const last=document.querySelector('.notification-disable')||document.querySelector('.notification-quiet');last.scrollIntoView({block:'start'});
  check('Last notification control/text can scroll clear of navigation',box(last).bottom<=box(nav).top+1,{bottom:box(last).bottom,navTop:box(nav).top});
 }
 const centered=document.querySelector('.centered');if(centered)check('Standalone page content clears safe edges',number(centered,'paddingTop')>=top+1&&box(centered).left+number(centered,'paddingLeft')>=left-1);
 window.scrollTo(0,scroll);report.textContent=JSON.stringify({simulated:true,preset,view,viewport:[innerWidth,innerHeight],insets,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass),results},null,2);
}
checkLayout();window.addEventListener('resize',()=>requestAnimationFrame(checkLayout));
`;
http.createServer((req,res)=>{
 if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(read('styles.css'));}
 else if(req.url==='/'||req.url.startsWith('/?')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><head><meta charset="utf-8">'+viewport+'<title>AziCe? simulated safe-area check</title><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div><div id="toast" class="toast" hidden></div><script type="module">'+source+'\n'+fixture+'</script></body></html>');}
 else{res.statusCode=404;res.end();}
}).listen(5198,'127.0.0.1',()=>console.log('Safe-area fixture: http://localhost:5198/?safe=portrait&view=feed'));
