import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DEMO_CONFIG,validateConfig} from './config.mjs';
const context={window:{}};
try{
 vm.runInNewContext(fs.readFileSync('dist/config.js','utf8'),context,{timeout:1000});
 const value=validateConfig(context.window.AZICE_CONFIG);
 if(Object.keys(context.window.AZICE_CONFIG).length!==Object.keys(DEMO_CONFIG).length||Object.values(value).some(Boolean))throw Error();
}catch{throw Error('Generated CI output must be demo-only. Configuration values are not logged.');}
assert.deepEqual(fs.readdirSync('dist').sort(),['app.js','assets','cloud.js','config.js','demo.js','index.html','manifest.webmanifest','push-sw.js','styles.css','sw.js'].sort());
for(const file of ['logo.png','azice-mascot-master-v2.png'])assert.equal(fs.existsSync('dist/assets/'+file),false);
console.log('Demo-only packaging and private/authoring exclusions passed.');
