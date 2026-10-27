# Comment-author discovery — existing baseline and historical review

Current release status is recorded in [MIGRATION_STATUS.md](MIGRATION_STATUS.md).
Discovery is an existing production prerequisite in the owner's stabilization
scope; its exact live definition/ledger was not queried during this preparation.
Do not reapply it. The SQL file's historical UNDEPLOYED header and the original
hardening/deployment discussion below describe its earlier review, not pending
SQL for BETA v0.1.1.0. F02 then F06 are already applied and verified for this
release; do not reapply. Applied files remain unchanged; never replay schema.sql.

## Updated SQL and frontend changes

- Add restrictive SELECT guards on `public.profiles` and `storage.objects`. Full profiles
  and avatars require self/confirmed friendship; pending requests alone grant neither.
  Existing policies and `can_view_profile` are preserved, so existing custom checks are
  intersected rather than replaced. The Storage guard is true for non-avatar buckets,
  leaving their existing permissions unchanged. It grants no upload/delete access.
- Keep `comment_author_card(comment_id)` as a narrow projection of ID, display name,
  username, optional permitted avatar, relationship, and own pending-request ID. Even
  when the legacy helper returns true for a pending user, the RPC masks their avatar.
  There is no bio, private metadata, posts, calendar, friend list, or invitation token.
- Add parameterless `pending_friend_request_profiles()` for the other users in the
  caller's current incoming/outgoing pending requests only. It returns exactly ID,
  display name, username, and a self/friend-only avatar path. It is not a UUID lookup
  or global search. `cloud.js` uses it for pending identities; confirmed friends still
  use ordinary profile reads. The demo adapter returns the same minimal projection.
- Keep invitation preview/link generation and the `send_friend_request(text)` signature.
  Both invitation and comment creation delegate to the private helper and share the
  existing hourly quota and pending-pair unique index. Existing outgoing repeats return
  their ID; incoming pending requests reject the reverse send. Existing acceptance,
  decline/cancel, unfriend, and account deletion code is not replaced.

## Authorization and concurrency guarantees

The two comment RPCs require a caller profile and an existing comment on a published
post accepted by `can_view_post`. The recipient is derived from that comment; an
arbitrary target UUID is insufficient. Inaccessible/missing comments use the same
"User unavailable." error. There is no direct-profile fallback if an RPC is unavailable.

For comment-based creation the private helper first takes sender/pair advisory locks,
then SHARE-locks the comment, its post, and (for a non-owned post) the exact friendship
that permits the caller to view the post. It verifies the locked comment author equals
the derived recipient. After taking the pending-request lock it checks authorization
again; a wall-clock check also rejects friend posts that expire during a lock wait.

These row locks conflict with normal DELETE/UPDATE and foreign-key cascade operations,
including the existing `remove_friend` path. No revoker-specific advisory-lock convention
or change to that RPC is required:

- **Revocation wins first:** send waits, then rejects without inserting a request.
- **Send wins first:** revocation waits until the authorized request transaction commits.
  The request is ordered before revocation and can remain pending afterward. This does
  not retroactively invalidate requests that were legitimately created before revocation.
- Post visibility updates and comment deletion have the same ordering. Own published
  history is readable without the friend-history cutoff; friend posts retain 30 days.
  The 48-hour write/reaction window does not prohibit discovery of readable old comments.

Full-profile privacy also has a restrictive RLS guard: adding another permissive SELECT
policy does not restore pending-user bio access. Actual avatar bytes remain subject to
existing Storage rules AND the new restrictive avatar guard. Pending avatars now stay
at the default avatar until friendship is accepted. Self and confirmed friends retain
profile/avatar access; unfriending removes it.

## Ownership, namespaces and privileges

The migration aborts before changes if `azice_private` already exists. It never revokes
ACLs on a pre-existing private schema. It also aborts unless executed as the existing
owner of `send_friend_request(text)` and `profiles`. That role must have Storage
table-owner privileges to add the restrictive avatar policy, EXECUTE on the existing
authorization helpers, and sufficient owner/BYPASSRLS capabilities for the explicit
authorization wrappers. API roles must not inherit it.

