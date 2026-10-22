import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../demo.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear()
};

if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    readAsDataURL(file) {
      setTimeout(() => {
        this.result = `data:image/jpeg;base64,mock_${typeof file === 'string' ? file : 'file'}`;
        this.onload?.();
      }, 0);
    }
  };
}

function resetStorage() {
  storage.clear();
  // Initialize with fresh starter by triggering a persist or resetDemo
  const initApp = createDemo();
  initApp.resetDemo();
}

test('demo: feed, post validation, 48h visibility and single reaction', async () => {
  resetStorage();
  const app = createDemo();
  const original = await app.getFeed();
  assert.equal(original.length, 2, 'Feed should start with 2 recent sample posts');
  
  await assert.rejects(() => app.createPost('drank', 'No photo', []), /Invalid post/, 'Drank requires photo');
  await assert.rejects(() => app.createPost('sober', '', []), /Invalid post/, 'Empty reason rejected');
  await assert.rejects(() => app.createPost('invalid_kind', 'Reason', []), /Invalid post/, 'Invalid kind rejected');
  await assert.rejects(() => app.createPost('sober', 'a'.repeat(301), []), /Invalid post/, 'Reason over 300 chars rejected');

  const post = await app.createPost('sober', 'No drink today.', []);
  assert.equal((await app.getFeed()).length, 3);

  // Single reaction per user: reacting with another emoji replaces it
  await app.react(post.id, '😂');
  await app.react(post.id, '❤️');
  let myPost = (await app.getFeed()).find(p => p.id === post.id);
  assert.equal(myPost.reactions.length, 1);
  assert.equal(myPost.reactions[0].emoji, '❤️');

  // Commenting
  await app.comment(post.id, 'A short comment');
  myPost = (await app.getFeed()).find(p => p.id === post.id);
  assert.equal(myPost.comments[0].body, 'A short comment');
  assert.equal((await app.getHistory('demo-me')).length, 1);
});

test('demo: removing friends revokes their posts immediately', async () => {
  resetStorage();
  const app = createDemo();
  await app.unfriend('demo-alex');
  assert.ok(!(await app.getFeed()).some(p => p.author_id === 'demo-alex'));
  assert.equal((await app.getHistory('demo-alex')).length, 0);
});

test('demo: 30-day friend history cutoff vs unlimited own history', async () => {
  resetStorage();
  const app = createDemo();

  // Create an old post for demo-me (e.g. 40 days ago) and for demo-alex (35 days ago)
  const now = Date.now();
  const rawDb = JSON.parse(storage.get('azice-demo-v1'));
  rawDb.posts.push({
    id: 'old-own-post',
    author_id: 'demo-me',
    kind: 'sober',
    reason: 'Old memory 40 days ago',
    status: 'published',
    published_at: new Date(now - 40 * 86400000).toISOString(),
    photos: []
  });
  rawDb.posts.push({
    id: 'old-alex-post',
    author_id: 'demo-alex',
    kind: 'drank',
    reason: 'Old memory 35 days ago',
    status: 'published',
    published_at: new Date(now - 35 * 86400000).toISOString(),
    photos: []
  });
  storage.set('azice-demo-v1', JSON.stringify(rawDb));

  const reloaded = createDemo();

  // Own history includes old post > 30 days
  const myHistory = await reloaded.getHistory('demo-me');
  assert.ok(myHistory.some(p => p.id === 'old-own-post'), 'Own history must keep posts older than 30 days');

  // Friend history excludes posts older than 30 days
  const alexHistory = await reloaded.getHistory('demo-alex');
  assert.ok(!alexHistory.some(p => p.id === 'old-alex-post'), 'Friend history must cut off posts older than 30 days');
  assert.ok(alexHistory.some(p => p.id === 'sample-1'), 'Friend history should include recent post (sample-1)');
  assert.ok(alexHistory.some(p => p.id === 'sample-3'), 'Friend history should include 5-day post (sample-3)');

  // Feed excludes posts older than 48 hours for both
  const feed = await reloaded.getFeed();
  assert.ok(!feed.some(p => p.id === 'old-own-post'), 'Feed must not include posts older than 48h');
  assert.ok(!feed.some(p => p.id === 'old-alex-post'), 'Feed must not include posts older than 48h');
});

