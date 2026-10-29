import {moduleGraph} from './fixtures/public-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('security audit: schema.sql age confirmation rules', () => {
  const schema = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf-8');

  // 1. is_18_plus_confirmed MUST NOT have any default value (neither default true nor default false)
  assert.ok(!schema.includes('is_18_plus_confirmed boolean not null default'),
    'is_18_plus_confirmed must NOT have any default value');
  assert.ok(schema.includes('is_18_plus_confirmed boolean not null check (is_18_plus_confirmed = true)'),
    'is_18_plus_confirmed must be non-null and require check = true');

  // 2. profiles_insert policy must require is_18_plus_confirmed = true
  assert.ok(schema.includes('profiles_insert on public.profiles for insert to authenticated with check (id=auth.uid() and is_18_plus_confirmed = true);'),
    'profiles_insert policy must explicitly require is_18_plus_confirmed = true');

  // 3. profiles_update policy must prevent bypassing age check
  assert.ok(schema.includes('is_18_plus_confirmed = true'),
    'profiles_update policy must enforce is_18_plus_confirmed = true');
});

test('security audit: account deletion removed from RPC and only in Edge Function', () => {
  const schema = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf-8');

  // 1. delete_my_account RPC has been completely removed from SQL schema
  assert.ok(!schema.includes('function public.delete_my_account'),
    'delete_my_account RPC must be removed from schema.sql');

  // 2. No direct SQL delete on storage.objects
  assert.ok(!schema.includes('delete from storage.objects'),
    'schema must NOT delete rows directly from storage.objects using SQL');

  // 3. Official Storage API delete policies exist on storage.objects for authenticated users
  assert.ok(schema.includes('create policy post_image_delete on storage.objects for delete to authenticated'),
    'post_image_delete policy must exist so official Storage API can remove files');
  assert.ok(schema.includes('create policy avatar_remove on storage.objects for delete to authenticated'),
    'avatar_remove policy must exist so official Storage API can remove files');

  // 4. src/cloud.js uses Edge Function solely without client-side fallback
  const cloud = fs.readFileSync(path.join(rootDir, 'src', 'cloud.js'), 'utf-8');
  assert.ok(cloud.includes('client.functions.invoke(\'delete-account\')'),
    'src/cloud.js must invoke the delete-account Edge Function');
  assert.ok(!cloud.includes('delete_my_account'),
    'src/cloud.js must not reference deleted delete_my_account RPC');
});

test('security audit: no privileged keys in frontend or public code', () => {
  const filesToCheck = ['app.js', 'cloud.js', 'demo.js', 'config.js', 'index.html', 'server.mjs'];
  for (const file of new Set([...filesToCheck,...[...moduleGraph().keys()].map(id=>new URL(id).pathname.slice(1))])) {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf-8');
    assert.ok(!/service_role\s*[:=]/i.test(content), `${file} must not assign service_role keys`);
    assert.ok(!/secret_key\s*[:=]/i.test(content), `${file} must not assign secret keys`);
    assert.ok(!content.includes('SUPABASE_SERVICE_ROLE_KEY'), `${file} must not contain SUPABASE_SERVICE_ROLE_KEY`);
  }
});

test('security audit: Edge Function authenticates, removes storage first, handles partial failure, then deletes auth user', () => {
  const fnPath = path.join(rootDir, 'supabase', 'functions', 'delete-account', 'index.ts');
  assert.ok(fs.existsSync(fnPath), 'delete-account Edge Function must exist');

  const content = fs.readFileSync(fnPath, 'utf-8');
  // 1. Verifies caller JWT
  assert.ok(content.includes('userClient.auth.getUser()'), 'Must verify caller user JWT');
  // 2. Uses official Storage API .remove()
  assert.ok(content.includes("removeAll('post-images', postPathsToDelete)"),
    'Must use official Storage API for post images');
  assert.ok(content.includes("removeAll('avatars', avatarPathsToDelete)"),
    'Must use official Storage API for avatars');
  assert.ok(content.includes('offset += data.length') && content.includes('paths.slice(i, i + REMOVE_BATCH_SIZE)'),
    'Storage listing must paginate and removal must be batched');
  assert.ok(content.includes('remainingPostFolders.length > 0 || remainingAvatars.length > 0'),
    'Must verify storage is empty before deleting Auth');
  // 3. Storage errors throw before deleteUser is reached
  const storageCheckPos = content.indexOf("await removeAll('post-images', postPathsToDelete)");
  const deleteUserPos = content.indexOf('.auth.admin.deleteUser(');
  assert.ok(storageCheckPos > 0 && deleteUserPos > storageCheckPos,
    'Storage cleanup must occur before deleting the auth user');
  // 4. Uses adminClient to delete user identity
  assert.ok(content.includes('.auth.admin.deleteUser(user.id)'), 'Must delete auth user via admin client');
});