The existing invitation function keeps its owner. All new objects are created by that
same checked owner, eliminating the previous helper-owner mismatch. New functions use
empty search paths and schema-qualified application objects. The UUID helper is SECURITY
INVOKER and callable only inside trusted owner-context wrappers; API roles get no private
schema access or helper EXECUTE.

All non-owner default grants are removed from ONLY the newly created schema/functions,
including custom-role default grants. Authenticated receives EXECUTE on the three public
projection/discovery RPCs. The existing invitation endpoint retains its authenticated
interface; PUBLIC/anon EXECUTE is explicitly revoked. Unrelated schemas, functions,
default-privilege definitions, tables, and account-deletion grants are not changed.

## Remaining limits

- Row locks can introduce waits, lock timeouts or deadlocks with concurrent deletion and
  other writes. PostgreSQL aborts a failed transaction; it cannot partially authorize the
  request. The UI safely fails and the user may retry. Transactions should stay short.
- Already returned data or downloaded/cached avatars cannot be recalled. Card reads use
  normal statement snapshots. Authorization is checked at the final send check, not as
  a promise that time-based eligibility remains true forever after it.
- The schema has no block list or permanent unfriend ban. A still-readable shared comment
  can permit re-requesting an unfriended user. Extra deployed block rules or restrictive
  post/comment policies must be reviewed: definer RPCs explicitly use `can_view_post`;
  they do not automatically adopt arbitrary additional post/comment RLS predicates.
- Privileged administrators can bypass RLS. These guarantees concern ordinary API roles,
  not an exposed service key or an administrator intentionally changing grants/helpers.
- Local PostgreSQL tests use fixtures for Supabase auth and Storage metadata. They do not
  exercise hosted JWT verification, PostgREST schema-cache behavior, actual Storage blob
  downloads, or live browser end-to-end behavior. Hosted verification is still required.

## Verification and rerunning locally

**JavaScript:** `node --test tests/*.test.mjs` — 150 tests passed. These include the
frontend dialog tests, cloud transport mocks, demo behavior, and SQL source audits.
They are distinct from PostgreSQL execution.

**Historical PostgreSQL 15.18 run:** `scripts/test-comment-discovery-postgres.mjs` passed 14
integration checks. It executed the migration and SQL regression script, checked exact
owners/default grants and namespace collisions, and used independent sessions to test
both revocation orders for friendships, post visibility and comment deletion, duplicate
sends in both directions, and concurrent invitation/comment quota enforcement. Its SQL
regression assertions also cover pending bio/avatar denial, a competing permissive
profile policy, minimal identities, invitation acceptance, self/friend access, unfriend,
arbitrary IDs, expired/draft posts, and account deletion cascades.

No application dependency was added. PostgreSQL 15.18 and `pg@8.16.3` were downloaded
only into the OS temporary directory for these tests. The test database was created and
removed by the runner. Its baseline fixture was initialized only in a new throwaway
local database, never reapplied to an existing application database.

**F07 correction, 2026-10-27:** the newer migration requires both `avatar_select`
and `post_image_select`. The old runner only created the former, so native replay
failed with `Unexpected Storage SELECT policy set: review avatar authorization`.
The corrected fixture loads the exact post-image SELECT policy from `schema.sql`,
including the bucket, matching `post_photos.path` and `can_view_post()` checks.
It first proves the missing prerequisite fails atomically, then tests that the real
policy permits the readable friend's photo but hides private, expired and draft
targets. No production policy or migration is changed and no USING(true) substitute
is used. The corrected runner passed all **16 native checks**.

