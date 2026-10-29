import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {moduleGraph,moduleImports,moduleOrigin,moduleEntries,serveModuleFixture,javascriptType} from './fixtures/public-modules.mjs';

for(const scenario of ['exports','demo-compat','demo-relocation','cloud-compat','cloud-relocation','demo-boot','cloud-boot','nested','offline','upgrade-rollback']){
  test('native ES modules: '+scenario,()=>{
    const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/module-runtime-check.mjs',import.meta.url)),scenario],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr||result.error?.message||result.stdout);
    assert.equal(JSON.parse(result.stdout.trim()).passed,true);
  });
}
test('HTML entry graph resolves all current public modules; future imports/re-exports/dynamic literals are discovered',()=>{
  const graph=moduleGraph();assert.ok(graph.has(moduleOrigin+'/app.js'));
  assert.ok(graph.has(moduleOrigin+'/cloud.js'));assert.ok(graph.has(moduleOrigin+'/demo.js'));
  assert.deepEqual([...new Set(moduleImports(graph.get(moduleOrigin+'/src/cloud.js'),moduleOrigin+'/src/cloud.js'))],[moduleOrigin+'/src/auth-helpers.js']);
  assert.deepEqual(moduleImports(graph.get(moduleOrigin+'/src/auth-helpers.js'),moduleOrigin+'/src/auth-helpers.js'),[],'Cloud/helper dependencies stay acyclic');
  assert.deepEqual(moduleEntries('<script src="/entry.mjs" type="module"></script>'),[moduleOrigin+'/entry.mjs']);
  assert.deepEqual(moduleEntries('<!-- <script type=module src=/ignored.js></script> --><script data-type=module src=/classic.js></script><script type=module src=src/entry.js></script>'),[moduleOrigin+'/src/entry.js']);
  const dependencies=moduleImports("import './src/side.js';export {x} from './src/export.mjs';export * from './src/all.js';const next=()=>import('./src/lazy.js');",moduleOrigin+'/app.js');
  assert.equal(dependencies.length,4);assert.ok(dependencies.every(id=>id.startsWith(moduleOrigin+'/src/')));
  assert.throws(()=>moduleImports('import(path)',moduleOrigin+'/app.js'),/Computed import/);
  assert.throws(()=>moduleImports("import 'https://outside.invalid/a.js'",moduleOrigin+'/app.js'),/Nonlocal/);
});
test('missing future public modules and misleading module MIME types fail the gate',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azice-graph-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'index.html'),'<script type="module" src="/app.js"></script>');
  fs.writeFileSync(path.join(root,'app.js'),"import './src/missing.js';");
  assert.throws(()=>moduleGraph(root),/ENOENT/);
  for(const type of ['text/html','text/plain','application/json',''])assert.equal(javascriptType(type),false);
  assert.equal(javascriptType('text/javascript; charset=utf-8'),true);
});
test('browser fixture serves real modules and demo configuration without enabling a service worker',async t=>{
  const server=http.createServer((req,res)=>{if(!serveModuleFixture(req,res)){res.statusCode=404;res.end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));const origin='http://127.0.0.1:'+server.address().port;
  const page=await fetch(origin+'/modules');assert.match(await page.text(),/type="module" src="\/app.js"/);
  for(const id of moduleGraph().keys()){const response=await fetch(origin+new URL(id).pathname);assert.equal(response.status,200);assert.ok(javascriptType(response.headers.get('content-type')));}
  const config=await (await fetch(origin+'/config.js')).text();assert.doesNotMatch(config,/sb_publishable_|supabase\.co/);
  for(const route of ['/sw.js','/push-sw.js','/config.production.json','/supabase/schema.sql','/.env'])assert.equal((await fetch(origin+route)).status,404);
});
