import {compactCSS} from './fixtures/css-contract.mjs';
import {runAppInContext} from './fixtures/app-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCloud } from '../cloud.js';

// Unit tests use mocked DOM/canvas/Storage. The optional fixtures/photos-browser.mjs
// exercises real rendering, browser JPEG encoding and EXIF/GPS removal separately.

const raw=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=compactCSS(fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8'));
const source=raw.replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'');
function setup(){
 const events={window:{},document:{}},canvases=[],created=[],revoked=[],dialogs=[],uploads=[],draws=[];
 const root={innerHTML:''},toast={},video={videoWidth:4032,videoHeight:3024,play:async()=>{}};
 const trigger={isConnected:true,focus(){document.activeElement=this;}};
 let encode,contextAvailable=true,bitmap={width:2000,height:1000,closed:false,close(){this.closed=true;}};
 const document={activeElement:trigger,visibilityState:'visible',body:{style:{overflow:'auto'},append(d){dialogs.push(d);}},
  querySelector:s=>s==='#app'?root:s==='#camera-preview'?video:s==='#toast'?toast:null,
  querySelectorAll:()=>[],addEventListener:(type,fn)=>{events.document[type]=fn;},
  createElement(type){
   if(type==='canvas'){
    const canvas={width:0,height:0,getContext:()=>contextAvailable?{drawImage:(...args)=>draws.push(args),fillRect(){}}:null,
     toBlob(fn,mime,quality){canvas.mime=mime;canvas.quality=quality;if(encode)encode(fn);else fn(new Blob(['encoded pixels'],{type:mime}));}};
    canvases.push(canvas);return canvas;
   }
   assert.equal(type,'dialog');const listeners={};
   const button={addEventListener:(t,f)=>{button[t]=f;},focus(){document.activeElement=button;}};
   const status={},img={};
   return {listeners,button,status,img,setAttribute(k,v){this[k]=v;},querySelector:s=>s==='button'?button:s==='img'?img:status,
    addEventListener:(t,f)=>{listeners[t]=f;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}};
  }};
 const history={state:{existing:'kept'},backs:0,pushState(value){this.state=value;},back(){this.backs++;this.state={existing:'kept'};events.window.popstate();}};
 const context=vm.createContext({Blob,URLSearchParams,console,Map,Set,Date,Number,history,
  URL:{createObjectURL(file){const url=`blob:photo-${created.length}`;created.push({file,url});return url;},revokeObjectURL:url=>revoked.push(url)},
  document,navigator:{},location:{search:'',origin:'http://localhost',protocol:'http:'},
  createImageBitmap:async(file,options)=>{assert.equal(options.imageOrientation,'from-image');return bitmap;},
  sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},
  window:{AZICE_CONFIG:{},addEventListener:(t,f)=>{events.window[t]=f;},scrollTo(){}}});
 runAppInContext(source+`\nglobalThis.app={state,setCurrentUser,canvasBlob,capture,startCamera,stopCamera,galleryAvatar,decodeAvatar,
  privatePhotoURL,clearPhotoCache,draftPhotoURL,cleanDraftPhotoURLs,openPhotoViewer,closePhotoViewer,photoCard,newPostView,editProfileView,handleAction,
  setApi:value=>{api=value;},getViewer:()=>photoViewer};`,context);
 const app=context.app,api={mode:'cloud',imageUrl:async path=>`blob:${path}`,getMyProfile:async()=>({id:'a',display_name:'Alex',username:'alex'}),saveAvatar:async file=>{uploads.push(file);return 'avatar:a/new.jpg';}};
 app.setApi(api);app.setCurrentUser({id:'a'});app.state.profile={id:'a',display_name:'Alex',username:'alex'};app.state.view='new';
 return {app,api,context,document,history,events,canvases,draws,created,revoked,dialogs,uploads,video,trigger,root,toast,
  setEncode:fn=>{encode=fn;},setContext:v=>{contextAvailable=v;},setBitmap:value=>{bitmap=value;},get bitmap(){return bitmap;}};
}

