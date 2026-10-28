import fs from 'node:fs';
import vm from 'node:vm';
import {DEMO_CONFIG,validateConfig} from './config.mjs';
const context={window:{}};
try{
 vm.runInNewContext(fs.readFileSync('config.js','utf8'),context,{timeout:1000});
 const value=validateConfig(context.window.AZICE_CONFIG);
 if(Object.keys(context.window.AZICE_CONFIG).length!==Object.keys(DEMO_CONFIG).length||Object.values(value).some(Boolean))throw Error();
}catch{throw Error('Source config.js must be valid demo-only configuration. Values are not logged.');}
validateConfig(JSON.parse(fs.readFileSync('config.production.json','utf8')),{requireCloud:true});
validateConfig(JSON.parse(fs.readFileSync('config.example.json','utf8')));
console.log('Demo default and public production profile validated offline; no values logged.');