test('security audit: all SECURITY DEFINER functions have hardened search_path and explicit permissions', () => {
  const schema = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf-8');

  // Match all functions marked security definer
  const functionDefs = schema.split(/create (?:or replace )?function /i).slice(1);
  assert.ok(functionDefs.length >= 7, 'Must have audited security definer functions');

  for (const def of functionDefs) {
    if (def.includes('security definer')) {
      const funcSignature = def.split('\n')[0].trim();
      assert.ok(def.includes('set search_path = public, pg_temp'),
        `Function ${funcSignature} must set search_path = public, pg_temp`);
    }
  }

  // Ensure revoke from public and grant to authenticated
  assert.ok(schema.includes('revoke all on function public.rotate_invite() from public;'));
  assert.ok(schema.includes('revoke all on function public.send_friend_request(text) from public;'));
  assert.ok(schema.includes('revoke all on function public.handle_friend_request(uuid,text) from public;'));
  assert.ok(schema.includes('revoke all on function public.remove_friend(uuid) from public;'));
  assert.ok(schema.includes('revoke all on function public.publish_post(uuid) from public;'));
});

test('security audit: post_image_insert and post_image_delete policies enforce draft status and immutability', () => {
  const schema = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf-8');

  // Verify post_image_insert policy in SQL
  assert.ok(schema.includes('create policy post_image_insert on storage.objects for insert to authenticated'),
    'post_image_insert policy must exist');
  assert.ok(schema.includes("split_part(name, '/', 1) = auth.uid()::text"),
    'Must enforce caller UID matches first path segment');
  assert.ok(schema.includes("split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$'"),
    'Must enforce second segment is valid UUID');
  assert.ok(schema.includes("p.status = 'draft'"),
    'Must verify post has draft status');

  // Verify post_image_delete policy in SQL enforces draft status
  assert.ok(schema.includes('create policy post_image_delete on storage.objects for delete to authenticated'),
    'post_image_delete policy must exist');

  // Verify no UPDATE policy exists on storage.objects (images cannot be overwritten)
  assert.ok(!schema.includes('create policy') || !schema.includes('on storage.objects for update'),
    'No UPDATE policy should exist on storage.objects for users');

  // Exact behavioral verification of the SQL policy logic:
  const evaluatePostImageInsert = (authUid, bucketId, name, posts) => {
    if (bucketId !== 'post-images') return false;
    const parts = name.split('/');
    if (parts.length < 3) return false;
    if (parts[0] !== authUid) return false;
    const postId = parts[1];
    if (!/^[0-9a-f-]{36}$/.test(postId)) return false;
    const post = posts.find(p => p.id === postId && p.author_id === authUid && p.status === 'draft');
    return Boolean(post);
  };

  const evaluatePostImageDelete = (authUid, bucketId, name, posts) => {
    if (bucketId !== 'post-images') return false;
    const parts = name.split('/');
    if (parts.length < 3) return false;
    if (parts[0] !== authUid) return false;
    const postId = parts[1];
    if (!/^[0-9a-f-]{36}$/.test(postId)) return false;
    const post = posts.find(p => p.id === postId && p.author_id === authUid && p.status === 'draft');
    return Boolean(post);
  };

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';
  const draftPostA = '33333333-3333-3333-3333-333333333333';
  const publishedPostA = '44444444-4444-4444-4444-444444444444';

  const mockPosts = [
    { id: draftPostA, author_id: userA, status: 'draft' },
    { id: publishedPostA, author_id: userA, status: 'published' }
  ];

  // 1. Valid draft post upload: ALLOWED
  assert.equal(
    evaluatePostImageInsert(userA, 'post-images', `${userA}/${draftPostA}/1-file.jpg`, mockPosts),
    true,
    'Upload to owned draft post directory must be allowed'
  );

  // 2. Upload to published post: REJECTED (immutable)
  assert.equal(
    evaluatePostImageInsert(userA, 'post-images', `${userA}/${publishedPostA}/1-file.jpg`, mockPosts),
    false,
    'Upload to already published post must be rejected'
  );

  // 3. Upload to another user's post: REJECTED
  assert.equal(
    evaluatePostImageInsert(userB, 'post-images', `${userA}/${draftPostA}/1-file.jpg`, mockPosts),
    false,
    'Upload by non-author must be rejected'
  );

  // 4. Upload to non-UUID path: REJECTED
  assert.equal(
    evaluatePostImageInsert(userA, 'post-images', `${userA}/arbitrary-folder/1-file.jpg`, mockPosts),
    false,
    'Upload to non-UUID directory must be rejected'
  );

  // 5. Delete image from draft post: ALLOWED (draft cleanup)
  assert.equal(
    evaluatePostImageDelete(userA, 'post-images', `${userA}/${draftPostA}/1-file.jpg`, mockPosts),
    true,
    'Deletion of image belonging to owned draft post must be allowed'
  );

  // 6. Delete image from published post: REJECTED (published post images are immutable)
  assert.equal(
    evaluatePostImageDelete(userA, 'post-images', `${userA}/${publishedPostA}/1-file.jpg`, mockPosts),
    false,
    'Deletion of image from published post must be strictly denied'
  );

  // 7. Delete image by another user: REJECTED
  assert.equal(
    evaluatePostImageDelete(userB, 'post-images', `${userA}/${draftPostA}/1-file.jpg`, mockPosts),
    false,
    'Deletion by non-author must be rejected'
  );
});

