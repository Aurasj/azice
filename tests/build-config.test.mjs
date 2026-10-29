import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {DEMO_CONFIG} from '../scripts/config.mjs';

const config={supabaseUrl:'https://synthetic.supabase.co',supabasePublishableKey:'sb_publishable_synthetic_key',pushPublicKey:''};
const files=['index.html','app.js','cloud.js','demo.js','config.js','styles.css','sw.js','push-sw.js','manifest.webmanifest'];
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azice-build-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'src'));for(const file of ['presentation.js','auth-helpers.js','image-processing.js','demo.js','cloud.js'])fs.copyFileSync(new URL('../src/'+file,import.meta.url),path.join(root,'src',file));
 fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'assets'));
 for(const file of [...files,'scripts/build.mjs','scripts/config.mjs'])fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(root,file));
 fs.writeFileSync(path.join(root,'config.production.json'),JSON.stringify(config));
 fs.writeFileSync(path.join(root,'config.local.json'),'invalid local override');
 fs.writeFileSync(path.join(root,'assets/logo.png'),'untracked authoring fixture');
 fs.writeFileSync(path.join(root,'assets/azice-mascot-master-v2.png'),'authoring master fixture');
 fs.writeFileSync(path.join(root,'assets/runtime.svg'),'<svg/>');return root;
}
const run=(root,args=[],env={})=>spawnSync(process.execPath,['scripts/build.mjs',...args],{cwd:root,env:{...process.env,NETLIFY:'',CONTEXT:'',PULL_REQUEST:'',NETLIFY_PREVIEW_SERVER:'',...env},encoding:'utf8'});
function generated(root){const c={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/config.js'),'utf8'),c);return JSON.parse(JSON.stringify(c.window.AZICE_CONFIG));}

test('real CLI demo and production builds retain allowlist, generate only dist/config.js and exclude authoring/config files',t=>{
 const root=fixture(t),source=fs.readFileSync(path.join(root,'config.js'),'utf8');
 for(const [args,env,expected]of [[[],{},DEMO_CONFIG],[['--production'],{},config],[[],{NETLIFY:'true',CONTEXT:'production'},config],[[],{NETLIFY:'true',CONTEXT:'deploy-preview'},DEMO_CONFIG],[[],{NETLIFY:'true',CONTEXT:'branch-deploy'},DEMO_CONFIG]]){
  const result=run(root,args,env);assert.equal(result.status,0,result.stderr);assert.deepEqual(generated(root),expected);
  assert.deepEqual(fs.readdirSync(path.join(root,'dist')).sort(),[...files,'assets','src'].sort());
  assert.deepEqual(fs.readdirSync(path.join(root,'dist/src')).sort(),['auth-helpers.js','cloud.js','demo.js','image-processing.js','presentation.js']);
  assert.deepEqual(fs.readdirSync(path.join(root,'dist/assets')),['runtime.svg']);
  assert.equal(fs.readFileSync(path.join(root,'config.js'),'utf8'),source);
 }
});

test('invalid production credentials or CLI options stop before erasing a previous output and never print key values',t=>{
 const root=fixture(t);assert.equal(run(root).status,0);fs.writeFileSync(path.join(root,'dist/retained.txt'),'previous build');
 const privateKey='sb_secret_synthetic_do_not_echo';fs.writeFileSync(path.join(root,'config.production.json'),JSON.stringify({...config,supabasePublishableKey:privateKey}));
 for(const args of [['--production'],['--unknown'],['--production','--local']]){
  const result=run(root,args);assert.notEqual(result.status,0);assert.ok(!result.stderr.includes(privateKey));assert.equal(fs.readFileSync(path.join(root,'dist/retained.txt'),'utf8'),'previous build');
 }
});

test('contributor CI has pinned actions, read-only permissions and no production build or privileged PR execution',()=>{
 const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(ci,/pull_request:/);assert.doesNotMatch(ci,/^\s*pull_request_target:/m);assert.match(ci,/contents: read/);assert.match(ci,/persist-credentials: false/);
 assert.doesNotMatch(ci,/\$\{\{\s*secrets\.|run:.*(?:--production|build:production)|runs-on:.*self-hosted/);
 for(const line of ci.split('\n').filter(l=>l.includes('uses:')))assert.match(line,/@[a-f0-9]{40}\b/);
 assert.match(ci,/npm ci --ignore-scripts/);assert.match(ci,/unshare --net/);assert.match(ci,/ip link set lo up/);assert.match(ci,/exec setpriv --reuid=/);assert.match(ci,/npm run ci:offline/);
 const scripts=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const command of ['npm test','npm run check','npm run test:sql','npm run build','check-demo-build.mjs'])assert.ok(scripts['ci:offline'].includes(command));
});

test('offline source-config validation redacts accidentally pasted private values',t=>{
 const root=fixture(t);fs.copyFileSync(new URL('../scripts/check-config.mjs',import.meta.url),path.join(root,'scripts/check-config.mjs'));
 const privateValue='sb_secret_synthetic_value_must_not_be_logged';
 fs.writeFileSync(path.join(root,'config.js'),"window.AZICE_CONFIG="+JSON.stringify({...config,supabasePublishableKey:privateValue})+';');
 const result=spawnSync(process.execPath,['scripts/check-config.mjs'],{cwd:root,encoding:'utf8'});
 assert.notEqual(result.status,0);assert.ok(!result.stderr.includes(privateValue));assert.match(result.stderr,/Values are not logged/);
});