for(const [width,height,expected] of [
 [3024,4032,[1200,1600]],[4032,3024,[1600,1200]],[2048,2048,[1600,1600]],
 [8000,100,[1600,20]],[1,12000,[1,1600]],[240,320,[240,320]],[640,240,[640,240]],
 [1600,900,[1600,900]],[7,7,[7,7]]
])test(`post processing: ${width}×${height} preserves the full frame, max 1600, no upscale`,async()=>{
 const h=setup(),frame={width,height};const blob=await h.app.canvasBlob(frame,width,height),c=h.canvases[0];
 assert.deepEqual([c.width,c.height],expected);assert.ok(c.width<=width&&c.height<=height);
 assert.deepEqual(h.draws[0],[frame,0,0,...expected]); // Full source; no source crop coordinates.
 assert.equal(c.mime,'image/jpeg');assert.equal(c.quality,.8);assert.equal(blob.type,'image/jpeg');
 assert.ok(Math.abs(c.width/c.height-width/height)<=1/c.height+width/height/c.height);
});

test('encoding creates a fresh JPEG from pixels, never copies source metadata or retains an original',async()=>{
 const h=setup();h.app.state.view='camera';await h.app.capture();
 assert.equal(h.app.state.draft.files.length,1);assert.equal(h.app.state.draft.files[0].type,'image/jpeg');
 assert.equal(h.canvases.length,1);assert.equal(await h.app.state.draft.files[0].text(),'encoded pixels');
 assert.equal(h.app.state.view,'new'); // Preview and upload share this same blob.
 const blob=h.app.state.draft.files[0];h.app.state.draft.step=3;const markup=h.app.newPostView();h.app.newPostView();
 assert.equal(h.canvases.length,1);assert.equal(h.created[0].file,blob);
 assert.match(markup,/class="photo-scroller" aria-label="Preview photos"/);
 assert.ok(markup.includes(h.app.photoCard({path:h.created[0].url},0)));
});

test('invalid dimensions, missing canvas context and failed/non-JPEG encoders give English errors',async()=>{
 const h=setup();for(const dims of [[0,10],[10,-1],[NaN,10],[Infinity,1]])await assert.rejects(h.app.canvasBlob({},...dims),/dimensions are invalid/);
 h.setContext(false);await assert.rejects(h.app.canvasBlob({},10,10),/processing is unavailable/);
 h.setContext(true);h.setEncode(fn=>fn(null));await assert.rejects(h.app.canvasBlob({},10,10),/Could not process photo/);
 h.setEncode(fn=>fn(new Blob(['png'],{type:'image/png'})));await assert.rejects(h.app.canvasBlob({},10,10),/Could not process photo/);
});

test('4:5 Feed/preview cover frame, native swipe snapping, indicators and reduced motion stay supported',()=>{
 assert.match(css,/\.photo-slide\{[^}]*aspect-ratio:4\/5/);
 assert.match(css,/\.photo-slide img\{[^}]*object-fit:cover/);
 assert.match(css,/\.photo-slide img\{object-position:center/);
 assert.match(css,/\.photo-slide\{flex:0 0 100%/);
 assert.match(css,/\.photo-scroller\{[^}]*overflow-x:auto[^}]*scroll-snap-type:x mandatory/);
 assert.match(css,/scroll-snap-align:start/);assert.match(raw,/Swipe to view/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\).*transition:none/);
 const h=setup();assert.match(h.app.photoCard({path:'a/post/photo.jpg'},0),/<button type="button"[^>]*data-action="view-photo"[^>]*aria-label="Open full photo 1"/);
});

