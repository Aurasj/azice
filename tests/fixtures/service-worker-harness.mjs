// Actual worker source, simulated CacheStorage/network/lifecycle. This is NOT a
// browser service-worker/controller implementation or proof of device behavior.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {moduleOrigin,projectRoot,sourceFile,moduleGraph} from './public-modules.mjs';

export function shellNetwork(root=projectRoot){
  const resources=new Map();
  for(const name of ['index.html','app.js','cloud.js','demo.js','config.js','styles.css','manifest.webmanifest','push-sw.js','sw.js'])resources.set('/'+name,fs.readFileSync(path.join(root,name)));
  for(const [url,source] of moduleGraph(root))resources.set(new URL(url).pathname,Buffer.from(source));
  for(const name of fs.readdirSync(path.join(root,'assets')))if(name!=='logo.png')resources.set('/assets/'+name,fs.readFileSync(path.join(root,'assets',name)));
  return {resources,online:true,requests:[],async fetch(input){
    const url=new URL(input?.url||input,moduleOrigin);this.requests.push(url.href);
    if(url.origin!==moduleOrigin)throw Error('External network forbidden');
    if(!this.online)throw Error('Offline');
    const key=url.pathname==='/'?'/index.html':url.pathname,body=this.resources.get(key);
    const type=/\.m?js$/.test(key)?'text/javascript':key.endsWith('.html')?'text/html':key.endsWith('.css')?'text/css':key.endsWith('.svg')?'image/svg+xml':key.endsWith('.png')?'image/png':key.endsWith('.webmanifest')?'application/manifest+json':'text/plain';
    return new Response(body||'Missing',{status:body?200:404,headers:{'Content-Type':type}});
  }};
}
export function workerRuntime({network=shellNetwork(),stores=new Map(),source=fs.readFileSync(path.join(projectRoot,'sw.js'),'utf8')}={}){
  const events=new Map(),urlOf=input=>new URL(input?.url||input,moduleOrigin).href;
  const caches={async keys(){return [...stores.keys()];},async delete(key){return stores.delete(key);},async open(name){
    if(!stores.has(name))stores.set(name,new Map());const cache=stores.get(name);
    return {async addAll(urls){
      const fetched=await Promise.all(urls.map(async url=>{const response=await network.fetch(url);if(!response.ok)throw Error('Precache failed: '+url);return [urlOf(url),response];}));
      for(const [url,response] of fetched)cache.set(url,response.clone());
    },async put(request,response){cache.set(urlOf(request),response.clone());}};
  },async match(request){for(const cache of stores.values()){const response=cache.get(urlOf(request));if(response)return response.clone();}}};
  const self={location:{origin:moduleOrigin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener(type,callback){const list=events.get(type)||[];list.push(callback);events.set(type,list);}};
  const context=vm.createContext({self,caches,URL,Response,fetch:input=>network.fetch(input),console,
    importScripts(url){if(url!=='/push-sw.js')throw Error('Unexpected worker import');vm.runInContext(fs.readFileSync(sourceFile(projectRoot,moduleOrigin+url),'utf8'),context);}});
  vm.runInContext(source,context,{filename:'sw.js'});
  const inventory=[...vm.runInContext('ASSETS',context)],cacheName=vm.runInContext('CACHE',context);
  return {network,stores,inventory,cacheName,events,
    async lifecycle(type){const waits=[];for(const fn of events.get(type)||[])fn({waitUntil:p=>waits.push(p)});await Promise.all(waits);},
    async fetch(url){let response;for(const fn of events.get('fetch')||[])fn({request:new Request(new URL(url,moduleOrigin)),respondWith:p=>{if(response)throw Error('Duplicate fetch response');response=p;}});return response===undefined?undefined:await response;}
  };
}
