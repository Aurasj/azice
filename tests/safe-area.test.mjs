import {compactCSS} from './fixtures/css-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const index=read('index.html'),rawCSS=read('styles.css'),css=compactCSS(rawCSS);
// The browser fixture checks actual geometry. These guards cover the viewport contract
// and inset ownership even on Node installations without a browser/CSS engine.
const safe=compactCSS(rawCSS.slice(rawCSS.indexOf('/* Each viewport boundary owns its insets;')));
const rule=selector=>[...safe.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim()===selector).map(match=>match[2]).join(';');

test('iOS viewport covers the display without disabling zoom, in browser and standalone mode',()=>{
 const viewports=[...index.matchAll(/<meta name="viewport" content="([^"]+)"/g)];assert.equal(viewports.length,1);
 assert.match(viewports[0][1],/width=device-width/);assert.match(viewports[0][1],/initial-scale=1/);assert.match(viewports[0][1],/viewport-fit=cover/);
 assert.doesNotMatch(viewports[0][1],/user-scalable=no|maximum-scale=1/);
 assert.match(index,/name="apple-mobile-web-app-capable" content="yes"/);
 assert.equal(JSON.parse(read('manifest.webmanifest')).display,'standalone');
});

test('all four safe insets have zero fallbacks; shared header owns top inset exactly once',()=>{
 for(const side of ['top','right','bottom','left'])assert.ok(rule(':root').includes(`--safe-${side}:env(safe-area-inset-${side},0px)`));
 assert.match(rule('.header'),/height:calc\(68px \+ var\(--safe-top\)\)/);
 assert.match(rule('.header'),/padding-top:var\(--safe-top\)/);
 assert.doesNotMatch(rule('.content'),/padding-top/);assert.doesNotMatch(rule('.friends-screen'),/--safe-/);
 assert.doesNotMatch(safe,/\.app-shell\{[^}]*padding-top/);
});

test('bottom inset expands navigation and content clearance instead of squeezing the existing controls',()=>{
 assert.match(rule('.bottom-nav'),/height:calc\(78px \+ var\(--safe-bottom\)\)/);
 assert.match(rule('.bottom-nav'),/padding-bottom:calc\(9px \+ var\(--safe-bottom\)\)/);
 assert.match(rule('.content'),/padding-bottom:calc\(116px \+ var\(--safe-bottom\)\)/);
 assert.match(rule('.content'),/padding-bottom:calc\(110px \+ var\(--safe-bottom\)\)/); // Narrow phones.
 assert.equal(rule('.friends-screen'),'padding-bottom:12px');
});

test('shared page and navigation boundaries protect both landscape edges',()=>{
 for(const selector of ['.header','.content','.bottom-nav','.centered'])for(const side of ['left','right'])
  assert.ok(rule(selector).includes(`var(--safe-${side})`),`${selector}: ${side}`);
 assert.match(rule('.centered'),/padding-top:calc\(65px \+ var\(--safe-top\)\)/);
 assert.match(rule('.centered'),/padding-top:calc\(8vh \+ var\(--safe-top\)\)/); // Desktop spacing retained.
});

test('camera owns all four insets; its footer adds no second bottom inset and short screens can scroll',()=>{
 assert.match(rule('.camera-screen'),/padding:var\(--safe-top\) var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
 assert.match(rule('.camera-screen'),/max-height:100dvh/);assert.match(rule('.camera-screen'),/overflow-y:auto/);
 assert.equal(rule('.camera-footer'),'padding-bottom:27px');
 assert.match(rule('.camera-header,.camera-footer'),/flex-shrink:0/);
});

test('native dialogs and install overlay stay within the safe dynamic viewport and allow scrolling',()=>{
 assert.match(rule('.azice-confirm'),/inset:var\(--safe-top\) var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
 for(const selector of ['.azice-confirm','.modal']){
  assert.match(rule(selector),/max-height:calc\(100dvh - var\(--safe-top\) - var\(--safe-bottom\)/);
  assert.match(rule(selector),/overflow-y:auto/);
 }
 for(const side of ['top','right','bottom','left'])assert.ok(rule('.modal-backdrop').includes(`var(--safe-${side})`));
 assert.match(rule('.toast'),/top:calc\(16px \+ var\(--safe-top\)\)/);
});

test('full-photo viewer preserves contain rendering and keeps its close control within safe edges',()=>{
 assert.match(rule('.full-photo-viewer'),/padding:var\(--safe-top\) var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
 assert.match(rule('.viewer-close'),/top:calc\(12px \+ var\(--safe-top\)\)/);
 assert.match(rule('.viewer-close'),/right:calc\(12px \+ var\(--safe-right\)\)/);
 assert.match(css,/\.full-photo-viewer img\{[^}]*object-fit:contain/);
 assert.match(css,/\.photo-slide\{[^}]*aspect-ratio:4\/5/);
});

test('keyboard/focus clearance uses normal document scrolling and dynamic minimum height',()=>{
 assert.match(rule('#app'),/min-height:100dvh/);
 assert.match(rule('html'),/scroll-padding-top:calc\(84px \+ var\(--safe-top\)\)/);
 assert.match(rule('html'),/scroll-padding-bottom:calc\(94px \+ var\(--safe-bottom\)\)/);
 assert.doesNotMatch(safe,/(?:html|body|#app|\.content)\{[^}]*(?:overflow:hidden|height:100dvh;)/);
});