test('post photo controls remain camera-only with at most three; avatar alone retains gallery input',async()=>{
 const h=setup();h.app.state.draft.step=1;
 const markup=h.app.newPostView();assert.doesNotMatch(markup,/type="file"/);assert.match(markup,/data-action="open-camera"/);
 assert.match(markup,/Gallery uploads are disabled/);
 h.app.state.draft.files=[new Blob(),new Blob(),new Blob()];
 assert.doesNotMatch(h.app.newPostView(),/data-action="open-camera"/);
 await assert.rejects(h.app.capture(),/up to 3 photos/);await assert.rejects(h.app.startCamera(),/up to 3 photos/);
 assert.match(h.app.editProfileView(),/Choose from Gallery<input type="file" accept="image\/\*" id="avatar-input" hidden>/);
});

test('existing post-type photo requirements remain: drank requires one and sober permits zero',async()=>{
 const h=setup();h.app.state.draft.step=1;
 await assert.rejects(h.app.handleAction({dataset:{action:'post-next'}}),/Take at least one photo/);
 h.app.state.draft.kind='sober';await h.app.handleAction({dataset:{action:'post-next'}});assert.equal(h.app.state.draft.step,2);
});

test('capture ignores duplicate shutter taps and late encoding after closing/switching camera',async()=>{
 const h=setup();let finish;h.setEncode(fn=>{finish=fn;});h.app.state.view='camera';
 const first=h.app.capture();await h.app.capture();assert.equal(h.canvases.length,1);
 h.app.stopCamera();finish(new Blob(['photo'],{type:'image/jpeg'}));await first;assert.equal(h.app.state.draft.files.length,0);
 h.setEncode(null);h.app.state.view='camera';await h.app.capture();assert.equal(h.app.state.draft.files.length,1);
});

test('camera permission failure is reported; switching/closing stops current and late streams',async()=>{
 const h=setup();await h.app.startCamera();assert.match(h.app.state.cameraError,/Camera unavailable/);
 h.context.navigator.mediaDevices={getUserMedia:async()=>{throw Error('Permission denied');}};
 await h.app.startCamera();assert.match(h.app.state.cameraError,/Could not open camera: Permission denied/);
 let resolve,stops=0;const stream={getTracks:()=>[{stop(){stops++;}}]};
 h.context.navigator.mediaDevices.getUserMedia=options=>{assert.equal(options.audio,false);assert.equal(options.video.width.ideal,1600);return new Promise(r=>{resolve=r;});};
 const pending=h.app.startCamera();h.app.stopCamera();resolve(stream);await pending;assert.equal(stops,1);assert.equal(h.app.state.cameraStream,null);
 h.context.navigator.mediaDevices.getUserMedia=async options=>{assert.equal(options.video.facingMode.ideal,'user');return stream;};
 await h.app.handleAction({dataset:{action:'flip-camera'}});assert.equal(h.app.state.cameraStream,stream);
 await h.app.handleAction({dataset:{action:'close-camera'}});assert.equal(stops,2);assert.equal(h.app.state.view,'new');
});

test('camera resumes after a back-forward-cache return without losing captured draft photos',async()=>{
 const h=setup();let streams=0,stops=0;
 h.api.getUser=async()=>h.app.state.user;h.api.friendData=async()=>h.app.state.friends;
 h.context.navigator.mediaDevices={getUserMedia:async()=>{streams++;return {getTracks:()=>[{stop(){stops++;}}]};}};
 h.app.state.draft.files=[new Blob()];await h.app.startCamera();h.events.window.pagehide({persisted:true});
 assert.equal(stops,1);assert.equal(h.app.state.cameraStream,null);
 await h.events.window.pageshow({persisted:true});assert.equal(streams,2);assert.ok(h.app.state.cameraStream);assert.equal(h.app.state.draft.files.length,1);
});

test('draft preview URLs are reused, revoked on removal/cancel, and do not re-encode',async()=>{
 const h=setup(),file=new Blob(['jpeg'],{type:'image/jpeg'});h.app.state.draft.files=[file];
 assert.equal(h.app.draftPhotoURL(file),h.app.draftPhotoURL(file));assert.equal(h.created.length,1);
 h.app.state.draft.files=[];h.app.cleanDraftPhotoURLs();assert.deepEqual(h.revoked,['blob:photo-0']);
 assert.equal(h.canvases.length,0);
});

