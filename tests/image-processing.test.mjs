import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as processing from '../src/image-processing.js';
import {moduleImports,moduleOrigin} from './fixtures/public-modules.mjs';

test('image helper module has two explicit exports, no dependencies or eager browser access',()=>{
 assert.deepEqual(Object.keys(processing).sort(),['canvasBlob','decodeAvatar']);
 assert.equal(processing.canvasBlob.length,3);assert.equal(processing.decodeAvatar.length,1);
 assert.deepEqual(moduleImports(fs.readFileSync(new URL('../src/image-processing.js',import.meta.url),'utf8'),moduleOrigin+'/src/image-processing.js'),[]);
});
for(const scenario of ['realm','canvas','bitmap','fallback'])test('native ESM image processing: '+scenario,()=>{
 const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/image-processing-check.mjs',import.meta.url)),scenario],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr||result.error?.message||result.stdout);
 assert.equal(JSON.parse(result.stdout.trim()).passed,true);
});
