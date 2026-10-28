import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const files=['app.js','cloud.js','config.js','demo.js','push-sw.js','sw.js','server.mjs'];
function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const p=folder+'/'+entry.name;if(entry.isDirectory())walk(p);else if(/\.(?:mjs|js)$/.test(p))files.push(p);}}
for(const folder of ['scripts','tests'])walk(folder);
for(const file of files)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
console.log(files.length+' JavaScript syntax checks passed.');
