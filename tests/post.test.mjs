/**
 * Regression tests for the createPost flow in cloud.js.
 *
 * Architecture after the diagnostic change:
 *   - The draft UUID is generated locally with crypto.randomUUID() before the INSERT.
 *   - The INSERT uses that pre-generated id and has NO .select()/.single() chain,
 *     so PostgREST sends no RETURNING clause and the SELECT RLS policy is never
 *     evaluated as part of the INSERT response.
 *   - The same locally-generated id is reused for Storage paths, post_photos, and
 *     the publish_post RPC argument.
 *
 * Tests verify:
 *   - The INSERT payload contains a valid UUID 'id' field (not server-generated)
 *   - The INSERT payload has the correct author_id, kind, reason, status='draft'
 *   - Storage paths and post_photos use that same UUID
 *   - publish_post RPC receives that same UUID
 *   - Cleanup (storage remove + draft delete) uses the same UUID on failure
 *   - Draft INSERT failures propagate before any cleanup is attempted
 *   - Storage upload failures trigger draft cleanup
 *   - post_photos INSERT failures trigger storage+draft cleanup
 *   - publish_post RPC failures trigger storage+draft cleanup
 *   - Cleanup is best-effort: a failing draft DELETE does not override the original error
 *
 * No module import reassignment. All mocking is via createCloud(client) factory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloud } from '../cloud.js';

// ─── UUID validation helper ───────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = v => UUID_RE.test(v);

// ─── Mock builder ─────────────────────────────────────────────────────────────

const USER = { id: 'user-uuid-1111' };

/**
 * Build a mock Supabase client.
 *
 * @param {object} opts
 *   insertDraftError    – if set, posts INSERT returns this error
 *   insertPhotosError   – if set, post_photos INSERT returns this error
 *   storageUploadError  – if set, storage.upload returns this error on the first call
 *   publishRpcError     – if set, publish_post RPC returns this error
 *   insertPayloads      – array populated with every INSERT payload sent
 *   removedPaths        – array populated whenever storage.remove is called
 *   deletedDraftIds     – array populated whenever posts DELETE is called
 */
