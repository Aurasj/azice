import assert from 'node:assert/strict';
import vm from 'node:vm';
import {moduleRuntime} from './module-harness.mjs';

async function realm(tag){
 const context=vm.createContext({tag});
 // Stubs are themselves created inside the realm: no host browser globals or
 // host-imported processing functions are injected into the native module.
 vm.runInContext(`
  globalThis.created=[];globalThis.draws=[];globalThis.urls=[];globalThis.revoked=[];
  globalThis.noContext=false;globalThis.encoded={type:'image/jpeg',realm:tag};
  globalThis.document={createElement(kind){
   if(kind!=='canvas')throw Error('Unexpected element');
   const canvas={getContext(kind){
    if(kind!=='2d')throw Error('Unexpected context');
    return noContext?null:{drawImage(...args){draws.push(args);}};
   },toBlob(callback,mime,quality){this.mime=mime;this.quality=quality;callback(encoded);}};
   created.push(canvas);return canvas;
  }};
  globalThis.bitmap={width:1600,height:1200,closed:false,realm:tag,close(){this.closed=true;}};
  globalThis.createImageBitmap=async(file,options)=>{
   globalThis.bitmapCall={file,options,realm:tag};return bitmap;
  };
  globalThis.URL={createObjectURL(file){const url='blob:'+tag+'/'+urls.length;urls.push({file,url});return url;},revokeObjectURL(url){revoked.push(url);}};
  globalThis.Image=class {set src(value){this.url=value;this.width=1200;this.height=1600;this.onload();}};
 `,context);
 const runtime=moduleRuntime({context}),helpers=await runtime.load('/src/image-processing.js');
 assert.equal(context.created.length,0);assert.equal(context.urls.length,0,'Import has no eager browser API effects');
 assert.deepEqual(Object.keys(helpers).sort(),['canvasBlob','decodeAvatar']);
 assert.ok(helpers.canvasBlob instanceof vm.runInContext('Function',context));
 assert.ok(helpers.decodeAvatar instanceof vm.runInContext('Function',context));
 return {context,runtime,helpers};
}

const scenario=process.argv[2],a=await realm('A'),{context:c,helpers:p}=a;
if(scenario==='realm'){
 const b=await realm('B');
 assert.notEqual(p.canvasBlob,b.helpers.canvasBlob);
 assert.equal(await a.runtime.load('/src/image-processing.js'),p);
 assert.equal(await p.canvasBlob.call(b.context,{},20,10),c.encoded);
 assert.equal(await b.helpers.canvasBlob({},20,10),b.context.encoded);
 assert.equal(await p.decodeAvatar.call(b.context,{}),c.bitmap);
 assert.equal(c.created.length,1);assert.equal(b.context.created.length,1);
 assert.equal(c.bitmapCall.realm,'A');assert.equal(b.context.bitmapCall,undefined);
}else if(scenario==='canvas'){
 const source={metadata:'synthetic EXIF/GPS'};
 for(const [w,h,expected] of [[3024,4032,[1200,1600]],[4032,3024,[1600,1200]],[2048,2048,[1600,1600]],[8000,100,[1600,20]],[1,12000,[1,1600]],[240,320,[240,320]]]){
  const result=await p.canvasBlob(source,w,h),canvas=c.created.at(-1),draw=Array.from(c.draws.at(-1));
  assert.equal(result,c.encoded);assert.deepEqual([canvas.width,canvas.height],expected);
  assert.equal(draw[0],source);assert.deepEqual(draw.slice(1),[0,0,...expected]);
  assert.equal(canvas.mime,'image/jpeg');assert.equal(canvas.quality,.8);
  assert.equal(result.metadata,undefined,'Fresh canvas output, not the original');
 }
 const n=c.created.length;
 for(const dims of [[0,10],[10,-1],[NaN,10],[Infinity,1]])await assert.rejects(p.canvasBlob({},...dims),/Photo dimensions are invalid/);
 assert.equal(c.created.length,n);c.noContext=true;await assert.rejects(p.canvasBlob({},10,10),/Photo processing is unavailable/);
 c.noContext=false;
 for(const encoded of [null,{type:'image/png'}]){c.encoded=encoded;await assert.rejects(p.canvasBlob({},10,10),/Could not process photo/);}
}else if(scenario==='bitmap'){
 const input={};assert.equal(await p.decodeAvatar(input),c.bitmap);
 assert.equal(c.bitmapCall.file,input);assert.equal(c.bitmapCall.options.imageOrientation,'from-image');
 assert.equal(c.bitmap.closed,false,'Caller owns decoded bitmap disposal');assert.equal(c.urls.length,0);
 vm.runInContext('createImageBitmap=async()=>{throw Error("unsupported");}',c);
 await assert.rejects(p.decodeAvatar(input),/Could not read this image\. Please choose a supported image\./);
 assert.equal(c.urls.length,0,'Existing bitmap rejection does not introduce fallback retries');
}else if(scenario==='fallback'){
 c.createImageBitmap=undefined;
 const input={},image=await p.decodeAvatar(input);
 assert.ok(image instanceof c.Image);assert.deepEqual([image.width,image.height],[1200,1600]);
 assert.equal(c.urls[0].file,input);assert.deepEqual(Array.from(c.revoked),['blob:A/0']);
 vm.runInContext('Image=class {set src(value){this.onerror(Error("bad image"));}};',c);
 await assert.rejects(p.decodeAvatar(input),/Could not read this image/);
 vm.runInContext('Image=class {set src(value){throw Error("src failed");}};',c);
 await assert.rejects(p.decodeAvatar(input),/Could not read this image/);
 assert.deepEqual(Array.from(c.revoked),['blob:A/0','blob:A/1','blob:A/2']);
}else throw Error('Unknown image scenario');
console.log(JSON.stringify({scenario,passed:true}));