for(const close of ['button','escape','back'])test(`full-photo viewer ${close}: contain, focus restoration, no redundant download`,async()=>{
 const h=setup();let reads=0;h.api.imageUrl=async()=>{reads++;return 'blob:private';};
 await h.app.privatePhotoURL('a/post/1.jpg');await h.app.openPhotoViewer('a/post/1.jpg');
 const d=h.dialogs[0];assert.equal(reads,1);assert.equal(d.img.src,'blob:private');assert.equal(d['aria-label'],'Full photo');
 assert.equal(h.document.activeElement,d.button);assert.equal(h.document.body.style.overflow,'hidden');
 assert.equal(h.history.state.existing,'kept');assert.match(css,/\.full-photo-viewer img\{[^}]*object-fit:contain/);
 if(close==='button')d.button.click();
 if(close==='escape'){let prevented=false;d.listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);}
 if(close==='back')h.history.back();
 assert.equal(d.open,false);assert.equal(d.removed,true);assert.equal(h.document.activeElement,h.trigger);
 assert.equal(h.document.body.style.overflow,'auto');assert.equal(h.app.getViewer(),null);assert.equal(h.history.backs,1);
 assert.equal(h.revoked.length,0); // Shared cache remains reusable until bounded eviction/account change.
 h.app.clearPhotoCache();assert.deepEqual(h.revoked,['blob:private']);
});

test('full preview opens the exact optimized blob; a slow/failed download cannot reopen a closed viewer',async()=>{
 const h=setup(),file=new Blob(['processed'],{type:'image/jpeg'});h.app.state.draft.files=[file];
 await h.app.handleAction({dataset:{action:'view-draft-photo',id:'0'}});assert.equal(h.dialogs[0].img.src,h.created[0].url);
 h.app.closePhotoViewer();let resolve;h.api.imageUrl=()=>new Promise(r=>{resolve=r;});
 const pending=h.app.openPhotoViewer('private');h.app.closePhotoViewer();resolve('blob:slow');await pending;
 assert.equal(h.app.getViewer(),null);assert.equal(h.dialogs[1].img.src,undefined);
 h.api.imageUrl=async()=>{throw Error('storage denied');};await h.app.openPhotoViewer('denied');
 assert.equal(h.dialogs[2].status.textContent,'Photo unavailable.');assert.equal(h.dialogs[2].img.src,undefined);
});

test('private downloads coalesce, bounded cache evicts/revokes, and account changes reject old downloads',async()=>{
 const h=setup();let resolve,reads=0;h.api.imageUrl=()=>{reads++;return new Promise(r=>{resolve=r;});};
 const first=h.app.privatePhotoURL('private'),second=h.app.privatePhotoURL('private');assert.equal(reads,1);
 resolve('blob:private');assert.equal(await first,await second);
 h.api.imageUrl=async path=>`blob:${path}`;for(let i=0;i<35;i++)await h.app.privatePhotoURL(`photo-${i}`);
 assert.equal(h.app.state.cache.size,32);assert.ok(h.revoked.includes('blob:private'));
 h.api.imageUrl=()=>new Promise(r=>{resolve=r;});const stale=h.app.privatePhotoURL('old-account');
 h.app.setCurrentUser({id:'b'});resolve('blob:old-account');await assert.rejects(stale,/Photo unavailable/);
 assert.ok(h.revoked.includes('blob:old-account'));assert.equal(h.app.state.cache.size,0);
});

