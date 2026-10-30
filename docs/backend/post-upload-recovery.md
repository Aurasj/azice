# F03: failed-post photo cleanup

> **Current reading note:** F03 is shipped. Existing real-Storage verification limits remain; documentation relocation is not a new cleanup guarantee or R03 fix.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


This frontend fix is included in deployed BETA v0.1.1.0. No SQL migration, Storage policy, privileged
cleanup endpoint, background job, or dependency is added. Existing F02 and all
older migrations remain unchanged; the prepared application version is unchanged.

## Root cause and reproduction

Previously `createPost()` uploaded bytes before inserting `post_photos` metadata.
On any later failure it called Storage `remove()` inside an empty catch, ignored
returned `{error}` values, then unconditionally attempted to delete the draft
(also ignoring returned errors). Draft deletion cascades photo metadata. Storage
DELETE is permitted only while the authenticated user's owned draft exists, so
deleting it after failed removal destroys the ordinary authorized cleanup path.

There is also a SELECT dependency. `post_image_select` requires a matching
`post_photos` row and `can_view_post()`. `post_image_delete` checks the owned draft
and path but does not supply SELECT access. Storage removal requires both SELECT
and DELETE. A file uploaded before a failed metadata INSERT can therefore remain
invisible to the owner's ordinary removal operation, even while the draft exists.

The new mocked test first failed against the old implementation: a returned
Storage removal error did not produce `cleanupPending`, and the draft was deleted.
The disposable PostgreSQL runner separately reproduces the policy gap: an owned
draft object without metadata cannot be selected or deleted with RETURNING by its
owner; adding the missing metadata restores authorized removal. It uses the real
repository policy expressions, not a JavaScript approximation.

## New lifecycle

- A per-account journal records draft UUIDs, reserved
  paths and operation phases before uploads begin. It contains no images, reasons,
  tokens or credentials. Browsers with Web Locks use localStorage and an exclusive
  per-account lock across tabs; other browsers use per-tab sessionStorage.
  If persistence fails before starting, publishing stops.
  Tests can inject a storage implementation; the memory fallback is for nonbrowser
  execution only. No browser fallback silently discards a failed persistence write.
- Keep the existing locally generated UUID and INSERT-only draft creation.
  Reserve each `post_photos` row BEFORE uploading its file. A metadata failure
  prevents that file's upload. Confirmed earlier uploads can still be cleaned.
  The draft and metadata form a durable server-side recovery manifest.
- Upload the same processed JPEG bytes, paths, MIME type and `upsert:false` options.
  Publish only through the existing atomic `publish_post` RPC. Photo verification,
  reason validation, three-photo maximum and the shared daily quota remain intact.
- Recovery rechecks the active account/generation and fetches the owned post and
  server metadata. It does not trust a missing row or empty Storage result as
  evidence of successful cleanup when expected metadata is missing.
- For a known failed draft, list its exact folder, remove visible registered
  files, inspect returned errors AND exceptions, and list again. Partial deletion,
  an empty/no-op remove response, list failure or remaining files cannot authorize
  draft deletion. No photo downloads or image decoding are used for cleanup.
- Delete the draft only after verified empty Storage, using ID, author and draft
  status filters. Confirm the deleted ID through RETURNING. On failure, keep the
  draft, metadata and journal, and report `cleanupPending` with the original error.
  Already-deleted files are harmless on retry; metadata remains until the draft's
  final cascade. A lost DELETE response is reconciled using its saved deleting phase.
- An interrupted or ambiguous upload may finish server-side after the connection
  fails. Its draft/metadata/journal are conservatively retained even when the
  current folder is empty, so a late-arriving object still has an authorized
  cleanup path. Later retries remove any such files. These retained drafts do not
  count as published posts and do not block an intentional new posting attempt.
  They are not automatically retired without confirmation of the uncertain upload.
- A lost publish response must not trigger destructive cleanup or a fresh post.
  Reconcile the same UUID against server status. If published, report the original
  success. If still uncertain, preserve everything. An explicit subsequent Publish
  retries the existing UUID/RPC; its existing row lock and draft-only rule prevent
  double publication. Definitive PostgreSQL errors may enter normal cleanup.
- Reject overlapping operations for the same account in this adapter, and across
  tabs when Web Locks is available. Auth events
  invalidate continuations, including A → B → A. Check account identity before
  mutations; B cannot run A's recovery. App-level account guards discard stale UI
  feedback. The journal is account scoped and is not cleared on logout.
- Reopening New Post invokes `retryPostCleanup()` before checking the daily quota,
  so reaching three posts does not prevent cleanup. Publishing also retries pending
  cleanup before creating another draft. There is no polling or automatic sweeper.

## Why no backend migration is needed

Metadata-first ordering supplies the SELECT permission already required by
Storage, without changing any RLS policy. Preserving the owned draft retains the
existing DELETE permission. Publication already verifies every reserved photo
against actual `storage.objects`, so a reservation alone cannot publish a missing
file. SQL tests cover these properties after the existing migration chain and F02.
The browser never receives privileged keys and never deletes Storage catalog rows
directly. Published photos remain immutable and friend-only.

## Verification and limits

`node --test tests/*.test.mjs` includes mocked Supabase request/Storage responses,
photo encoding tests and UI account/quota regressions. The cleanup tests cover
first/second/third uploads, metadata failures, returned/thrown/partial removal,
retry across adapter recreation, persistence failures, account changes, ambiguous
uploads/publication, ordinary success and quota rejection.

