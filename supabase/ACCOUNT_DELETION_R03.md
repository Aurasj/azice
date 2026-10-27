# R03 account-deletion concurrency investigation (local, 2026-10-27)

Current release decision: the owner has stopped further R03 integration testing
for BETA v0.1.1.0. No Docker/VM/project work is authorized by this document.
R03 remains an unresolved concurrency risk; physical Storage leakage is not
confirmed. The earlier investigation/release-blocker recommendation below is
retained as historical evidence, not a claim that a production leak occurred or
that a fix was implemented. The owner explicitly accepted this residual risk for
the beta; the limits in R03_LOCAL_INTEGRATION_ATTEMPT.md still apply. Historical v0.1.0.3
references describe prior runs; the current local release is v0.1.1.0.

## Decision and scope

**R03 remains open and should block sign-off on reliable personal-data erasure.**
Native PostgreSQL reproduces gaps in the application's Storage authorization and
its interaction with deletion. Mocked execution of the actual Edge handler
reproduces the final-check gap. Neither is a real hosted Storage/Auth test, and
neither establishes that a production physical blob has been orphaned.

No production code or SQL is changed by this investigation. A reliable minimal
production correction is not yet established: it must coordinate Storage write
authorization/finalization with deletion, not just issue another list request.
Adding a profile-exists predicate, revoking refresh sessions, banning an account,
or adding a final list alone would not prove safety for already-authorized writes.
Do not represent the characterization tests as a security fix.

F01–F07, R02, both stabilization migrations and APP_VERSION 0.1.0.3 are preserved.
The only R03 additions are this document and two opt-in/characterization test files.
No secrets, credentials, deployment, schema changes or remote calls to an AziCe?
project are involved. Public documentation/source reads are listed below.

## Exact current deletion lifecycle

1. `app.js` requires two in-app confirmations, disables that tab's Delete Account
   button and calls `api.deleteAccount()`. This does not pause other tabs or
   requests already executing on a server.
2. `cloud.js` invokes `delete-account` using the normal authenticated client.
   Function errors and JSON errors propagate. Only success triggers best-effort
   sign-out, UI account reset and the success toast. Failure keeps the account
   available to retry. Auth state broadcasts may help tabs react after success;
   they are not a server-side exclusion mechanism.
3. The Edge Function checks configuration and verifies the Bearer user with
   `auth.getUser()`. Caller-supplied body IDs are unused. Privileged credentials
   remain server-side. OPTIONS returns before authentication as a CORS preflight.
4. A privileged client lists `post-images/<verified-user-id>`, collecting every
   page (100) and expanding one post-folder level. Unexpected deeper nesting fails
   closed. It enumerates before removing so its own deletes do not shift OFFSET
   pages. Concurrent changes can still affect that enumeration.
5. It removes those files via the official Storage API, in batches of 100. A
   returned removal error or thrown exception stops processing before Auth.
6. It similarly lists/removes `avatars/<user-id>`; unexpected subfolders fail.
   Paths, rather than owner metadata alone, identify all app-owned file versions
   in these two namespaces, including older avatars and unpublished photos.
7. It re-lists both root namespaces and rejects nonempty results. These are separate
   HTTP calls/snapshots, not a transaction or a reservation preventing new files.
8. It calls `auth.admin.deleteUser(user.id)` (hard deletion by SDK default). Auth
   errors return 500, even if some/all files have already been removed. Success
   returns 200 claiming account, files and database records permanently deleted.
9. `profiles.id -> auth.users.id ON DELETE CASCADE` and dependent foreign keys
   remove application profiles, posts/photos, comments/reactions, invitations,
   friendships/requests, Activity, preferences, push state, username counters and
   posting usage. Storage bytes are NOT covered by these application cascades.

Partial deletion is not atomic across services. A list/remove/Auth error can leave
an active account with missing photos while its post/profile paths still exist.
That is existing fail-closed behavior, not a restored/rolled-back photo state.
Retries while the identity exists enumerate what remains and can finish cleanup.
If Auth succeeds but a late object survives, the deleted identity cannot normally
retry `delete-account` through `getUser()`. Administrative cleanup by recorded UUID
and object prefix would be needed. A lost success response also makes ordinary
retry authentication ambiguous; do not assume a network error means no deletion.

## Authorization and concurrent operations

- Post drafts, photo metadata, comments, reactions, preferences and friend requests
  have profile/post foreign keys. Real insert/delete contention serializes through
  PostgreSQL FK/row locks: insertion commits first and cascades, or deletion commits
  first and insertion is rejected. Rollback restores relational data atomically.
  Concurrent updates cannot recreate a deleted row; profile onboarding is also
  blocked by its Auth FK. This is not a guarantee about external bytes.