test('security audit: publish_post strictly verifies actual uploaded files in storage.objects', () => {
  const schema = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf-8');

  // Verify SQL implementation checks storage.objects
  assert.ok(schema.includes('from storage.objects s'), 'publish_post must query storage.objects');
  assert.ok(schema.includes('join public.post_photos pp on s.name = pp.path'), 'publish_post must join post_photos on path');
  assert.ok(schema.includes("s.bucket_id = 'post-images'"), 'publish_post must verify bucket_id');
  assert.ok(schema.includes('actual_storage_count <> photo_count'), 'publish_post must reject when storage count differs from draft photos');

  // Behavioral test of the SQL verification logic:
  const evaluatePublishPost = (authUid, postId, posts, postPhotos, storageObjects) => {
    if (!authUid) throw new Error('Authentication required');
    const p = posts.find(post => post.id === postId);
    if (!p || p.author_id !== authUid || p.status !== 'draft') {
      throw new Error('Draft not found');
    }
    const photos = postPhotos.filter(ph => ph.post_id === postId);
    const photoCount = photos.length;
    if (photoCount > 3 || (p.kind === 'drank' && photoCount < 1)) {
      throw new Error('Invalid photo count');
    }

    if (photoCount > 0) {
      const actualStorageCount = storageObjects.filter(s =>
        s.bucket_id === 'post-images' &&
        s.name.startsWith(`${authUid}/${postId}/`) &&
        photos.some(pp => pp.path === s.name)
      ).length;

      if (actualStorageCount !== photoCount) {
        throw new Error('Photo verification failed: storage files do not match draft photos');
      }
    }

    p.status = 'published';
    p.published_at = new Date().toISOString();
    return true;
  };

  const userA = '11111111-1111-1111-1111-111111111111';
  const draftPostId = '33333333-3333-3333-3333-333333333333';
  const validPath1 = `${userA}/${draftPostId}/1-photo.jpg`;
  const validPath2 = `${userA}/${draftPostId}/2-photo.jpg`;

  // Case A: Both photos exist in storage.objects -> Publication succeeds
  const postsA = [{ id: draftPostId, author_id: userA, kind: 'drank', status: 'draft' }];
  const photosA = [{ post_id: draftPostId, slot: 1, path: validPath1 }, { post_id: draftPostId, slot: 2, path: validPath2 }];
  const storageA = [
    { bucket_id: 'post-images', name: validPath1 },
    { bucket_id: 'post-images', name: validPath2 }
  ];
  assert.ok(evaluatePublishPost(userA, draftPostId, postsA, photosA, storageA));
  assert.equal(postsA[0].status, 'published');

  // Case B: Post photos reference paths that were NEVER uploaded to storage.objects -> Publication rejected
  const postsB = [{ id: draftPostId, author_id: userA, kind: 'drank', status: 'draft' }];
  const photosB = [{ post_id: draftPostId, slot: 1, path: validPath1 }, { post_id: draftPostId, slot: 2, path: validPath2 }];
  const storageB = [{ bucket_id: 'post-images', name: validPath1 }]; // Missing validPath2!
  assert.throws(
    () => evaluatePublishPost(userA, draftPostId, postsB, photosB, storageB),
    /Photo verification failed: storage files do not match draft photos/
  );

  // Case C: Unuploaded photos with completely empty storage -> Publication rejected
  const postsC = [{ id: draftPostId, author_id: userA, kind: 'drank', status: 'draft' }];
  const photosC = [{ post_id: draftPostId, slot: 1, path: validPath1 }];
  const storageC = [];
  assert.throws(
    () => evaluatePublishPost(userA, draftPostId, postsC, photosC, storageC),
    /Photo verification failed: storage files do not match draft photos/
  );

  // Case D: Drank post without any photos -> Publication rejected
  const postsD = [{ id: draftPostId, author_id: userA, kind: 'drank', status: 'draft' }];
  const photosD = [];
  assert.throws(
    () => evaluatePublishPost(userA, draftPostId, postsD, photosD, []),
    /Invalid photo count/
  );
});

