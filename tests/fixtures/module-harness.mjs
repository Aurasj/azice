import fs from 'node:fs/promises';
import vm from 'node:vm';
import {moduleOrigin,projectRoot,publicPath,sourceFile} from './public-modules.mjs';

// Requires node --experimental-vm-modules. Each browser context gets one real
// ESM module map. No import/export stripping, appended exports or auto-boot removal.
export function moduleRuntime({context=vm.createContext({}),root=projectRoot,readSource}={}){
  if(typeof vm.SourceTextModule!=='function')throw Error('Run this fixture with --experimental-vm-modules');
  const modules=new Map(),loads=new Map();
  async function get(identifier,parent=moduleOrigin+'/index.html'){
    const id=publicPath(identifier,parent).href;
    if(!modules.has(id))modules.set(id,(async()=>{
      const source=await (readSource?readSource(id):fs.readFile(sourceFile(root,id),'utf8'));
      return new vm.SourceTextModule(source,{context,identifier:id,
        initializeImportMeta(meta){meta.url=id;},
        importModuleDynamically:async(specifier,referrer)=>{
          const imported=await get(specifier,referrer.identifier);await evaluate(imported);return imported;
        }});
    })());
    return modules.get(id);
  }
  async function evaluate(module){
    if(module.status==='unlinked')await module.link((specifier,referrer)=>get(specifier,referrer.identifier));
    if(module.status==='linked')await module.evaluate({timeout:3000});
    if(module.status==='errored')throw module.error;
  }
  return {context,modules,load(identifier){
    const id=publicPath(identifier).href;
    if(!loads.has(id))loads.set(id,(async()=>{const module=await get(id);await evaluate(module);return module.namespace;})());
    return loads.get(id);
  }};
}

export function browserContext({cloud=false}={}){
  const events={document:new Map(),window:new Map()},registrations=[],clients=[],errors=[],timers=new Map(),reads=new Map();let timerId=0;
  const storage=()=>{const map=new Map();return {getItem(key){reads.set(key,(reads.get(key)||0)+1);return map.get(key)||null;},setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};
  const listen=owner=>(type,callback)=>{const list=events[owner].get(type)||[];list.push(callback);events[owner].set(type,list);};
  const root={innerHTML:''},toast={hidden:true},session=storage(),local=storage();let subscriptions=0;
  const client={auth:{getUser:async()=>({data:{user:null},error:null}),onAuthStateChange(){subscriptions++;return {data:{subscription:{unsubscribe(){}}}};}}};
  const document={visibilityState:'visible',body:{style:{overflow:''}},querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,querySelectorAll:()=>[],addEventListener:listen('document')};
  const window={AZICE_CONFIG:cloud?{supabaseUrl:'https://synthetic.supabase.co',supabasePublishableKey:'sb_publishable_synthetic_test'}:{},addEventListener:listen('window'),scrollTo(){},
    ...(cloud?{supabase:{createClient(...args){clients.push(args);return {auth:{...client.auth}};}}}:{})};
  const context=vm.createContext({document,window,navigator:{userAgent:'Module test desktop',serviceWorker:{register(url){registrations.push(url);return Promise.resolve({});}}},
    location:{origin:moduleOrigin,pathname:'/',search:'',hash:'',protocol:'https:'},history:{state:null},localStorage:local,sessionStorage:session,
    URL,URLSearchParams,Intl,Date,Map,Set,Promise,Blob,File,FormData,Uint8Array,crypto,
    console:{warn:(...args)=>errors.push(args),error:(...args)=>errors.push(args),log(){}},
    fetch(){throw Error('Network forbidden in module fixture');},
    setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);}});
  return {context,root,events,registrations,clients,errors,reads,get subscriptions(){return subscriptions;},async settled(){
    for(let i=0;i<40;i++){await new Promise(resolve=>setImmediate(resolve));if(root.innerHTML.includes('What\'s happening?')||root.innerHTML.includes('Welcome back'))return;}
    throw Error('Actual application boot did not settle');
  }};
}