`node scripts/test-post-cleanup-postgres.mjs` runs seven PostgreSQL/PGlite groups
using synthetic accounts, Auth/Storage tables and the original Storage policies:
the metadata visibility defect, metadata-first recovery, partial removal,
authorization, atomic publishing/immutability and quota rejection. This manipulates
only disposable Storage metadata, not real files. Other PostgreSQL runners cover
F02, invitations, Activity, push, quiet-hours removal and daily posting limits.

No real Storage API integration, native multi-session PostgreSQL, Android camera,
iPhone camera or hosted end-to-end testing was performed. Browser networking,
Storage list consistency and physical blob removal still require staging checks.
There is no transaction spanning browser persistence, SQL and object storage.

Local verification completed: all 344 JavaScript tests passed (including 18 new
cleanup tests and three new UI/quota/account tests), all seven new Storage-policy
PostgreSQL groups passed, and all 67 pre-existing PGlite groups passed, including
F02. Syntax checks passed for 41 JavaScript modules plus syntax-only transpilation
of the two unchanged push Edge Functions. Production build, `git diff --check`
and whitespace checks for the new files passed.

Automatic retry discovery survives browser restarts with localStorage/Web Locks.
In the fallback, sessionStorage may disappear when a tab or PWA context is
closed/cleared. The server draft and all reserved paths remain
queryable by the owner/operator, so identifiers and permissions survive loss of
the journal. A crash after an uncertain publish may need manual reconciliation
before resubmitting from a different tab/context if the journal is unavailable.
Browsers without Web Locks do not share a submission mutex; do not retry one
unfinished post in several tabs or clone a tab containing a live posting attempt.

Legacy orphan objects produced before this fix are not silently repaired. If
their draft was deleted, existing RLS cannot authorize owner cleanup. An operator
must review them using authorized administrative Storage tooling. This fix does
not expand browser deletion rights to address legacy damage.

## Historical rollout and manual recovery reference

1. Review the frontend diff and tests. Keep F02's migration review/deployment
   separate; F03 adds no migration or backend prerequisite and changes no secrets.
2. On a disposable Supabase staging project, use operator-controlled accounts A/B.
   Publish one normal photo post. Confirm B can view it only while authorized and
   neither account can remove the published image through ordinary client access.
3. With three captured photos, reject the second/third upload, metadata INSERT,
   or publish request using browser request interception. Also simulate removal
   returning an error, network failure and a partial result. Confirm the failed
   post stays out of Feed, reason/photos remain in the Create Post form, and failed
   cleanup retains the owned draft and registered paths. Verify actual Storage
   bytes, not just database rows or client response data.
4. Restore connectivity and reopen New Post in the same tab. Confirm only remaining
   files are removed, then the safely removable draft/metadata disappear. Repeat
   at the three-post quota; cleanup must still run. For an ambiguous upload, expect
   the conservative retained draft and repeat cleanup after any late completion.
5. Switch A → B while an upload/removal is pending. Verify no A continuation
   publishes/cleans with B's session and no A result appears in B's UI. Switch back
   to A in the same tab and retry cleanup. Simulate a lost publish response and
   verify retry resolves the original UUID rather than creating another post.
6. For a lost journal or conservatively retained draft, use the owner's RLS-scoped
   client to list their `posts` filtered to `status='draft'`, with
   `post_photos(slot,path)`. Inspect each exact user/draft Storage folder using the
   Storage API. Establish that the original upload/publish requests have finished;
   do not abandon an operation that may still publish. Remove verified abandoned
   draft files via Storage, confirm the folder is empty, THEN delete that owned
   draft. Never delete `storage.objects` with SQL to remove physical files.
7. If a legacy file lacks metadata but its draft still exists, a reviewed owner
   metadata repair can restore SELECT/deletion rights if its slot/path constraints
   permit. If the draft is gone or ownership/status is uncertain, stop and use
   reviewed operator/admin Storage cleanup. Do not create broad browser policies.
8. After review and successful staging checks, publish the frontend through the
   normal release process. No SQL, Edge deployment, scheduler or provider setting
   change is required. Existing account deletion continues its privileged Storage
   cleanup before Auth deletion, including retained draft directories.

## Local avatar cleanup follow-up (A03)

The local stabilization patch also journals owner-scoped avatar paths before upload.
The next avatar selection retries known failed removals under the existing per-account
operation lock, checks the current profile reference, and verifies absence through
Storage listing before forgetting a removed path. Returned errors and thrown failures
retain the reference. A current avatar is never intentionally removed.

An unconfirmed upload or profile-update outcome retains its reference and stops automatic recovery for
support review: a client cannot prove that an in-flight operation has finished. An
uncertain reference is not reconciled from a later profile snapshot, even if that
snapshot matches. Only explicit returned transaction-abort errors permit checked
profile-failure cleanup; transport errors and unknown outcomes do not. This
is not an R03 fix or proof of physical deletion. Recovery uses localStorage with
Web Locks, otherwise tab-local sessionStorage; clearing that storage loses these
local avatar references. These client checks do not make profile updates and
Storage deletion atomic against arbitrary external writers; that guarantee would
require backend coordination. No privileged cleanup service or policy change is added.