The additional `scripts/test-stabilization-native-postgres.mjs` passed **8 native
groups** for F02/F06 migration replay, native RLS/roles, migration rollback, genuinely
overlapping Activity snapshots, and last-slot publishing under READ COMMITTED and
REPEATABLE READ. See [native setup/results](NATIVE_POSTGRES_TESTS.md) for exact commands,
safety requirements and remaining Storage API limitations. This current verification
supersedes earlier checkpoint reports that the native fixture/environment were blocked.

To rerun, obtain approval before starting a server or installing anything. Use only
an isolated local cluster listening on 127.0.0.1:55439, with administrator
`azice_test_owner` and `cluster_name=azice_stabilization_disposable`. Both runners
check the marker and loopback listener before creating roles or a throwaway database.
Reuse an existing compatible `pg` driver outside the application and point at it:

```powershell
$env:AZICE_TEST_PG_MODULE = 'C:/path/to/temporary/node_modules/pg/lib/index.js'
node scripts/test-comment-discovery-postgres.mjs
node scripts/test-stabilization-native-postgres.mjs
```

The runner hardcodes localhost, creates a uniquely named new database, and drops it in
cleanup. It cannot accept a hosted database URL. `AZICE_TEST_PG_PORT` can change the
local port. It requires administrator privileges only on that disposable local server;
do not point it at an ordinary development database or a production tunnel. The local
PostgreSQL server is started/stopped explicitly by the approved operator, not the runner.

Alternatively, against a disposable LOCAL Supabase database with this migration already
applied, run `supabase/tests/comment_discovery.sql` as its postgres owner. That script
uses a transaction and rolls back all fixtures/test helpers/policies:

```powershell
psql "$env:AZICE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/comment_discovery.sql
```

## Exact safe deployment order (only after separate approval)

1. Review the complete revised migration and matching frontend diff. The old unapproved
   SQL file is superseded; do not apply both versions. Snapshot the existing invitation
   function definition/owner/ACL, profile and avatar policies, relevant helpers, default
   grants and role memberships. Confirm the namespace/policy/function names are unused.
2. Verify the intended migration role satisfies the fail-closed owner/Storage prerequisites
   and that deployed post/comment authorization matches the reviewed helper semantics.
   Resolve any custom blocking rules first. Back up the intended AziCe? database.
3. Reproduce the local SQL and multi-session checks, then verify against an approved
   disposable Supabase staging project. No production change is authorized by this work.
4. Use a short controlled rollout window for friendship/request writes. Apply ONLY
   `supabase/migrations/20261023012201_comment_author_discovery.sql` once, as the checked
   trusted owner. Its transaction includes policies, functions, ACLs and a PostgREST
   schema-cache reload notification. Do not rerun `schema.sql` or push unrelated migrations.
5. Verify ordinary authenticated sessions cannot SELECT pending users' profiles/bios or
   download their avatars, while the minimal RPCs work. Confirm new owner/ACL values,
   invitation compatibility and successful schema-cache reload before releasing clients.
6. Immediately release the matching `cloud.js` frontend adapter (database first), then
   reload cached/PWA clients. Older clients may temporarily show Unknown for pending
   names after the privacy guard applies; never restore broad profile reads as a fallback.
7. Complete the three-account checks below, including real avatar downloads before/after
   acceptance and the existing account-deletion flow on a disposable account. Resume
   normal request traffic only after these checks pass. Record the applied migration.

If rollout must be stopped, disable/roll back the discovery UI and revoke the new comment
RPCs as a deliberate owner action. Keep the privacy guards and minimal pending-identity
RPC in place for ordinary friendship management. Reverting those guards to the original
pending-profile behavior would reintroduce the privacy issue and requires a separate
reviewed decision. Requests/friendships already created are not automatically deleted.

## Manual verification with three test accounts

Use three isolated browser profiles/private sessions so account state cannot mix. Use
new test accounts with display names **Test A**, **Test B**, and **Test C**. Keep their
existing unique usernames. Apply the reviewed migration first.

1. Using existing invitation links, connect A-B and B-C and accept both friendships.
   Keep A-C unconnected, with no pending request between them.
