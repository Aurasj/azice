import http from 'node:http';
import fs from 'node:fs';
// Optional browser fixture: synthetic images only, no config, Supabase or service worker.
// Four image shapes intentionally exercise rendering; camera capture still caps posts at three.
const source=fs.readFileSync(new URL('../../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\(async\(\)=>\{\s*state.view='loading';render\(\);await boot\(\);\s*\}\)\(\);\s*$/,'').replace(/^if\('serviceWorker'.*$/gm,'');
const fixture=`
api={mode:'demo',getUser:async()=>({id:'test'}),friendData:async()=>({friends:[],incoming:[],outgoing:[]}),imageUrl:async path=>path};
setCurrentUser({id:'test'});state.profile={id:'test',display_name:'Test User',username:'test'};state.friendsLoaded=true;
const sizes=[[1200,1600],[1600,900],[900,900],[1600,100]],photos=[];
for(let i=0;i<sizes.length;i++){
 const [w,h]=sizes[i],c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
 ctx.fillStyle=['#b35228','#246a69','#694a85','#465684'][i];ctx.fillRect(0,0,w,h);ctx.strokeStyle='#f2a65a';ctx.lineWidth=20;ctx.strokeRect(10,10,w-20,h-20);
 ctx.fillStyle='#fff';ctx.font='40px sans-serif';ctx.fillText(w+' × '+h,30,70);
 const blob=await canvasBlob(c,w,h);photos.push({path:URL.createObjectURL(blob),blob});
}
state.feed=[{id:'fixture',author_id:'test',kind:'drank',reason:'Photo browser verification',published_at:new Date().toISOString(),post_photos:photos,comments:[],reactions:[]}];
const fixtureView=new URLSearchParams(location.search).get('view');state.view=['preview','capture'].includes(fixtureView)?'new':'feed';
if(state.view==='new')state.draft={kind:'drank',reason:'Photo browser verification',step:fixtureView==='capture'?1:3,files:photos.slice(0,3).map(p=>p.blob)};
render();
// Exercise the real canvas encoder and an actual JPEG carrying EXIF GPS metadata.
const results=[];
for(const [w,h] of [[3024,4032],[4032,3024],[2048,2048],[8000,100],[240,320]]){
 const input=document.createElement('canvas');input.width=w;input.height=h;
 const blob=await canvasBlob(input,w,h),bitmap=await createImageBitmap(blob);
 results.push({source:[w,h],output:[bitmap.width,bitmap.height],mime:blob.type});bitmap.close();
}
const input=new Uint8Array(await photos[0].blob.arrayBuffer());
const tiff=new Uint8Array(80),data=new DataView(tiff.buffer);
tiff.set([73,73,42,0,8,0,0,0]);data.setUint16(8,1,true);data.setUint16(10,0x8825,true);data.setUint16(12,4,true);data.setUint32(14,1,true);data.setUint32(18,26,true);
data.setUint16(26,2,true);data.setUint16(28,1,true);data.setUint16(30,2,true);data.setUint32(32,2,true);tiff[36]=78;
data.setUint16(40,2,true);data.setUint16(42,5,true);data.setUint32(44,3,true);data.setUint32(48,56,true);
for(let i=0;i<3;i++){data.setUint32(56+i*8,[44,25,0][i],true);data.setUint32(60+i*8,1,true);}
const payload=new Uint8Array(6+tiff.length);payload.set([69,120,105,102,0,0]);payload.set(tiff,6);
const app1=new Uint8Array(payload.length+4);app1.set([255,225,(payload.length+2)>>8,(payload.length+2)&255]);app1.set(payload,4);
const metadataSource=new Blob([input.slice(0,2),app1,input.slice(2)],{type:'image/jpeg'}),url=URL.createObjectURL(metadataSource),image=new Image();
image.src=url;await image.decode();const stripped=await canvasBlob(image,image.naturalWidth,image.naturalHeight);URL.revokeObjectURL(url);
const encoded=new Uint8Array(await stripped.arrayBuffer());const hasExif=bytes=>bytes.some((v,i)=>v===69&&bytes[i+1]===120&&bytes[i+2]===105&&bytes[i+3]===102);
const report=document.createElement('pre');report.id='browser-results';report.style='margin:20px 20px 130px;white-space:pre-wrap;font-size:12px';
report.textContent=JSON.stringify({results,metadata:{inputEXIFGPS:hasExif(new Uint8Array(await metadataSource.arrayBuffer())),outputEXIF:hasExif(encoded),jpeg:encoded[0]===255&&encoded[1]===216}},null,2);document.body.append(report);
`;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AziCe? isolated photo check</title><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div><div id="toast" hidden></div><script type="module">${source}\n${fixture}</script></body></html>`;
http.createServer((req,res)=>{if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(new URL('../../styles.css',import.meta.url)));}else if(req.url.startsWith('/?')||req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else{res.statusCode=404;res.end();}}).listen(5197,'127.0.0.1',()=>console.log('Isolated photo check: http://localhost:5197'));
