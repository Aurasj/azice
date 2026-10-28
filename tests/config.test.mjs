import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DEMO_CONFIG,validateConfig,configScript,buildConfig,contributorConfig} from '../scripts/config.mjs';

const publicConfig={supabaseUrl:'https://synthetic.supabase.co',supabasePublishableKey:'sb_publishable_synthetic_key',pushPublicKey:''};
const jwt=payload=>Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic_signature';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'azice-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'config.production.json'),JSON.stringify(publicConfig));return root;}

test('source configuration and example are demo-only; default build ignores inherited backend credentials',t=>{
 const root=fixture(t),context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../config.js',import.meta.url),'utf8'),context);
 assert.ok(Object.keys(context.window.AZICE_CONFIG).length===3&&Object.values(context.window.AZICE_CONFIG).every(v=>v===''),'Source must be demo-only; values omitted.');
 const example=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
 assert.ok(Object.keys(example).length===3&&Object.values(example).every(v=>v===''),'Example must be demo-only; values omitted.');
 const env={SUPABASE_URL:publicConfig.supabaseUrl,SUPABASE_SERVICE_ROLE_KEY:'synthetic-private',CONTEXT:'production'};
 assert.deepEqual(buildConfig(root,{env}).config,DEMO_CONFIG);
 fs.writeFileSync(path.join(root,'config.local.json'),JSON.stringify(publicConfig));
 assert.deepEqual(buildConfig(root,{env:{}}).config,DEMO_CONFIG);
});

test('production build and Netlify production preserve public values without changing source files',t=>{
 const root=fixture(t),before=fs.readFileSync(path.join(root,'config.production.json'),'utf8');
 for(const options of [{mode:'production',env:{}},{env:{NETLIFY:'true',CONTEXT:'production',PULL_REQUEST:'false'}}]){
  const result=buildConfig(root,options);assert.equal(result.mode,'production');assert.deepEqual(result.config,publicConfig);
  const context={window:{}};vm.runInNewContext(configScript(result.config),context);assert.deepEqual(JSON.parse(JSON.stringify(context.window.AZICE_CONFIG)),publicConfig);
 }
 assert.equal(fs.readFileSync(path.join(root,'config.production.json'),'utf8'),before);
});

test('previews, branches and preview servers remain demo even if local overrides exist',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'config.local.json'),'invalid JSON');
 for(const CONTEXT of ['deploy-preview','branch-deploy','dev','preview-server']){
  assert.deepEqual(buildConfig(root,{env:{NETLIFY:'true',CONTEXT}}).config,DEMO_CONFIG);
  assert.throws(()=>buildConfig(root,{mode:'production',env:{NETLIFY:'true',CONTEXT}}),/must use demo/);
 }
 for(const flag of [{PULL_REQUEST:'true'},{NETLIFY_PREVIEW_SERVER:'true'}])assert.deepEqual(buildConfig(root,{env:{NETLIFY:'true',CONTEXT:'production',...flag}}).config,DEMO_CONFIG);
 assert.throws(()=>buildConfig(root,{env:{NETLIFY:'true'}}),/context is missing/);
});

test('local server configuration is opt-in, validated and cannot reuse the production project',t=>{
 const root=fixture(t);assert.deepEqual(contributorConfig(root),DEMO_CONFIG);
 fs.writeFileSync(path.join(root,'config.local.json'),JSON.stringify(publicConfig));assert.throws(()=>contributorConfig(root),/not production/);
 const local={...publicConfig,supabaseUrl:'http://127.0.0.1:54321'};fs.writeFileSync(path.join(root,'config.local.json'),JSON.stringify(local));assert.deepEqual(contributorConfig(root),local);
 assert.deepEqual(buildConfig(root,{mode:'local',env:{}}).config,local);
 fs.writeFileSync(path.join(root,'config.local.json'),'bad');assert.throws(()=>contributorConfig(root),/valid JSON/);
});

test('legacy anon JWT is accepted; service_role, other privileged, missing and malformed roles are rejected without echoing keys',()=>{
 assert.deepEqual(validateConfig({...publicConfig,supabasePublishableKey:jwt({role:'anon'})}),{...publicConfig,supabasePublishableKey:jwt({role:'anon'})});
 for(const role of ['service_role','authenticated','supabase_admin','postgres',null,{},['anon']]){
  const key=jwt({role});assert.throws(()=>validateConfig({...publicConfig,supabasePublishableKey:key}),error=>error.message.includes('Invalid public')&&!error.message.includes(key));
 }
 for(const key of ['eyJmalformed','eyJ.e30.signature','sb_secret_synthetic_private_key','sbp_synthetic_token','Bearer synthetic',''])assert.throws(()=>validateConfig({...publicConfig,supabasePublishableKey:key}));
});

test('URLs, unexpected secret properties, private VAPID shapes and incomplete production config fail closed',()=>{
 for(const url of ['https://synthetic.supabase.co@evil.test','https://user:password@synthetic.supabase.co','https://synthetic.supabase.co/path','https://synthetic.supabase.co?token=x','http://synthetic.supabase.co','https://evil.test','http://localhost.evil.test'])assert.throws(()=>validateConfig({...publicConfig,supabaseUrl:url}));
 assert.throws(()=>validateConfig({...publicConfig,VAPID_PRIVATE_KEY:'synthetic'}));
 assert.throws(()=>validateConfig({...publicConfig,pushPublicKey:'x'.repeat(43)}));
 assert.throws(()=>validateConfig(DEMO_CONFIG,{requireCloud:true}));
 assert.throws(()=>validateConfig({...publicConfig,supabasePublishableKey:123}));
});

test('missing or invalid production profile throws before replacing an existing build',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'config.production.json'),JSON.stringify({...publicConfig,supabasePublishableKey:jwt({role:'service_role'})}));
 assert.throws(()=>buildConfig(root,{mode:'production',env:{}}),/Invalid public configuration/);
 fs.unlinkSync(path.join(root,'config.production.json'));assert.throws(()=>buildConfig(root,{mode:'production',env:{}}),/Cannot read/);
 assert.throws(()=>buildConfig(root,{mode:'unknown',env:{}}),/Unknown build/);
});