function buildClient({
  insertDraftError = null,
  insertPhotosError = null,
  storageUploadError = null,
  publishRpcError = null,
  insertPayloads = [],
  removedPaths = [],
  deletedDraftIds = [],
} = {}) {
  let photoInsertCalls = 0;

  const buildQuery = (table) => {
    const q = {
      _table: table,
      insert: (payload) => { q._payload = payload; q._op = 'insert'; return q; },
      update: (payload) => { q._payload = payload; q._op = 'update'; return q; },
      delete: () => { q._op = 'delete'; return q; },
      select: () => q,
      eq: (col, val) => { if (!q._eq) q._eq = []; q._eq.push({ col, val }); return q; },
      single: () => q,
      maybeSingle: () => q,
      then: (resolve, reject) => Promise.resolve(q._resolve()).then(resolve, reject),
      _resolve() {
        if (table === 'posts') {
          if (q._op === 'insert') {
            insertPayloads.push({ ...q._payload });
            if (insertDraftError) return { data: null, error: insertDraftError };
            // No RETURNING — real Supabase returns null data with 204
            return { data: null, error: null };
          }
          if (q._op === 'delete') {
            const idFilter = (q._eq || []).find(e => e.col === 'id');
            if (idFilter) deletedDraftIds.push(idFilter.val);
            return { data: null, error: null };
          }
        }
        if (table === 'post_photos') {
          if (q._op === 'insert') {
            photoInsertCalls++;
            if (insertPhotosError) return { data: null, error: insertPhotosError };
            return { data: null, error: null };
          }
        }
        return { data: null, error: null };
      },
    };
    return q;
  };

  return {
    auth: { getUser: async () => ({ data: { user: USER }, error: null }) },
    from: (table) => buildQuery(table),
    storage: {
      from: (_bucket) => ({
        upload: async (path, _file, _opts) => {
          if (storageUploadError) return { data: null, error: storageUploadError };
          return { data: { path }, error: null };
        },
        remove: async (paths) => {
          for (const p of paths) removedPaths.push(p);
          return { data: paths, error: null };
        },
      }),
    },
    rpc: async (name, args) => {
      if (name === 'publish_post') {
        if (publishRpcError) return { data: null, error: publishRpcError };
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    functions: { invoke: async () => ({ data: {}, error: null }) },
  };
}

const fakePhoto = () => new Blob(['jpeg-data'], { type: 'image/jpeg' });

// ─── UUID generation tests ────────────────────────────────────────────────────

test('post: draft id is a valid v4 UUID generated locally before the INSERT', async () => {
  const insertPayloads = [];
  const client = buildClient({ insertPayloads });
  const api = createCloud(client);

  await api.createPost('sober', 'No alcohol today', []);

  assert.equal(insertPayloads.length, 1, 'exactly one INSERT payload for the draft');
  const payload = insertPayloads[0];
  assert.ok('id' in payload, 'INSERT payload must include an explicit id field');
  assert.ok(isUUID(payload.id), `id "${payload.id}" must be a valid v4 UUID`);
});

test('post: each createPost call generates a distinct UUID', async () => {
  const insertPayloads = [];
  const client = buildClient({ insertPayloads });
  const api = createCloud(client);

  await api.createPost('sober', 'Day one', []);
  await api.createPost('drank', 'Celebration', []);

  assert.equal(insertPayloads.length, 2);
  assert.notEqual(insertPayloads[0].id, insertPayloads[1].id, 'each call must produce a unique UUID');
});

test('post: INSERT payload contains correct author_id, kind, reason, status', async () => {
  const insertPayloads = [];
  const client = buildClient({ insertPayloads });
  const api = createCloud(client);

  await api.createPost('drank', 'A special occasion', []);

  const p = insertPayloads[0];
  assert.equal(p.author_id, USER.id, 'author_id must match the authenticated user id');
  assert.equal(p.kind, 'drank');
  assert.equal(p.reason, 'A special occasion');
  assert.equal(p.status, 'draft');
  assert.equal(p.published_at, undefined, 'published_at must not be sent in the INSERT');
});

test('post: INSERT has no .select() — data is null on success (no RETURNING clause)', async () => {
  // The run() helper returns data (null) when there is no error.
  // We verify createPost does not throw when data is null.
  const client = buildClient();
  const api = createCloud(client);

  // Should not throw even though data from INSERT is null
  const result = await api.createPost('sober', 'Quiet evening', []);
  assert.ok(result, 'createPost must return a draft object');
  assert.ok(isUUID(result.id), 'returned draft.id must be the locally-generated UUID');
});

// ─── Storage path consistency tests ──────────────────────────────────────────

test('post: storage paths use the same locally-generated UUID as the draft id', async () => {
  const insertPayloads = [];
  const removedPaths = [];
  // Simulate RPC failure so we can see which paths were uploaded then removed
  const client = buildClient({ insertPayloads, removedPaths, publishRpcError: { message: 'RPC failed' } });
  const api = createCloud(client);

  await assert.rejects(() => api.createPost('drank', 'Testing paths', [fakePhoto(), fakePhoto()]));

  const draftId = insertPayloads[0].id;
  assert.ok(isUUID(draftId));

  assert.equal(removedPaths.length, 2, 'both uploaded paths must be removed on RPC failure');
  for (const p of removedPaths) {
    assert.ok(
      p.startsWith(`${USER.id}/${draftId}/`),
      `storage path "${p}" must use user id and draft UUID: ${USER.id}/${draftId}/`
    );
  }
});

test('post: publish_post RPC receives the same UUID that was inserted', async () => {
  const insertPayloads = [];
  const rpcArgs = [];
  const client = buildClient({ insertPayloads });
  // Intercept the rpc call to capture args
  const origRpc = client.rpc.bind(client);
  client.rpc = async (name, args) => { rpcArgs.push({ name, args }); return origRpc(name, args); };

  const api = createCloud(client);
  await api.createPost('sober', 'Checking RPC arg', []);

  const draftId = insertPayloads[0].id;
  const publishCall = rpcArgs.find(r => r.name === 'publish_post');
  assert.ok(publishCall, 'publish_post RPC must be called');
  assert.equal(publishCall.args.p_post_id, draftId, 'RPC must receive the locally-generated draft UUID');
});

// ─── Success path tests ───────────────────────────────────────────────────────

test('post: successful publish (no photos) returns draft object and does not throw', async () => {
  const client = buildClient();
  const api = createCloud(client);

  const result = await api.createPost('sober', 'Just felt like it', []);
  assert.ok(result && typeof result === 'object', 'must return a draft object');
  assert.ok(isUUID(result.id), 'draft.id must be a UUID');
});

test('post: successful publish with photos returns draft and does not throw', async () => {
  const insertPayloads = [];
  const client = buildClient({ insertPayloads });
  const api = createCloud(client);

  const result = await api.createPost('drank', 'Had fun', [fakePhoto(), fakePhoto()]);
  assert.ok(isUUID(result.id));
  // Locally-generated UUID should match what was inserted
  assert.equal(result.id, insertPayloads[0].id);
});

// ─── Failure propagation and cleanup tests ────────────────────────────────────

test('post: draft INSERT failure propagates; no cleanup attempted (no draft exists yet)', async () => {
  const insertPayloads = [];
  const removedPaths = [];
  const deletedDraftIds = [];
  const client = buildClient({
    insertDraftError: { message: 'new row violates row-level security policy for table "posts"' },
    insertPayloads, removedPaths, deletedDraftIds,
  });
  const api = createCloud(client);

  await assert.rejects(
    () => api.createPost('drank', 'test', [fakePhoto()]),
    err => { assert.match(err.message, /row-level security/); return true; },
    'INSERT error must propagate'
  );

  assert.equal(removedPaths.length, 0, 'no storage files exist to remove');
  assert.equal(deletedDraftIds.length, 0, 'no draft row exists to delete');
});

test('post: storage upload failure triggers draft cleanup using the pre-generated UUID', async () => {
  const insertPayloads = [];
  const removedPaths = [];
  const deletedDraftIds = [];
  const client = buildClient({
    storageUploadError: { message: 'Bucket not found' },
    insertPayloads, removedPaths, deletedDraftIds,
  });
  const api = createCloud(client);

  await assert.rejects(
    () => api.createPost('drank', 'test', [fakePhoto()]),
    err => { assert.match(err.message, /Bucket not found/); return true; }
  );

  // Upload failed before any path was pushed — no paths to remove
  assert.equal(removedPaths.length, 0, 'upload failed before any file was stored');
  // But the draft INSERT succeeded, so DELETE must be attempted with the correct UUID
  assert.equal(deletedDraftIds.length, 1, 'draft must be cleaned up');
  const draftId = insertPayloads[0].id;
  assert.ok(isUUID(draftId));
  assert.equal(deletedDraftIds[0], draftId, 'deleted ID must match the locally-generated draft UUID');
});

test('post: post_photos INSERT failure triggers storage and draft cleanup', async () => {
  const insertPayloads = [];
  const removedPaths = [];
  const deletedDraftIds = [];
  const client = buildClient({
    insertPhotosError: { message: 'RLS violation on post_photos' },
    insertPayloads, removedPaths, deletedDraftIds,
  });
  const api = createCloud(client);

  await assert.rejects(
    () => api.createPost('drank', 'test reason', [fakePhoto()]),
    err => { assert.match(err.message, /RLS violation/); return true; }
  );

  const draftId = insertPayloads[0].id;
  assert.ok(isUUID(draftId));

  assert.equal(removedPaths.length, 1, 'the one uploaded file must be removed');
  assert.ok(
    removedPaths[0].startsWith(`${USER.id}/${draftId}/`),
    `removed path must use user id and draft UUID`
  );
  assert.equal(deletedDraftIds.length, 1, 'draft must be deleted');
  assert.equal(deletedDraftIds[0], draftId);
});

test('post: publish_post RPC failure triggers cleanup of all uploaded files and draft', async () => {
  const insertPayloads = [];
  const removedPaths = [];
  const deletedDraftIds = [];
  const client = buildClient({
    publishRpcError: { message: 'Draft not found' },
    insertPayloads, removedPaths, deletedDraftIds,
  });
  const api = createCloud(client);

  await assert.rejects(
    () => api.createPost('drank', 'test reason', [fakePhoto(), fakePhoto()]),
    err => { assert.match(err.message, /Draft not found/); return true; }
  );

  const draftId = insertPayloads[0].id;
  assert.ok(isUUID(draftId));
  assert.equal(removedPaths.length, 2, 'both uploaded files must be removed');
  assert.equal(deletedDraftIds.length, 1);
  assert.equal(deletedDraftIds[0], draftId);
});

test('post: RLS-style error from publish_post RPC propagates and triggers cleanup', async () => {
  const insertPayloads = [];
  const removedPaths = [];
  const deletedDraftIds = [];
  const client = buildClient({
    publishRpcError: { message: 'new row violates row-level security policy for table "posts"' },
    insertPayloads, removedPaths, deletedDraftIds,
  });
  const api = createCloud(client);

  await assert.rejects(
    () => api.createPost('sober', 'A reason here', []),
    err => { assert.match(err.message, /row-level security/); return true; }
  );

  const draftId = insertPayloads[0].id;
  assert.ok(isUUID(draftId));
  assert.equal(removedPaths.length, 0, 'no photos were uploaded for a sober post with no files');
  assert.equal(deletedDraftIds.length, 1, 'draft must still be cleaned up');
  assert.equal(deletedDraftIds[0], draftId);
});

test('post: createPost cleanup is best-effort — draft DELETE failure does not override original error', async () => {
  const insertPayloads = [];
  const client = buildClient({
    publishRpcError: { message: 'Photo verification failed' },
    insertPayloads,
  });

  // Make the draft DELETE fail
  const origFrom = client.from.bind(client);
  client.from = (table) => {
    const q = origFrom(table);
    if (table === 'posts' && q._op === undefined) {
      // Wrap delete() to always return an error
      const origDelete = q.delete.bind(q);
      q.delete = () => {
        const dq = origDelete();
        dq._resolve = () => ({ data: null, error: { message: 'cannot delete' } });
        return dq;
      };
    }
    return q;
  };

  const api = createCloud(client);

  await assert.rejects(
    () => api.createPost('sober', 'cleanup resilience test', []),
    err => {
      assert.match(err.message, /Photo verification failed/,
        'original error must propagate even if cleanup DELETE fails');
      return true;
    }
  );
});
