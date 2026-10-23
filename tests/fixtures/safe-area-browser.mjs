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
