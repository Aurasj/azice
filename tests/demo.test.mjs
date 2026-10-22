import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../demo.js';
const storage = new Map();
globalThis.localStorage = {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};

test('demo: feed, post validation, 48h visibility and single reaction', async()=>{
  const app=createDemo();
  const original=await app.getFeed();
  assert.equal(original.length,2);
  await assert.rejects(()=>app.createPost('drank','No photo',[]),/Invalid post/);
  await assert.rejects(()=>app.createPost('sober','',[]),/Invalid post/);
  const post=await app.createPost('sober','No drink today.',[]);
  assert.equal((await app.getFeed()).length,3);
  await app.react(post.id,'😂');
  await app.react(post.id,'❤️');
  let myPost=(await app.getFeed()).find(p=>p.id===post.id);
  assert.equal(myPost.reactions.length,1);
  assert.equal(myPost.reactions[0].emoji,'❤️');
  await app.comment(post.id,'A short comment');
  myPost=(await app.getFeed()).find(p=>p.id===post.id);
  assert.equal(myPost.comments[0].body,'A short comment');
  assert.equal((await app.getHistory('demo-me')).length,1);
});

test('demo: removing friends revokes their posts immediately',async()=>{
  const app=createDemo();
  await app.unfriend('demo-alex');
  assert.ok(!(await app.getFeed()).some(p=>p.author_id==='demo-alex'));
  assert.equal((await app.getHistory('demo-alex')).length,0);
});
