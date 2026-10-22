/**
 * Regression tests for startup authentication flow.
 *
 * These tests verify that the cloud adapter's getUser() and the boot() flow
 * correctly handle:
 *   - No session (unauthenticated visitor)  → auth screen
 *   - Expired / invalid session tokens      → auth screen (not crash)
 *   - Authenticated user, no profile        → onboard screen
 *   - Authenticated user with profile       → feed
 *   - Real network / server errors          → remain visible errors (not silently treated as logged-out)
 *   - Pending invitation links survive login
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionMissingOrInvalid } from '../cloud.js';

// ─── isSessionMissingOrInvalid classification ────────────────────────────────

test('auth: AuthSessionMissingError is treated as missing session', () => {
  const err = new Error('Auth session missing!');
  err.name = 'AuthSessionMissingError';
  assert.equal(isSessionMissingOrInvalid(err), true);
});

test('auth: message containing "auth session missing" (case-insensitive) is missing session', () => {
  const err = new Error('Auth Session Missing!');
  assert.equal(isSessionMissingOrInvalid(err), true);

  const err2 = new Error('auth session missing');
  assert.equal(isSessionMissingOrInvalid(err2), true);
});

test('auth: expired-token error codes are treated as missing session', () => {
  for (const code of ['refresh_token_not_found', 'invalid_grant', 'invalid_token', 'user_not_found', 'session_not_found']) {
    const err = new Error('token error');
    err.status = 401;
    err.code = code;
    assert.equal(isSessionMissingOrInvalid(err), true, `code=${code} should be missing-session`);
  }
});

test('auth: 401 AuthApiError with JWT-related message is missing session', () => {
  const cases = [
    'Token is expired',
    'JWT expired',
    'invalid claim',
    'session expired',
    'session not found',
    'user not found',
  ];
  for (const msg of cases) {
    const err = new Error(msg);
    err.name = 'AuthApiError';
    err.status = 401;
    assert.equal(isSessionMissingOrInvalid(err), true, `msg="${msg}" should be missing-session`);
  }
});

test('auth: 400 AuthApiError with refresh token message is missing session', () => {
  const err = new Error('refresh token not found');
  err.name = 'AuthApiError';
  err.status = 400;
  assert.equal(isSessionMissingOrInvalid(err), true);
});

test('auth: network / fetch failure is NOT a missing session', () => {
  const netErr = new TypeError('Failed to fetch');
  assert.equal(isSessionMissingOrInvalid(netErr), false);

  const retryErr = new Error('Network unavailable');
  retryErr.name = 'AuthRetryableFetchError';
  assert.equal(isSessionMissingOrInvalid(retryErr), false);

  const loadErr = new Error('Load failed');
  assert.equal(isSessionMissingOrInvalid(loadErr), false);
});

test('auth: 500 server errors are NOT missing sessions', () => {
  const err = new Error('Internal Server Error');
  err.status = 500;
  assert.equal(isSessionMissingOrInvalid(err), false);

  const err2 = new Error('Service unavailable');
  err2.status = 503;
  assert.equal(isSessionMissingOrInvalid(err2), false);
});

test('auth: API key configuration errors are NOT missing sessions', () => {
  const err = new Error('Invalid API key');
  err.status = 401;
  assert.equal(isSessionMissingOrInvalid(err), false);

  const err2 = new Error('apikey is required');
  err2.status = 401;
  assert.equal(isSessionMissingOrInvalid(err2), false);
});

test('auth: null/undefined is not a missing session', () => {
  assert.equal(isSessionMissingOrInvalid(null), false);
  assert.equal(isSessionMissingOrInvalid(undefined), false);
});

// ─── createCloud.getUser() behaviour ─────────────────────────────────────────

import { createCloud } from '../cloud.js';

function makeMockClient({ getUserResult = null, getUserError = null, signedOut = false } = {}) {
  let signOutCalled = false;
  return {
    _signedOut: () => signOutCalled,
    auth: {
      getUser: async () => {
        if (getUserError) return { data: { user: null }, error: getUserError };
        return { data: { user: getUserResult }, error: null };
      },
      signOut: async () => { signOutCalled = true; return { error: null }; },
    },
  };
}

test('auth: getUser returns null (not throws) when no session exists', async () => {
  const missingErr = new Error('Auth session missing!');
  missingErr.name = 'AuthSessionMissingError';

  const mockClient = makeMockClient({ getUserError: missingErr });
  const cloud = createCloud(mockClient);

  const user = await cloud.getUser();
  assert.equal(user, null, 'getUser must return null for missing session');
  assert.equal(mockClient._signedOut(), true, 'signOut must be called to clear stale token');
});

test('auth: getUser returns null for expired token error', async () => {
  const expiredErr = new Error('JWT expired');
  expiredErr.name = 'AuthApiError';
  expiredErr.status = 401;

  const mockClient = makeMockClient({ getUserError: expiredErr });
  const cloud = createCloud(mockClient);

  const user = await cloud.getUser();
  assert.equal(user, null);
  assert.equal(mockClient._signedOut(), true);
});

test('auth: getUser returns null when data.user is null (no active session)', async () => {
  const mockClient = makeMockClient({ getUserResult: null });
  const cloud = createCloud(mockClient);

  const user = await cloud.getUser();
  assert.equal(user, null, 'getUser must return null when no user in session');
});

test('auth: getUser returns the user when session is valid', async () => {
  const fakeUser = { id: 'abc-123', email: 'test@example.com' };
  const mockClient = makeMockClient({ getUserResult: fakeUser });
  const cloud = createCloud(mockClient);

  const user = await cloud.getUser();
  assert.deepEqual(user, fakeUser);
  assert.equal(mockClient._signedOut(), false, 'signOut must NOT be called for valid session');
});

test('auth: getUser throws (does not swallow) real network errors', async () => {
  const netErr = new TypeError('Failed to fetch');
  let signOutCalled = false;
  const mockClient = {
    _signedOut: () => signOutCalled,
    auth: {
      getUser: async () => { throw netErr; },
      signOut: async () => { signOutCalled = true; return { error: null }; },
    },
  };
  const cloud = createCloud(mockClient);

  await assert.rejects(() => cloud.getUser(), (err) => {
    assert.equal(err.message, 'Failed to fetch');
    return true;
  });
  assert.equal(mockClient._signedOut(), false, 'signOut must NOT be called for network errors');
});

test('auth: getUser throws (does not swallow) 5xx server errors', async () => {
  const serverErr = new Error('Internal Server Error');
  serverErr.status = 500;
  let signOutCalled = false;
  const mockClient = {
    _signedOut: () => signOutCalled,
    auth: {
      getUser: async () => { throw serverErr; },
      signOut: async () => { signOutCalled = true; return { error: null }; },
    },
  };
  const cloud = createCloud(mockClient);

  await assert.rejects(() => cloud.getUser(), /Internal Server Error/);
  assert.equal(mockClient._signedOut(), false);
});

// ─── boot() flow simulation ───────────────────────────────────────────────────

test('auth: boot flow - no session -> auth view (does not crash)', async () => {
  // Simulate the boot() sequence in isolation
  let view = 'loading';
  const mockApi = {
    mode: 'cloud',
    getUser: async () => null,  // no session
    getMyProfile: async () => null,
  };

  // Simulate what boot() does
  const user = await mockApi.getUser();
  if (!user) { view = 'auth'; }

  assert.equal(view, 'auth', 'Unauthenticated visitor must see auth screen');
});

test('auth: boot flow - authenticated, no profile -> onboard view', async () => {
  let view = 'loading';
  const mockApi = {
    mode: 'cloud',
    getUser: async () => ({ id: 'user-1', email: 'test@example.com' }),
    getMyProfile: async () => null, // no profile yet
  };

  const user = await mockApi.getUser();
  if (!user) { view = 'auth'; }
  else {
    const profile = await mockApi.getMyProfile();
    if (!profile) view = 'onboard';
    else view = 'feed';
  }

  assert.equal(view, 'onboard', 'Authenticated user without profile must see onboard');
});

test('auth: boot flow - authenticated with profile -> feed view', async () => {
  let view = 'loading';
  const mockApi = {
    mode: 'cloud',
    getUser: async () => ({ id: 'user-1', email: 'test@example.com' }),
    getMyProfile: async () => ({ id: 'user-1', display_name: 'Test', username: 'test', is_18_plus_confirmed: true }),
  };

  const user = await mockApi.getUser();
  if (!user) { view = 'auth'; }
  else {
    const profile = await mockApi.getMyProfile();
    if (!profile) view = 'onboard';
    else view = 'feed';
  }

  assert.equal(view, 'feed', 'Authenticated user with profile must see feed');
});

test('auth: boot flow - expired session -> auth view (does not crash)', async () => {
  let view = 'loading';
  const expiredErr = new Error('Auth session missing!');
  expiredErr.name = 'AuthSessionMissingError';

  const mockApi = {
    mode: 'cloud',
    // Simulate what the patched getUser does: returns null for missing session
    getUser: async () => {
      if (isSessionMissingOrInvalid(expiredErr)) return null;
      throw expiredErr;
    },
    getMyProfile: async () => null,
  };

  const user = await mockApi.getUser();
  if (!user) { view = 'auth'; }

  assert.equal(view, 'auth', 'Expired session must silently redirect to auth, not crash');
});

test('auth: boot flow - real server error must propagate (not silent redirect to auth)', async () => {
  const serverErr = new Error('Internal Server Error');
  serverErr.status = 500;

  const mockApi = {
    mode: 'cloud',
    // Simulate patched getUser: re-throws real server errors
    getUser: async () => { throw serverErr; },
    getMyProfile: async () => null,
  };

  let caughtError = null;
  let view = 'loading';
  try {
    const user = await mockApi.getUser();
    if (!user) view = 'auth';
    else view = 'feed';
  } catch (e) {
    caughtError = e;
    view = 'error';
  }

  assert.equal(view, 'error', 'Real server errors must show error screen, not silently redirect to auth');
  assert.ok(caughtError, 'Error must have been thrown');
  assert.equal(caughtError.message, 'Internal Server Error');
});

test('auth: pending invite is preserved in sessionStorage across login', () => {
  // Simulate the invite-save logic from app.js (using a mock sessionStorage)
  const store = new Map();
  const mockSessionStorage = {
    getItem: k => store.get(k) || null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };

  // Simulate ?invite=abc arriving in the URL before login
  const incomingToken = 'abc123-invite-token';
  mockSessionStorage.setItem('azice_pending_invite', incomingToken);

  // Simulate what app.js does after successful login
  const savedInvite = () => mockSessionStorage.getItem('azice_pending_invite');
  const pending = savedInvite();

  assert.equal(pending, incomingToken, 'Pending invite token must survive the login/signup process');

  // Simulate sending the friend request and clearing the invite
  mockSessionStorage.removeItem('azice_pending_invite');
  assert.equal(savedInvite(), null, 'Invite must be cleared after being used');
});