- `post_image_insert` checks the JWT sub/path and an owned draft using EXISTS.
  That read does not hold a foreign-key lock from Storage to the draft/profile.
  An authorized metadata insertion can stay uncommitted while Auth and the draft
  are deleted, then commit. A fresh insertion after deletion fails the draft check.
  Existing post-image DELETE/SELECT policies require the vanished draft/metadata,
  so the former client cannot use its normal cleanup path for this orphan.
- `avatar_insert` checks only bucket and first path component = `auth.uid()`.
  There is no existing-profile/session check. In native RLS tests a stale sub can
  insert after deleting Auth/profile, and its own avatar SELECT still permits a
  read. Another user cannot insert into this namespace. This requires a previously
  valid identity/token, not knowledge of an arbitrary UUID. Real JWT verification
  and Storage request admission were not executed here.
- `saveAvatar()` uploads a random JPEG before updating `profiles.avatar_path`.
  A concurrent account deletion can remove that profile before the update; an
  update matching zero rows does not necessarily yield an SDK error. Frontend
  account-generation guards protect rendering, not remote write finalization.
- A post upload begun before cleanup, a new avatar, a new draft/photo, post
  publication, or a second deletion can interleave with listing/removal. No
  deletion marker or cross-service write barrier currently exists in app SQL.
  F03 recovery preserves ordinary failed-upload recovery while the draft exists;
  it cannot restore a draft already removed by Auth cascade.

## Executed reproductions and evidence boundaries

`scripts/test-account-deletion-native-postgres.mjs` uses native PostgreSQL 15.18,
independent sessions and actual authenticated-role RLS, with synthetic Auth users
and a minimal Storage catalog. It applies the existing migration chain including
F02 then F06, only in a newly created disposable database. Nine groups verify:

1. Deletion waits for an in-flight draft insert; committing it then cascades it.
2. Deletion first blocks a competing draft insert, which fails FK validation;
   recreating the profile after Auth deletion is also rejected.
3. Deletion rollback restores public data; commit cascades tested relational
   Activity/comments/reactions/preferences/usage. Existing suites separately cover
   push-state, friendship and invitation cleanup.
4. A post-image catalog INSERT authorized before deletion commits after deletion
   and leaves a row; normal client DELETE cannot remove it. Fresh upload denied.
5. An in-flight comment on a surviving friend's post is removed with its author,
   including the generated Activity event; the friend's post remains.
6. The avatar policy accepts an INSERT after deleting Auth with the same synthetic
   JWT sub; another user's attempt is denied. Own-avatar SELECT remains possible.
7. An explicitly modeled test-only Auth owner-existence guard rejects a committed
   owned object; rollback keeps public rows and cleaned retry succeeds.
8. That simple modeled guard cannot see another transaction's uncommitted object;
   deletion succeeds and the metadata insertion subsequently commits.
9. Rolling back the upload leaves no catalog row; late ordinary writes are denied.

The test-only ownership guard is NOT a copy of Supabase's managed implementation.
No assertion is made about its hosted locking, triggers or exact error codes.
The minimal Storage fixture has no owner FK, consistent with the linked upstream
owner-FK removal migration. Additional hosted protections may exist. SQL catalog
deletes in tests are synthetic fixture operations, never a blob-cleanup technique.

`tests/account-deletion-races.test.mjs` runs the actual stripped Edge handler in a
Node VM with mocked Auth/Storage, no network. Eight tests exercise pagination and
batches, success ordering, returned and thrown partial remove failures with retry,
listing/no-op removal failure, arrivals before final verification, arrivals after
the final check/before or after Auth success, Auth failure/retry and invalid caller.
The mock allows Auth success after an object arrives to expose the handler's
contract gap; it deliberately does not prove hosted Auth would allow that state.

## Supabase-managed protections and unresolved integration

Official Auth documentation says deletion rejects users owning Storage objects,
and also says already-issued access JWTs remain valid until expiry. Refresh tokens
are removed by hard deletion. The owner check may protect against a committed
object arriving before Auth deletion, but its existence alone is not evidence of
serialization with an in-flight upload or rejection of a later JWT-authenticated
upload. No production metadata or managed implementation was inspected.

