import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('source MIT grant and mixed code/artwork package scope agree',()=>{
 const license=read('LICENSE');
 assert.match(license,/MIT License/);
 assert.match(license,/Copyright \(c\) 2026 Aurasj and contributors/);
 assert.match(license,/Permission is hereby granted, free of charge/);
 assert.match(license,/including\s+all bundled artwork under assets\/, are excluded/);
 assert.match(license,/does not restrict reuse of the MIT-licensed UI source code/);
 const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
 assert.equal(pkg.license,'SEE LICENSE IN LICENSE');
 assert.equal(lock.packages[''].license,pkg.license);
 assert.equal(pkg.private,true);
 assert.equal(fs.existsSync(new URL('../LICENSE.proposed',import.meta.url)),false);
});

test('branding inventories graphics and contributor documents link the active policy',()=>{
 const branding=read('BRANDING.md');
 for(const name of fs.readdirSync(new URL('../assets/',import.meta.url)).filter(name=>/\.(?:png|svg)$/.test(name)))assert.ok(branding.includes('assets/'+name),'Artwork needs provenance/scope entry: '+name);
 assert.match(branding,/Project provenance records state[\s\S]*ChatGPT[\s\S]*maintainer-attested provenance statement/);
 assert.match(branding,/Maintainer states these were created for AziCe[\s\S]*not independent provenance verification/);
 assert.match(branding,/must not imply official affiliation/);
 for(const file of ['README.md','CONTRIBUTING.md','.github/pull_request_template.md']){
  const text=read(file);assert.ok(text.includes('LICENSE'),file);assert.ok(text.includes('BRANDING.md'),file);assert.ok(!text.includes('LICENSE.proposed'),file);
 }
});