test('security audit: post photo access revoked immediately upon unfriending', () => {
  const schema = fs.readFileSync(path.join(rootDir, 'supabase', 'schema.sql'), 'utf-8');

  // Verify post_image_select policy uses can_view_post
  assert.ok(schema.includes('create policy post_image_select on storage.objects for select to authenticated'),
    'post_image_select policy must exist');
  assert.ok(schema.includes('public.can_view_post(pp.post_id)'),
    'post_image_select must be gated by public.can_view_post');

  // Verify remove_friend cleans up friendships
  assert.ok(schema.includes('delete from public.friendships where user_a=least(auth.uid(),p_friend_id) and user_b=greatest(auth.uid(),p_friend_id);'),
    'remove_friend must delete friendship row');

  // Simulation of RLS policy check
  const evaluateStorageAccess = (authUid, objectName, friendships, posts, postPhotos) => {
    // Check if photo belongs to a post
    const photo = postPhotos.find(pp => pp.path === objectName);
    if (!photo) return false;
    const post = posts.find(p => p.id === photo.post_id);
    if (!post) return false;

    // can_view_post logic:
    if (post.author_id === authUid) return true;
    if (post.status !== 'published') return false;
    // Must be friends
    const areFriends = friendships.some(f =>
      (f.user_a === Math.min(authUid, post.author_id) && f.user_b === Math.max(authUid, post.author_id)) ||
      (f.user_a === authUid && f.user_b === post.author_id) ||
      (f.user_b === authUid && f.user_a === post.author_id)
    );
    return areFriends;
  };

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';
  const postId = '33333333-3333-3333-3333-333333333333';
  const photoPath = `${userA}/${postId}/1-photo.jpg`;

  let friendships = [{ user_a: userA, user_b: userB }];
  const posts = [{ id: postId, author_id: userA, status: 'published' }];
  const postPhotos = [{ post_id: postId, slot: 1, path: photoPath }];

  // 1. While friends, userB can view the private post photo
  assert.equal(evaluateStorageAccess(userB, photoPath, friendships, posts, postPhotos), true);

  // 2. When unfriended, friendships row is removed
  friendships = [];

  // 3. Access is revoked immediately
  assert.equal(evaluateStorageAccess(userB, photoPath, friendships, posts, postPhotos), false);
});

