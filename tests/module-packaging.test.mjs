import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {moduleGraph,javascriptType} from './fixtures/public-modules.mjs';
import {packagingFixture,buildFixture,serveActualDevServer,syntheticConfig} from './fixtures/packaging-fixture.mjs';
import {workerRuntime,shellNetwork} from './fixtures/service-worker-harness.mjs';

for(const production of [false,true])test((production?'production':'demo')+' packages every reachable ESM byte and serves modules through the actual dev server with JavaScript MIME',async t=>{
  const root=packagingFixture(t),input=moduleGraph(root),dist=buildFixture(root,production),output=moduleGraph(dist);
  assert.deepEqual([...output.keys()].sort(),[...input.keys()].sort());
  for(const [id,text] of input)assert.equal(output.get(id),text,'Module bytes changed: '+id);
  const config={window:{}};vm.runInNewContext(fs.readFileSync(path.join(dist,'config.js'),'utf8'),config);
  assert.equal(JSON.stringify(config.window.AZICE_CONFIG),JSON.stringify(production?syntheticConfig:{supabaseUrl:'',supabasePublishableKey:'',pushPublicKey:''}));
  const worker=workerRuntime({network:shellNetwork(dist),source:fs.readFileSync(path.join(dist,'sw.js'),'utf8')});
  for(const id of output.keys())assert.ok(worker.inventory.includes(new URL(id).pathname),'Reachable module must be precached: '+id);
  const served=path.join(root,'served');fs.cpSync(dist,served,{recursive:true});
  // Test-only server/controller files are outside the build output and never packaged.
  fs.copyFileSync(path.join(root,'server.mjs'),path.join(served,'server.mjs'));fs.mkdirSync(path.join(served,'scripts'));
  fs.copyFileSync(path.join(root,'scripts/config.mjs'),path.join(served,'scripts/config.mjs'));
  const server=await serveActualDevServer(served);
  try{for(const [id,text] of output){const response=await fetch(server.origin+new URL(id).pathname);assert.equal(response.status,200);assert.ok(javascriptType(response.headers.get('content-type')));assert.equal(await response.text(),text);}}
  finally{await server.close();}
  for(const file of ['config.production.json','.env','supabase/schema.sql'])assert.equal(fs.existsSync(path.join(dist,file)),false);
});
test('a future nested module omitted by packaging or precaching is detected rather than silently skipped',async t=>{
  const root=packagingFixture(t);fs.mkdirSync(path.join(root,'src'),{recursive:true});
  fs.writeFileSync(path.join(root,'src/future.mjs'),'export const future=true;');
  fs.appendFileSync(path.join(root,'app.js'),"\nimport './src/future.mjs';\n");
  assert.ok([...moduleGraph(root).keys()].some(id=>id.endsWith('/src/future.mjs')));
  const dist=buildFixture(root,false);assert.throws(()=>moduleGraph(dist),/ENOENT/);
  fs.mkdirSync(path.join(dist,'src'),{recursive:true});fs.copyFileSync(path.join(root,'src/future.mjs'),path.join(dist,'src/future.mjs'));
  const worker=workerRuntime({network:shellNetwork(dist),source:fs.readFileSync(path.join(dist,'sw.js'),'utf8')});
  const missing=[...moduleGraph(dist).keys()].filter(id=>!worker.inventory.includes(new URL(id).pathname));
  assert.equal(missing.length,1);assert.ok(missing[0].endsWith('/src/future.mjs'));
  const server=await serveActualDevServer(root);
  try{const response=await fetch(server.origin+'/src/future.mjs');assert.equal(response.status,200);assert.ok(javascriptType(response.headers.get('content-type')));assert.equal(await response.text(),'export const future=true;');}
  finally{await server.close();}
});