test('logout/page exit close viewer, stop camera and revoke draft/private URLs including late loads',async()=>{
 for(const exit of ['logout','pagehide']){
  const h=setup();h.app.state.draft.files=[new Blob()];const draft=h.app.draftPhotoURL(h.app.state.draft.files[0]);
  await h.app.openPhotoViewer('private');let stopped=false;h.app.state.cameraStream={getTracks:()=>[{stop(){stopped=true;}}]};
  let resolve;h.api.imageUrl=()=>new Promise(r=>{resolve=r;});const pending=h.app.privatePhotoURL('late');
  if(exit==='logout')h.app.setCurrentUser(null);else h.events.window.pagehide({persisted:false});
  resolve('blob:late');await assert.rejects(pending,/Photo unavailable/);
  assert.equal(h.app.getViewer(),null);assert.ok(h.revoked.includes(draft));assert.ok(h.revoked.includes('blob:private'));assert.ok(h.revoked.includes('blob:late'));assert.equal(stopped,true);
 }
});

for(const [width,height,size] of [[2000,1000,512],[120,80,80]])test(`avatar gallery ${width}×${height}: existing square crop, max 512, no upscale and one JPEG encode`,async()=>{
 const h=setup(),bitmap={width,height,closed:false,close(){this.closed=true;}};h.setBitmap(bitmap);
 await h.app.galleryAvatar(new Blob(['original EXIF/GPS'],{type:'image/png'}));
 const c=h.canvases[0];assert.deepEqual([c.width,c.height],[size,size]);assert.equal(c.mime,'image/jpeg');assert.equal(c.quality,.8);
 assert.equal(bitmap.closed,true);assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].type,'image/jpeg');
 assert.deepEqual(h.draws[0],[bitmap,(width-height)/2,0,height,height,0,0,size,size]);
 assert.equal(h.app.state.profile.avatar_path,'avatar:a/new.jpg');
});

test('avatar unsupported/invalid images fail clearly; decoding fallback revokes temporary URLs',async()=>{
 const h=setup();await assert.rejects(h.app.galleryAvatar(new Blob(['x'],{type:'text/plain'})),/Choose an image/);
 h.context.createImageBitmap=async()=>{throw Error('unsupported');};
 await assert.rejects(h.app.galleryAvatar(new Blob(['x'],{type:'image/heic'})),/Could not read this image/);
 h.context.createImageBitmap=undefined;h.context.Image=class {set src(value){this.url=value;this.width=80;this.height=120;this.onload();}};
 const img=await h.app.decodeAvatar(new Blob(['image']));assert.equal(img.width,80);assert.deepEqual(h.revoked,['blob:photo-0']);
});

test('bitmap decode returns the same oriented bitmap; closing remains the avatar caller responsibility',async()=>{
 const h=setup(),input=new Blob(['image']);let options;
 h.context.createImageBitmap=async(file,configuration)=>{assert.equal(file,input);options=configuration;return h.bitmap;};
 assert.equal(await h.app.decodeAvatar(input),h.bitmap);assert.equal(options.imageOrientation,'from-image');
 assert.equal(h.bitmap.closed,false);assert.equal(h.created.length,0);assert.equal(h.revoked.length,0);
});

test('bitmap rejection retains the existing supported-image error without retrying Image fallback',async()=>{
 const h=setup();h.context.createImageBitmap=async()=>{throw Error('decode denied');};
 h.context.Image=class {constructor(){assert.fail('Bitmap rejection must not introduce a fallback retry');}};
 await assert.rejects(h.app.decodeAvatar(new Blob()),{message:'Could not read this image. Please choose a supported image.'});
 assert.equal(h.created.length,0);assert.equal(h.revoked.length,0);
});

test('Image fallback revokes its URL on decode failure and a throwing src setter',async()=>{
 for(const failure of ['event','setter']){
  const h=setup();h.context.createImageBitmap=undefined;
  h.context.Image=class {set src(value){assert.equal(typeof this.onload,'function');assert.equal(typeof this.onerror,'function');if(failure==='setter')throw Error('src failed');this.onerror(Error('decode failed'));}};
  await assert.rejects(h.app.decodeAvatar(new Blob()),{message:'Could not read this image. Please choose a supported image.'});
  assert.deepEqual(h.revoked,['blob:photo-0']);assert.equal(h.created.length,1);
 }
});

