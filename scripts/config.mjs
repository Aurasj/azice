import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

export const DEMO_CONFIG=Object.freeze({supabaseUrl:'',supabasePublishableKey:'',pushPublicKey:''});
const fields=Object.keys(DEMO_CONFIG);
const invalid=()=>{throw Error('Invalid public configuration. Use only the documented URL, publishable/anon key and public VAPID key.');};

// This validates configuration type, not JWT authenticity or backend permissions.
export function validateConfig(value,{requireCloud=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))invalid();
 const config=Object.fromEntries(fields.map(key=>[key,value[key]??'']));
 if(Object.values(config).some(v=>typeof v!=='string'||/\s/.test(v)))invalid();
 const {supabaseUrl:url,supabasePublishableKey:key,pushPublicKey:vapid}=config;
 if(!url&&!key&&!vapid&&!requireCloud)return config;
 if(!url||!key)invalid();
 let parsed;try{parsed=new URL(url);}catch{invalid();}
 if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')invalid();
 const loopback=['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
 if(!(parsed.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)&&!parsed.port)&&!(parsed.protocol==='http:'&&loopback))invalid();
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)){
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))invalid();
  let payload;try{payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{invalid();}
  if(payload?.role!=='anon')invalid();
 }
 if(vapid){const bytes=Buffer.from(vapid,'base64url');if(!/^[A-Za-z0-9_-]{87}$/.test(vapid)||bytes.length!==65||bytes[0]!==4)invalid();}
 return config;
}

const readConfig=(root,name)=>{
 try{return JSON.parse(readFileSync(join(root,name),'utf8'));}catch{throw Error('Cannot read '+name+'. Provide valid JSON; configuration values are never logged.');}
};
export const configScript=config=>'// Generated public configuration; no privileged credentials.\nwindow.AZICE_CONFIG = '+JSON.stringify(validateConfig(config),null,2)+';\n';

export function contributorConfig(root){
 if(!existsSync(join(root,'config.local.json')))return {...DEMO_CONFIG};
 const config=validateConfig(readConfig(root,'config.local.json'));
 // A local override must not accidentally reuse the production project.
 const production=readConfig(root,'config.production.json');
 if(config.supabaseUrl&&new URL(config.supabaseUrl).origin===new URL(production.supabaseUrl).origin)throw Error('Local contributor configuration must use a disposable project, not production.');
 return config;
}

export function buildConfig(root,{mode='demo',env=process.env}={}){
 if(!['demo','local','production'].includes(mode))throw Error('Unknown build mode.');
 if(env.NETLIFY==='true'){
  if(!env.CONTEXT)throw Error('Netlify context is missing; refusing an ambiguous build.');
  if(env.CONTEXT==='production'&&env.PULL_REQUEST!=='true'&&env.NETLIFY_PREVIEW_SERVER!=='true')return {mode:'production',config:validateConfig(readConfig(root,'config.production.json'),{requireCloud:true})};
  if(mode!=='demo')throw Error('Netlify previews and branch builds must use demo configuration.');
  return {mode:'demo',config:{...DEMO_CONFIG}};
 }
 if(mode==='production')return {mode,config:validateConfig(readConfig(root,'config.production.json'),{requireCloud:true})};
 if(mode==='local')return {mode,config:contributorConfig(root)};
 // Do not consume local files, production profiles or inherited Supabase secrets.
 return {mode:'demo',config:{...DEMO_CONFIG}};
}