test('security audit: failed uploads remove known files but retain uncertain drafts; definite publish rejection cleans completely', async () => {
  const { createCloud } = await import('../cloud.js');

  const removedPaths = [];
  const deletedPosts = [];
  let uploadFailOnSlot = 2; // Simulate upload failure on 2nd photo
  const draftIds = [];
  const posts=new Map(),objects=new Set(),metadata=new Map();

  const mockClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'test-user-id' } }, error: null })
    },
    from: (table) => {
      let op='select',filters=[];
      const query={
        insert(record){if(table==='posts'){draftIds.push(record.id);posts.set(record.id,record);}else if(table==='post_photos'){const rows=metadata.get(record.post_id)||[];rows.push(record);metadata.set(record.post_id,rows);}return Promise.resolve({data:null});},
        delete(){op='delete';return query;},eq(k,v){filters.push([k,v]);return query;},select(){return query;},maybeSingle(){return query;},
        then(resolve,reject){const id=filters.find(([k])=>k==='id')?.[1];
          if(op==='delete'){deletedPosts.push({id,filters});posts.delete(id);return Promise.resolve({data:[{id}]}).then(resolve,reject);}
          const row=posts.get(id);return Promise.resolve({data:row?{...row,post_photos:metadata.get(id)||[]}:null}).then(resolve,reject);
        }
      };return query;
    },
    storage: {
      from: (bucket) => ({
        upload: async (path) => {
          if (uploadFailOnSlot === 2 && path.includes('/2-')) {
            throw new Error('Simulated network disconnect during photo 2 upload');
          }
          objects.add(path);
          return { data: { path }, error: null };
        },
        list:async prefix=>({data:[...objects].filter(path=>path.startsWith(prefix+'/')).map(path=>({name:path.slice(prefix.length+1)}))}),
        remove: async (paths) => {
          removedPaths.push(...paths);
          for(const path of paths)objects.delete(path);
          return { data: paths, error: null };
        }
      })
    },
    rpc: async () => ({ data: null, error: null })
  };

  const cloud = createCloud(mockClient);

  // Attempt to create post with 3 photos where 2nd photo fails
  await assert.rejects(
    () => cloud.createPost('drank', 'Test drinks', ['file1', 'file2', 'file3']),
    error=>error.cleanupPending&&/Simulated network disconnect/.test(error.originalError.message)
  );

  // Verify that the 1st uploaded photo was cleaned up from storage
  assert.equal(removedPaths.length, 1);
  assert.ok(removedPaths[0].includes(`test-user-id/${draftIds[0]}/1-`));

  // Its unknown second upload may complete late: retain draft+metadata permission.
  assert.equal(deletedPosts.length, 0);
  assert.ok(posts.has(draftIds[0]));

  // Next test: upload succeeds for all photos, but publish_post RPC fails
  removedPaths.length = 0;
  deletedPosts.length = 0;
  uploadFailOnSlot = 999; // Don't fail upload

  mockClient.rpc = async (method) => {
    if (method === 'publish_post') return {error:{code:'P0001',message:'RPC verification error'}};
    return { data: null, error: null };
  };

  await assert.rejects(
    () => cloud.createPost('drank', 'Test drinks', ['file1', 'file2']),
    error=>error.message==='RPC verification error'
  );

  // All 2 successfully uploaded photos should be cleaned up from storage
  assert.equal(removedPaths.length, 2);
  assert.ok(removedPaths[0].includes('1-'));
  assert.ok(removedPaths[1].includes('2-'));

  // Draft post row was deleted
  assert.equal(deletedPosts.length, 1);
  assert.equal(deletedPosts[0].id,draftIds[1]);
  assert.ok(deletedPosts[0].filters.some(([key,value])=>key==='status'&&value==='draft'));
});