test('canvas draw and encoder exceptions propagate unchanged without creating draft or upload state',async()=>{
 for(const stage of ['draw','encode']){
  const h=setup(),failure=Error('synthetic '+stage);
  if(stage==='draw')h.context.document.createElement=()=>({getContext:()=>({drawImage(){throw failure;}})});
  else h.setEncode(()=>{throw failure;});
  await assert.rejects(h.app.canvasBlob({},20,10),error=>error===failure);
  assert.equal(h.app.state.draft.files.length,0);assert.equal(h.uploads.length,0);
 }
});

test('Storage avatar upload stays JPEG/private and failed profile update removes only the new upload',async()=>{
 const failure={code:'23514',message:'Profile update failed'},uploads=[],removed=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'a'}}})},
  storage:{from(bucket){assert.equal(bucket,'avatars');return {upload:async(path,file,options)=>{uploads.push({path,file,options});return {};},list:async()=>({data:[]}),remove:async paths=>{removed.push(...paths);return {};}};}},
  from(table){assert.equal(table,'profiles');return {select(){return {eq:()=>({maybeSingle:async()=>({data:{avatar_path:null}})})};},update(){return {eq:async()=>({error:failure})};}};}};
 const blob=new Blob(['encoded'],{type:'image/jpeg'});await assert.rejects(createCloud(client).saveAvatar(blob),error=>error===failure);
 assert.equal(uploads[0].file,blob);assert.match(uploads[0].path,/^a\/[^/]+\.jpg$/);assert.deepEqual(uploads[0].options,{contentType:'image/jpeg',upsert:false});
 assert.deepEqual(removed,[uploads[0].path]);
});

test('post upload sends the exact optimized JPEG once with unchanged private paths and publishing order',async()=>{
 const calls=[],blob=new Blob(['optimized JPEG'],{type:'image/jpeg'});
 const client={auth:{getUser:async()=>({data:{user:{id:'a'}}})},
  from(table){return {insert:async value=>{calls.push({table,value});return {};}};},
  storage:{from(bucket){return {upload:async(path,file,options)=>{calls.push({bucket,path,file,options});return {};}};}},
  rpc:async(name,args)=>{calls.push({name,args});return {};}};
 const result=await createCloud(client).createPost('drank','Test',[blob]);
 assert.equal(calls[0].value.status,'draft');assert.equal(calls[2].bucket,'post-images');assert.equal(calls[2].file,blob);
 assert.match(calls[2].path,new RegExp(`^a/${result.id}/1-[^/]+\\.jpg$`));
 assert.deepEqual(calls[2].options,{contentType:'image/jpeg',upsert:false});
 assert.equal(calls[1].table,'post_photos');assert.equal(calls[1].value.path,calls[2].path);
 assert.deepEqual(calls[3],{name:'publish_post',args:{p_post_id:result.id}});
});

test('private image download uses the existing authenticated buckets and propagates authorization denial',async()=>{
 const calls=[],denied={message:'Access denied'};const cloud=createCloud({storage:{from(bucket){return {download:async path=>{calls.push({bucket,path});return {error:denied};}};}}});
 await assert.rejects(cloud.imageUrl('a/post/1.jpg'),error=>error===denied);
 await assert.rejects(cloud.imageUrl('avatar:a/1.jpg'),error=>error===denied);
 assert.deepEqual(calls,[{bucket:'post-images',path:'a/post/1.jpg'},{bucket:'avatars',path:'a/1.jpg'}]);
 const cloudSource=fs.readFileSync(new URL('../src/cloud.js',import.meta.url),'utf8');assert.doesNotMatch(cloudSource,/getPublicUrl|createSignedUrl/);
});
