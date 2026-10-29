// Independent Auth/recovery utilities. Storage adapters are supplied by the caller.
export const isSessionMissingOrInvalid = err => {
  if (!err) return false;
  if (err.name === 'AuthSessionMissingError') return true;
  if (typeof err.message === 'string' && /auth session missing/i.test(err.message)) return true;

  const missingCodes = ['refresh_token_not_found', 'invalid_grant', 'invalid_token', 'user_not_found', 'session_not_found'];
  if (err.code && missingCodes.includes(err.code)) return true;

  // Real connection, network, or server failures must not be treated as missing sessions
  if (err.name === 'AuthRetryableFetchError' || err.name === 'TypeError') return false;
  if (typeof err.message === 'string' && /failed to fetch|network|load failed/i.test(err.message)) return false;
  if (typeof err.status === 'number' && err.status >= 500) return false;

  // API key configuration errors must remain visible
  if (typeof err.message === 'string' && /api\s*key|apikey/i.test(err.message)) return false;

  if (err.status === 400 || err.status === 401) {
    const msg = String(err.message || '').toLowerCase();
    if (
      msg.includes('refresh token') ||
      msg.includes('jwt') ||
      msg.includes('token is expired') ||
      msg.includes('token expired') ||
      msg.includes('invalid claim') ||
      msg.includes('session expired') ||
      msg.includes('session not found') ||
      msg.includes('user not found') ||
      err.name === 'AuthApiError'
    ) {
      return true;
    }
  }

  return false;
};

// PKCE verifier must survive an email opening a new tab; recovery sessions stay
// tab-local and separate from the ordinary application's session/storage key.
export function createRecoveryStorage(shared,tab){return {
  getItem:key=>(key.endsWith('-code-verifier')?shared:tab).getItem(key),
  setItem:(key,value)=>(key.endsWith('-code-verifier')?shared:tab).setItem(key,value),
  removeItem:key=>(key.endsWith('-code-verifier')?shared:tab).removeItem(key)
};}
