import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {checkDocumentation,reachableDocuments} from '../scripts/check-doc-links.mjs';

test('documentation relative links/anchors/case are valid and all docs are reachable from both entry indexes',()=>{
  const result=checkDocumentation(fileURLToPath(new URL('../',import.meta.url)));
  assert.deepEqual(result.issues,[]);
  for(const entry of ['README.md','docs/README.md']){const seen=reachableDocuments(result.graph,entry);for(const file of result.files.filter(f=>f.startsWith('docs/')))assert.ok(seen.has(file),entry+' cannot reach '+file);}
});
test('documentation check detects missing files/anchors/images and case errors, supports references and never needs network',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azice-doc-links-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs/a file.md'),'# Same\n# Same\n<a id="explicit"></a>\n');
  fs.writeFileSync(path.join(root,'README.md'),'[good](<docs/a file.md#same-1>)\n[explicit][guide]\n[guide]: <docs/a file.md#explicit>\n[remote](https://outside.invalid/not-fetched)\n');
  assert.deepEqual(checkDocumentation(root).issues,[]);
  fs.appendFileSync(path.join(root,'README.md'),'[bad](docs/missing.md)\n[case](<docs/A file.md>)\n[anchor](<docs/a file.md#missing>)\n![image](docs/missing.png)\n');
  const issues=checkDocumentation(root).issues;assert.equal(issues.length,4);assert.ok(issues.some(x=>x.includes('missing anchor')));assert.ok(issues.some(x=>x.includes('missing.png')));assert.ok(issues.some(x=>x.includes('A file.md')));
});

test('current release status records deployed v0.1.1.1 without changing screenshot provenance',()=>{for(const file of ['README.md','DEPLOY.md','SECURITY.md','docs/ARCHITECTURE.md','docs/README.md','docs/open-source-readiness.md','docs/backend/migration-status.md']){const s=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');assert(!s.includes('local and uncommitted'),file);assert(s.includes('0.1.1.1'),file);assert(s.includes('edf1427'),file);}assert(fs.readFileSync(new URL('../docs/screenshots/README.md',import.meta.url),'utf8').includes('preceding **BETA v0.1.1.0**'));});