test('demo: emoji reaction rules and removal', async () => {
  resetStorage();
  const app = createDemo();
  const feed = await app.getFeed();
  const postId = feed[0].id;

  // Allowed emojis: 😂 ❤️ 😮 🔥 👏
  for (const emoji of ['😂', '❤️', '😮', '🔥', '👏']) {
    await app.react(postId, emoji);
    const post = (await app.getFeed()).find(p => p.id === postId);
    const myReact = post.reactions.find(r => r.user_id === 'demo-me');
    assert.equal(myReact?.emoji, emoji);
  }

  // Invalid emoji should be rejected
  await assert.rejects(() => app.react(postId, '🎉'), /Reactions are closed or invalid/);
  await assert.rejects(() => app.react(postId, '👍'), /Reactions are closed or invalid/);

  // Removing reaction with null or empty string
  await app.react(postId, null);
  const postAfterRemove = (await app.getFeed()).find(p => p.id === postId);
  assert.ok(!postAfterRemove.reactions.some(r => r.user_id === 'demo-me'), 'Reaction should be removed');
});

test('demo: comments and reactions closed after 48 hours', async () => {
  resetStorage();
  const app = createDemo();

  // sample-3 is 5 days old (> 48h)
  await assert.rejects(() => app.comment('sample-3', 'Too late to comment'), /Comments are closed or invalid/);
  await assert.rejects(() => app.react('sample-3', '🔥'), /Reactions are closed or invalid/);

  // Comment length checks
  const feed = await app.getFeed();
  const activePostId = feed[0].id;
  await assert.rejects(() => app.comment(activePostId, ''), /Comments are closed or invalid/);
  await assert.rejects(() => app.comment(activePostId, '   '), /Comments are closed or invalid/);
  await assert.rejects(() => app.comment(activePostId, 'a'.repeat(301)), /Comments are closed or invalid/);
});

test('demo: drank post with photos up to 3', async () => {
  resetStorage();
  const app = createDemo();

  const dummyBlob = { name: 'photo.jpg', size: 1024, type: 'image/jpeg' };
  
  // 1 photo for drank: valid
  const post1 = await app.createPost('drank', 'Having a beer', [dummyBlob]);
  assert.equal(post1.photos.length, 1);
  assert.ok(post1.photos[0].path.startsWith('data:image/jpeg'));

  // 3 photos: valid
  const post3 = await app.createPost('drank', 'Three drinks', [dummyBlob, dummyBlob, dummyBlob]);
  assert.equal(post3.photos.length, 3);

  // 4 photos: rejected
  await assert.rejects(() => app.createPost('drank', 'Four drinks', [dummyBlob, dummyBlob, dummyBlob, dummyBlob]), /Invalid post/);
});

test('demo: friend requests lifecycle (accept, decline, cancel)', async () => {
  resetStorage();
  const app = createDemo();

  // Inject pending requests
  const rawDb = JSON.parse(storage.get('azice-demo-v1'));
  rawDb.requests.push({ id: 'req-incoming-1', sender_id: 'demo-alex', receiver_id: 'demo-me', status: 'pending' });
  rawDb.requests.push({ id: 'req-incoming-2', sender_id: 'demo-alex', receiver_id: 'demo-me', status: 'pending' });
  rawDb.requests.push({ id: 'req-outgoing-1', sender_id: 'demo-me', receiver_id: 'demo-sam', status: 'pending' });
  storage.set('azice-demo-v1', JSON.stringify(rawDb));

  const reloaded = createDemo();
  let fData = await reloaded.friendData();
  assert.equal(fData.incoming.length, 2);
  assert.equal(fData.outgoing.length, 1);

  // Accept incoming request
  await reloaded.requestAction('req-incoming-1', 'accept');
  // Decline incoming request
  await reloaded.requestAction('req-incoming-2', 'decline');
  // Cancel outgoing request
  await reloaded.requestAction('req-outgoing-1', 'cancel');

  fData = await reloaded.friendData();
  assert.equal(fData.incoming.length, 0, 'No more pending incoming requests');
  assert.equal(fData.outgoing.length, 0, 'No more pending outgoing requests');
});

