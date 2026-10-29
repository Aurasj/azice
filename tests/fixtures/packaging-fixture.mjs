import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {moduleGraph,projectRoot} from './public-modules.mjs';

export const syntheticConfig={supabaseUrl:'https://synthetic.supabase.co',supabasePublishableKey:'sb_publishable_synthetic_test',pushPublicKey:''};
export function packagingFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azice-module-package-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const files=new Set(['index.html','styles.css','app.js','cloud.js','demo.js','config.js','manifest.webmanifest','sw.js','push-sw.js','server.mjs','scripts/build.mjs','scripts/config.mjs','package.json']);
  for(const id of moduleGraph().keys())files.add(new URL(id).pathname.slice(1));
  for(const file of files){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(projectRoot,file),path.join(root,file));}
  fs.cpSync(path.join(projectRoot,'assets'),path.join(root,'assets'),{recursive:true,filter:file=>path.basename(file)!=='logo.png'});
  fs.writeFileSync(path.join(root,'config.production.json'),JSON.stringify(syntheticConfig));return root;
}
export function buildFixture(root,production){
  const result=spawnSync(process.execPath,['scripts/build.mjs',...(production?['--production']:[])],{cwd:root,encoding:'utf8',timeout:10000,
    env:{...process.env,NETLIFY:'',CONTEXT:'',PULL_REQUEST:'',NETLIFY_PREVIEW_SERVER:''}});
  if(result.status!==0)throw Error(result.stderr||'Fixture build failed');return path.join(root,'dist');
}
export async function serveActualDevServer(root){
  const reserve=net.createServer();await new Promise((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',resolve);});
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let closed=false;const closing=new Promise(resolve=>child.once('close',()=>{closed=true;resolve();}));
  const close=async()=>{if(!closed)child.kill();await closing;};
  try{await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Fixture dev server did not start')),5000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Fixture dev server exited: '+code));});
    child.stdout.on('data',data=>{if(String(data).includes('running at')){clearTimeout(timer);resolve();}});
  });}catch(error){await close();throw error;}
  return {origin:'http://127.0.0.1:'+port,close};
}
