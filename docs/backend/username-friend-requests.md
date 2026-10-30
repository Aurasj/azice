# Add Friend by Username

> **Current reading note:** Username requests and their migration are already deployed. Do not reapply the migration or redeploy backend services during this refactor.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


Migration: `supabase/migrations/20261023210942_add_friend_by_username.sql`. The operator reports that it has been applied to production and `public.send_username_friend_request(text)` was verified to exist. No remote SQL was executed during that review; the reviewed migration remains unchanged.

The Friends screen adds one labelled input and native Add submit button. Exact lowercase usernames may have one optional leading `@`; surrounding whitespace is trimmed. There is no search result, preview or availability query. Incoming requests remain first. Existing invite links, comment discovery, Back navigation and request actions are unchanged. Demo mode explains that real requests require Supabase.

## Authorization and privacy

`public.send_username_friend_request(text)` is executable only by `authenticated`, requires `auth.uid()` and an existing profile, and returns a scalar status only. It never returns target IDs, email, bio, avatars or profile rows. It uses the existing unique username index, exact equality and existing private `azice_private.create_friend_request(uuid,uuid)` helper. No public UUID request API is introduced. Knowing an exact username becomes an explicit request capability; access to a qualifying comment or invitation token is not required for this new flow. Existing invitation/comment authorization remains unchanged.

The function is SECURITY DEFINER with an empty search path, installed as the existing reviewed helper owner with BYPASSRLS; browser roles must not inherit that owner. Only the new function/table default ACLs are cleared, including custom-role defaults. The existing private schema, profile/Storage policies, helper ACLs, Web Push objects and scheduler are untouched. The private counter table has RLS and no browser policies or grants.

One private counter per profile allows **10 total username attempts per account per one-hour window**, beginning at its first attempt. Misses, malformed input, self, duplicate and successful submissions count. Blocked attempts perform no target lookup. Returning statuses rather than raising on misses preserves the counter transaction. The helper's existing overall 30 outgoing requests/hour quota still applies across request mechanisms. Counter rows cascade on account deletion; they store no attempted usernames and need no purge job.

Sender and unordered pair advisory transaction locks use the existing helper's keys, serializing concurrent username/invitation/comment submissions. Pending requests in either direction return `pending` without accepting, replacing or inserting a second request. A profile key-share lock protects target resolution against concurrent deletion/username changes. Successful helper inserts automatically use the existing friend-request push trigger; no new push implementation is added. Unexpected helper errors return a generic `unavailable` status without private error detail, while the attempt counter remains committed.

Statuses: `sent`, `not_found`, `pending`, `friends`, `self`, `invalid`, `rate_limited`, `unavailable`. UI copy includes “Friend request sent!”, “User not found.”, “Request already sent.” and “You're already friends.” For an incoming pending request, users retain the existing Accept/Decline actions at the top of Friends.

Exact-name existence is intentionally distinguishable, as required by “User not found.” This is bounded authenticated discovery, not a directory. The per-account limit does not prevent distributed guessing across many independently created accounts. There is no block-list table/rule in the inspected schema; existing request rules are reused without inventing a blocking feature.

## Review and rollout — operator only

1. Review the complete new migration and test against the existing migration chain in isolated staging. It requires the deployed comment-discovery private helper. Do not edit/reapply earlier migrations or the original schema.
2. Production already has this migration; do not reapply it. For a fresh staging environment only, apply **only this migration**, once, transactionally as the existing helper owner. Confirm `authenticated` can execute the new RPC, anon cannot, and neither can read the counter table or unrelated private profiles. No Edge Functions, secrets, Cron, push preferences or Storage changes are needed.
3. Publish the frontend last. On test accounts, add an exact username and `@username`, verify one incoming request and normal push eligibility, repeat in both directions, accept and repeat, try self/missing/partial names and test the attempt cap. Confirm invite links and comment requests still work. Refresh on the other account uses the existing request refresh behavior; no new realtime channel is added.
4. To disable the feature, remove the frontend form and revoke EXECUTE on the exact new RPC in a separately reviewed forward migration. Drop only that function and its new counter table if permanent removal is desired. Do not delete real friend requests, relationships or push receipts.

## Local verification

Run `node --test tests/*.test.mjs`, `node scripts/test-username-friends-postgres.mjs`, the existing Push/Activity PostgreSQL runners, JavaScript syntax checks and `node scripts/build.mjs`.

The focused PostgreSQL runner uses actual PostgreSQL in disposable PGlite with the existing discovery, Web Push, Activity and 24/7 migrations. It covers exact matching, private-profile denial, anonymous/profile requirements, hostile default grants, deduplication/opposite requests, unchanged push creation, self/invalid/UUID input, committed miss throttling/window reset, existing send quota, invitation/comment compatibility and deletion cleanup. It is not a hosted Supabase or native multi-session concurrency test. No real-device or live end-to-end friend-request verification has been performed for this feature.

Local results: 240 JavaScript tests passed; 31 JavaScript syntax checks and both existing Edge TypeScript syntax transpilation checks passed; production build and whitespace checks passed. PostgreSQL runs passed 7 new username groups plus the existing 6 24/7 Push, 16 historical Push and 10 Activity groups (39 total). Chrome emulation passed 14 layout checks at each of 320×740, 390×844, 844×390, 320×480 and 1280×800, including the visible username label, safe edges and 44px tap targets. Physical iPhone/Android and real push delivery were not tested for this feature.