There is no available local Supabase Auth/Storage stack, Docker CLI, Deno runtime
or explicitly supplied disposable hosted Storage project. No software was installed
and no external service was started. Only the previously approved, marked,
loopback PostgreSQL cluster was used and stopped again. Thus physical uploads
starting before deletion and finishing during/after it, actual owner-guard behavior,
provider retries and removal of physical bytes remain UNVERIFIED.

Relevant primary references (read-only review on 2026-10-27):

- [Supabase user deletion and outstanding tokens](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)
- [Storage ownership: owner_id and JWT sub](https://supabase.com/docs/guides/storage/security/ownership)
- [Storage metadata is separate from physical objects](https://supabase.com/docs/guides/storage/schema/design)
- [Upstream removal of Storage object owner FK](https://github.com/supabase/storage/blob/master/migrations/tenant/0017-drop-owner-foreign-key.sql)
- [Upstream owner_id text column](https://github.com/supabase/storage/blob/master/migrations/tenant/0018-add_owner_id_column_deprecate_owner.sql)

The public changelog was checked; the TLS cipher and PostgreSQL maintenance notices
do not establish a deletion fix. Native 15.18 is not claimed to match production.

## Release decision and safe next steps

Do not close R03 or claim complete concurrent erasure from these tests. Treat it
as a release blocker for that privacy guarantee until isolated service integration
demonstrates protection or a reviewed correction closes it. No migration or Edge
deployment is supplied/required to publish these investigation files themselves.

1. Provision/approve an explicitly disposable Supabase Auth/Storage environment
   separately; never point destructive tests at production. Record managed
   versions, relevant ownership guards and object/session enforcement read-only.
2. Apply the reviewed app schema/migrations to that NEW environment. Create two
   synthetic users and confirm the baseline delete path using official APIs.
3. Use two independent authenticated clients for the same synthetic account.
   Barrier-control a real upload before request authorization, during byte transfer,
   before Storage finalization, after each namespace's final list, and after Auth
   deletion. Exercise avatar and draft post-image paths separately. Browser-only
   throttling is insufficient to prove which server phase was blocked; use local
   service instrumentation or an approved staging proxy/test hook.
4. Inject a failed/partial remove, list failure and Auth failure in this isolated
   setup. Verify failure never reports success, retains retry identity where
   intended, and a retry removes remaining bytes without affecting another user.
5. Test the issued JWT directly against Storage after deletion; do not rely on the
   UI broadcasting sign-out. Check official Storage list/download and privileged
   metadata inventory after releasing every pending upload. Confirm physical blob
   deletion through supported service/provider tooling, not SQL row deletion.
6. If the race survives, review a narrow server-enforced write/deletion exclusion
   mechanism that covers all app upload paths and in-flight Storage finalization.
   A marker alone is insufficient without transaction/lock and service-finalization
   analysis. Validate failed deletion retries and ordinary uploads before proposing
   a forward-only migration and coordinated Edge change. Do not ban/sign out first
   and strand users who still need to retry cleanup.
7. Only after that review, follow separately approved backend-first deployment.
   There is currently no R03 production fix to deploy. Existing R02's future
   delete-account SDK-pin deployment remains a separate reviewed change.

Backups, service audit logs and data already downloaded into clients have separate
retention semantics; this investigation does not assert erasure from those systems.

## Reproduction and verification

Use the safe cluster setup/stop procedure in `NATIVE_POSTGRES_TESTS.md`, with the
existing downloaded binaries/driver and disposable marker. Then run:

```powershell
$env:AZICE_TEST_PG_MODULE = 'C:/Users/theli/AppData/Local/Temp/azice-pg-driver/node_modules/pg/lib/index.js'
$env:AZICE_TEST_PG_PORT = '55439'
node scripts/test-account-deletion-native-postgres.mjs
node --test tests/account-deletion-races.test.mjs
```

The native runner refuses a non-loopback or unmarked cluster, accepts no remote
database URL, and creates/drops only a fresh PID/timestamp-named database. It never
resets an existing application database. Known-exposure tests intentionally pass
when the current gap is reproduced; change their expectations when R03 is fixed.

Final local verification passed: **361 JavaScript tests, no skips** (including
eight new mocked handler tests and the real pinned SDK bundle with synthetic
transport), **97 PGlite groups**, **33 native PostgreSQL groups/checks** (nine R03,
16 comment-discovery/F07, eight stabilization/F02/F06/concurrency), **46 JavaScript
syntax checks**, syntax transpilation of all three Edge Functions, production
build and whitespace checks. Test databases were removed and the disposable
PostgreSQL server stopped. Native Deno and real Auth/Storage integration were not
run. No production file changes, new migration, commit or deployment resulted.