2. As C, upload an avatar and publish a post with a recognizable private reason. As B,
   publish a new post. As C, comment `C discovery test` on B's post. As A, add
   `A discovery test` on that same post. Open its comments in A's Feed.
3. As A, activate **Test C** using mouse/touch, then Tab and Enter. Check that the dialog
   shows C's display name and username, a default avatar, **Add Friend**, and **Close**.
   It must contain no bio, private post, calendar, or friend list. Escape and Close must
   dismiss it and return keyboard focus to C's comment-author button. Opening A's own
   comment must offer no friend-request action.
4. Reopen C's card and select **Add Friend**. It must become **Request Sent**. Close and
   reopen it: the status must persist. C must appear under A's outgoing requests and A
   under C's incoming requests. C's private post must still be absent from A's Feed.
   C's avatar must remain the default while pending; direct profile reads must return
   no C row/bio and direct avatar downloads must be denied, despite names remaining
   available in the pending-request lists.
5. As C, open A's comment on B's post. Its card must show **Accept** and **Decline**, not
   Add Friend. Decline once; A's reopened C card must offer Add Friend again. Send from
   A again, then accept as C. Both cards must now show **Friends**. A's ordinary Friends
   list and incoming-request header indicator must update through the existing refreshes.
6. From the ordinary Friends screen remove A-C. While A-B and B-C remain friends, send
   from C via A's comment; A's card must now show incoming **Accept/Decline**. Accept
   once and verify ordinary friendship functionality. Remove A-C again before the
   negative-access checks below; ensure no pending A-C request remains.
7. Verify direct RPC protection in the test sessions using the browser console. In A's
   session, open B's comments and run:

   ```javascript
   const cfg = window.AZICE_CONFIG;
   const probe = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
   const commentC = [...document.querySelectorAll('.comment-author')]
     .find(button => button.textContent === 'Test C').dataset.id;
   const card = (await probe.rpc('comment_author_card', {p_comment_id: commentC})).data[0];
   // A target USER UUID must not substitute for a COMMENT UUID:
   await probe.rpc('send_comment_friend_request', {p_comment_id: card.id});
   // Expect error.message === 'User unavailable.' and no new pending request.
   ```

   Do not use a privileged key. The publishable client uses A's existing session.
8. With A-C still unconnected, open C's card as A and leave it open. In B's isolated
   session remove A from Friends. Back in A's still-open card, select Add Friend.
   It must close with “User unavailable.” and create no request. Repeating either
   comment RPC with `commentC` must reject identically. Selecting the existing bottom Feed button must remove
   B's posts through the ordinary Feed refresh; a cached comment is not authorization.
9. Restore A-B using the existing invitation flow. To check concurrent same-direction
   requests, with no pending A-C request run this in A's test console:

   ```javascript
   await Promise.all([1, 2].map(() => probe.rpc('send_comment_friend_request', {
     p_comment_id: commentC
   })));
   ```

   Both successful results must contain the same request ID, with exactly one pending
   row shown in Friends. As C, use A's comment ID to call the same send RPC in reverse:
   it must reject with “A request is already pending”. C can still accept/decline A's
   request normally. Also verify a valid existing C invitation link still works and
   refers to the same pending connection when opened again by A.
10. To check quota with only these three accounts, repeatedly send A-C requests and
    decline them as C until A has created 30 requests within one hour (the earlier
    steps count toward this total). The next new request must fail with
    “Too many friend requests. Try again later.” through both C's comment and C's
    existing invitation link. Reopening a card must still work. Avoid doing this with
    real accounts; the SQL regression script provides a faster disposable-data check.
11. Log out while a card is open, and separately switch accounts in a second tab. The
    card must close; no former-account card data or action should survive. Confirm
    existing sharing/New Link controls, reactions, comments, and Feed/Profile navigation
    continue to work. Existing account deletion is untouched and should be checked only
    with a disposable test account after completing the other checks.
