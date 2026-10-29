import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const names=['activityBellIcon','avatar','backBar','brand','dayISO','fmt','html','initials','photoCard'];
import * as p from '../src/presentation.js';
test('presentation named export surface is explicit',()=>assert.deepEqual(Object.keys(p).sort(),names));

test('presentation escaping preserves nulls, coercion, Unicode and exact entities',()=>{
  for(const [input,expected] of [[null,''],[undefined,''],[0,'0'],[false,'false'],['&<>"\'','&amp;&lt;&gt;&quot;&#39;'],['🍺 é','🍺 é'],['&amp;','&amp;amp;']])assert.equal(p.html(input),expected);
  assert.equal(p.initials('  alice'),'A');assert.equal(p.initials(''),' ?'.trim());
  assert.equal(p.initials('   '),'');assert.equal(p.initials('<script>'),'&lt;');
});
test('date helpers preserve local-calendar semantics and en-US timestamp formatting',()=>{
  const local=new Date(2026,0,2,0,5);
  assert.equal(p.dayISO(local),'2026-01-02');
  assert.equal(p.dayISO(new Date(2025,11,31,23,59)),'2025-12-31');
  assert.equal(p.fmt(local),'Jan 2, 12:05 AM');
  assert.equal(p.fmt('invalid'),'Invalid Date');assert.equal(p.dayISO('invalid'),'NaN-NaN-NaN');
});
test('local-day formatting retains timezone boundaries without normalizing to UTC',()=>{
  const moduleURL=new URL('../src/presentation.js',import.meta.url).href;
  for(const [zone,expected] of [['UTC','2026-01-01'],['Europe/Bucharest','2026-01-02'],['America/New_York','2026-01-01'],['Pacific/Kiritimati','2026-01-02']]){
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import {dayISO} from ${JSON.stringify(moduleURL)}; console.log(dayISO('2026-01-01T23:30:00Z'));`],{env:{...process.env,TZ:zone},encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),expected,zone);
  }
});
test('stateless markup preserves classes, escaping, actions and accessible labels exactly',()=>{
  assert.equal(p.brand(),'<div class="brand">AziCe<span>?</span></div>');
  assert.equal(p.backBar('<Friends>'),'<div class="subheader"><button class="icon-btn" data-action="profile" aria-label="Back">‹</button><h1>&lt;Friends&gt;</h1></div>');
  assert.equal(p.backBar('Activity','feed'),'<div class="subheader"><button class="icon-btn" data-action="feed" aria-label="Back">‹</button><h1>Activity</h1></div>');
  assert.equal(p.photoCard({path:'a"&'},1),'<button type="button" class="photo-slide" data-action="view-photo" data-path="a&quot;&amp;" aria-label="Open full photo 2"><span class="photo-loading" aria-hidden="true">📷</span><img data-private-photo="a&quot;&amp;" alt="Photo 2" loading="lazy"></button>');
  assert.equal(p.avatar(null),'<div class="avatar ">?</div>');
  assert.equal(p.avatar({display_name:'<A',avatar_path:'one'},'small'),'<div class="avatar small"><img data-private-photo="avatar:one" alt="&lt;A avatar"></div>');
  for(const path of ['avatar:one','data:image/png;base64,AA'])assert.equal(p.avatar({avatar_path:path}),`<div class="avatar "><img data-private-photo="${path}" alt="User avatar"></div>`);
  assert.equal(p.activityBellIcon(),'<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>');
});
