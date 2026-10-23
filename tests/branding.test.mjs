import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url));
const exports=[['pwa-192',192],['pwa-512',512],['maskable-512',512],['apple-touch-180',180],['favicon-16',16],['favicon-32',32]];
// Decode the checked-in 8-bit, non-interlaced RGB/RGBA PNGs without test dependencies.
function png(path){
 const file=read(path);assert.equal(file.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const width=file.readUInt32BE(16),height=file.readUInt32BE(20),type=file[25],channels=type===2?3:4;
 assert.equal(file[24],8);assert.ok([2,6].includes(type));assert.equal(file[28],0);
 const chunks=[];for(let offset=8;offset<file.length;){const n=file.readUInt32BE(offset),name=file.toString('ascii',offset+4,offset+8);if(name==='IDAT')chunks.push(file.subarray(offset+8,offset+8+n));offset+=12+n;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,data=Buffer.alloc(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){
  const i=y*stride+x,a=x>=channels?data[i-channels]:0,b=y?data[i-stride]:0,c=y&&x>=channels?data[i-stride-channels]:0;
  const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];data[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
 }}
 return {width,height,channels,data,pixel:(x,y)=>data.subarray((y*width+x)*channels,(y*width+x+1)*channels)};
}

test('six versioned platform icons are exact-size opaque RGB PNGs with dark square corners',()=>{
 for(const [name,size]of exports){const icon=png(`assets/azice-${name}-v2.png`);assert.equal(icon.width,size);assert.equal(icon.height,size);assert.equal(icon.channels,3);
  for(const [x,y]of [[0,0],[size-1,0],[0,size-1],[size-1,size-1]])assert.ok([...icon.pixel(x,y)].every(v=>v<90),name+' dark corner');
 }
});

test('master keeps the approved source illustration pixels while extending only the outer background',()=>{
 const source=png('assets/logo.png'),master=png('assets/azice-mascot-master-v2.png');assert.equal(master.width,600);assert.equal(master.height,600);assert.equal(master.channels,3);
 let protectedCount=0;const matte=[21,23,28];
 for(let y=0;y<600;y++)for(let x=0;x<600;x++)if(Math.hypot((x-300)/260,(y-295)/270)<=.96){
  protectedCount++;const original=source.pixel(x,y),actual=master.pixel(x,y),alpha=original[3]/255;
  for(let c=0;c<3;c++)assert.ok(Math.abs(actual[c]-(original[c]*alpha+matte[c]*(1-alpha)))<=1,'approved illustration pixel preserved');
 }
 assert.ok(protectedCount>200000);
});

test('maskable artwork fits the central 40%-radius safe circle with opaque padding',()=>{
 const icon=png('assets/azice-maskable-512-v2.png');let visible=0,maxRadius=0;
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){const [r,g]=icon.pixel(x,y);if(r>170&&g>120){visible++;maxRadius=Math.max(maxRadius,Math.hypot(x-255.5,y-255.5));}}
 assert.ok(visible>15000);assert.ok(maxRadius<512*.4);
 // The complete source ellipse protecting the mascot maps within 180px of center.
 assert.ok(270*400/600<512*.4);assert.deepEqual([...icon.pixel(0,0)],[21,23,28]);
});

test('manifest identity stays stable and platform metadata uses separate versioned icons',()=>{
 const manifest=JSON.parse(read('manifest.webmanifest')),html=read('index.html').toString();
 assert.deepEqual([manifest.id,manifest.start_url,manifest.scope,manifest.display],['/','/','/','standalone']);
 assert.equal(manifest.name,'AziCe? — Every day has a story');assert.equal(manifest.short_name,'AziCe?');
 assert.equal(manifest.theme_color,'#15171c');assert.equal(manifest.background_color,'#15171c');
 assert.deepEqual(manifest.icons.map(i=>[i.sizes,i.purpose]),[['192x192','any'],['512x512','any'],['512x512','maskable']]);
 for(const icon of manifest.icons){assert.equal(icon.type,'image/png');assert.ok(fs.existsSync(new URL('..'+icon.src,import.meta.url)));assert.match(icon.src,/-v2\.png$/);}
 for(const [rel,size,name]of [['icon',16,'favicon-16'],['icon',32,'favicon-32'],['apple-touch-icon',180,'apple-touch-180']])assert.match(html,new RegExp(`rel="${rel}"[^>]*sizes="${size}x${size}"[^>]*href="/assets/azice-${name}-v2.png"`));
 assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);assert.match(html,/viewport-fit=cover/);
});

test('versioned service-worker cache includes every icon and retains private-data and push boundaries',async()=>{
 const events={},added=[],deleted=[],imports=[];let claimed=false;
 const context=vm.createContext({URL,Promise,importScripts:path=>imports.push(path),self:{location:{origin:'https://azice.test'},addEventListener:(name,fn)=>{events[name]=fn;},skipWaiting:()=>Promise.resolve(),clients:{claim:async()=>{claimed=true;}}},caches:{open:async()=>({addAll:async paths=>added.push(...paths)}),keys:async()=>['azice-shell-v1','azice-shell-v2-mascot'],delete:async key=>deleted.push(key)}});
 vm.runInContext(read('sw.js').toString(),context);
 let work;events.install({waitUntil:p=>{work=p;}});await work;
 for(const [name]of exports)assert.ok(added.includes(`/assets/azice-${name}-v2.png`));
 for(const path of added)assert.ok(fs.existsSync(new URL('..'+(path==='/'?'/index.html':path),import.meta.url)),path);
 assert.ok(!added.some(path=>/logo\.png|master|private|post-images/.test(path)));
 events.activate({waitUntil:p=>{work=p;}});await work;assert.deepEqual(deleted,['azice-shell-v1']);assert.equal(claimed,true);assert.deepEqual(imports,['/push-sw.js']);
 let intercepted=false;events.fetch({request:{url:'https://azice.test/storage/v1/private-photo',method:'GET'},respondWith(){intercepted=true;}});assert.equal(intercepted,false);
 assert.match(read('push-sw.js').toString(),/icon:'\/assets\/azice-pwa-192-v2\.png'/);
});
