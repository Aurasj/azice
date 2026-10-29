import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {orderedCSS,compactCSS} from './fixtures/css-contract.mjs';

const source=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/styles-order.json',import.meta.url),'utf8'));

test('stylesheet preserves the complete pre-format ordered selector/declaration/media contract',()=>{
 assert.deepEqual(orderedCSS(source),baseline);
});
test('CSS inventory preserves duplicates, specificity, strings, function values and media order',()=>{
 const css='.a>.b{color:red;color:blue!important;content:"a;{}: b";width:calc(100% - 2px)}@media(max-width:350px){.a .b{color:green}}.a>.b{color:orange}';
 const rules=orderedCSS(css);assert.equal(rules.length,3);
 assert.deepEqual(rules[0].declarations,[['color','red'],['color','blue!important'],['content','"a;{}: b"'],['width','calc(100% - 2px)']]);
 assert.equal(rules[1].prelude,'@media(max-width:350px)');assert.equal(rules[1].rules[0].prelude,'.a .b');
 assert.equal(compactCSS(css),css);
 assert.notDeepEqual(orderedCSS(css.replace('color:red;color:blue','color:blue;color:red')),rules);
 assert.notDeepEqual(orderedCSS(css.replace('.a .b','.a.b')),rules);
 assert.notDeepEqual(orderedCSS(css.replace('max-width:350px','max-width:351px')),rules);
 assert.deepEqual(orderedCSS('/* comment */\n.a { color: red; }'),orderedCSS('.a{color:red}'));
});
test('CSS inventory rejects unsupported or incomplete syntax instead of silently omitting rules',()=>{
 for(const css of ['.a{color:red','.a{color:"bad}','.a{color:red}}','@supports(display:grid){.a{display:grid}}','.a{.b{color:red}}'])assert.throws(()=>orderedCSS(css));
});