test('demo: rotate invite token and profile update', async () => {
  resetStorage();
  const app = createDemo();

  const token1 = await app.getInvite();
  assert.equal(token1, 'demo-invite');

  const token2 = await app.rotateInvite();
  assert.notEqual(token1, token2);
  assert.equal(await app.getInvite(), token2);

  const preview = await app.previewInvite(token2);
  assert.equal(preview.id, 'demo-me');
  assert.equal(await app.previewInvite('invalid-token'), null);

  // Update profile
  await app.saveProfile({ display_name: 'Super Alex', bio: 'Living the dream.' });
  const myProf = await app.getMyProfile();
  assert.equal(myProf.display_name, 'Super Alex');
  assert.equal(myProf.bio, 'Living the dream.');

  // Reset demo
  await app.resetDemo();
  const resetProf = await app.getMyProfile();
  assert.equal(resetProf.display_name, 'You');
  assert.equal(await app.getInvite(), 'demo-invite');
});

test('demo: age confirmation 18+ requirement (reject missing or false)', async () => {
  resetStorage();
  const app = createDemo();

  // Reset to an unconfirmed profile to test onboarding
  const rawDb = JSON.parse(storage.get('azice-demo-v1'));
  rawDb.profiles[0].is_18_plus_confirmed = false;
  storage.set('azice-demo-v1', JSON.stringify(rawDb));

  const unconfirmedApp = createDemo();

  // 1. Explicit false must be rejected
  await assert.rejects(
    () => unconfirmedApp.saveProfile({ display_name: 'Alex', username: 'alex_test', is_18_plus_confirmed: false }),
    /Age confirmation required/,
    'is_18_plus_confirmed: false must be rejected'
  );

  // 2. Missing confirmation when unconfirmed must be rejected
  await assert.rejects(
    () => unconfirmedApp.saveProfile({ display_name: 'Alex', username: 'alex_test' }),
    /Age confirmation required/,
    'Missing is_18_plus_confirmed must be rejected during onboarding'
  );

  // 3. Explicit true must succeed
  const saved = await unconfirmedApp.saveProfile({
    display_name: 'Alex',
    username: 'alex_test',
    is_18_plus_confirmed: true
  });
  assert.equal(saved.is_18_plus_confirmed, true);
  assert.equal(saved.display_name, 'Alex');

  // 4. Once confirmed, editing regular fields (without passing is_18_plus_confirmed) works
  const edited = await unconfirmedApp.saveProfile({ display_name: 'Alex Updated', bio: 'New bio' });
  assert.equal(edited.display_name, 'Alex Updated');
  assert.equal(edited.is_18_plus_confirmed, true);

  // 5. Attempting to set is_18_plus_confirmed: false on existing profile must still be rejected
  await assert.rejects(
    () => unconfirmedApp.saveProfile({ is_18_plus_confirmed: false }),
    /Age confirmation required/
  );
});

test('demo: account deletion wipes posts, reactions, comments, friends, and reset profile', async () => {
  resetStorage();
  const app = createDemo();

  // Verify we have feed items and friends initially
  const feedBefore = await app.getFeed();
  assert.ok(feedBefore.length > 0);
  const friendsBefore = await app.friendData();
  assert.ok(friendsBefore.friends.length > 0);

  // Delete account
  await app.deleteAccount();

  // Verify posts, friends, reactions are cleared
  const feedAfter = await app.getFeed();
  assert.equal(feedAfter.length, 0);
  const friendsAfter = await app.friendData();
  assert.equal(friendsAfter.friends.length, 0);
  const myProfile = await app.getMyProfile();
  assert.equal(myProfile.avatar_path, null);
  assert.equal(myProfile.is_18_plus_confirmed, false);
});

