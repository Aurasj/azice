# AziCe? BETA v0.1.1.0 — local preparation report

Branch: `stabilization/beta-v0.1.1.0`. Production comparison: `1b0e899` /
BETA v0.1.0.2. Existing checkpoint: `c885d1e64d3cf2ccd49ea7be2ceba4bb8370c13b`.
APP_VERSION is now **0.1.1.0**; the existing shared badge/test reads deployed code,
not browser settings. The owner has now authorized final publication. F02/F06 are
applied; read-only preflight confirmed their effective definitions/permissions.
delete-account v7 is ACTIVE with SDK 2.118.0. No SQL or Edge redeployment is part
of the final frontend release. Earlier verification records below remain historical.

## Scope reviewed against production

- F01: account/request/navigation guards for private Profile and avatar continuations.
- F02: restrict arbitrary friendship probing while preserving trusted callers/RLS.
- F03: reserve photo metadata before upload, persist/retry cleanup, preserve
  uncertain drafts and reconcile ambiguous publication without creating duplicates.
- F04: authorized Feed refresh after backgrounding, safe failure/cache invalidation,
  overlapping/account guards and reuse of valid image URLs/DOM where possible.
- F05: prevent overlapping accidental comment submissions; keep retry drafts and
  isolate responses by account/post/navigation.
- F06: unread computed from the same newest-50 Activity set as visible entries.
- F07: native discovery runner supplies the actual post-image SELECT prerequisite,
  verifies failure without it and exercises its real authorization semantics.
- R02: pin browser and delete-account SDK imports to 2.118.0; existing push pins
  remain unchanged. Dependency/CDN/offline limitations are documented.
- F08: replace starter deployment guidance with the existing Netlify build/dist
  setup and evidence-qualified migration inventory. Preserve applied SQL bytes.
- R03: preserve investigation/characterization tests and record unresolved risk;
  no production fix, physical leakage claim or further integration work.

## Exact intended release files: 40

This includes committed checkpoint work plus intended local changes/new files.
It is a review allowlist, not a staging command. Files outside it require review.

```text
DEPLOY.md
GEMINI_NEXT_STEP.md
README.md
STABILIZATION_RELEASE.md
app.js
cloud.js
scripts/test-account-deletion-native-postgres.mjs
scripts/test-activity-postgres.mjs
scripts/test-activity-unread-postgres.mjs
scripts/test-comment-discovery-postgres.mjs
scripts/test-friendship-helper-postgres.mjs
scripts/test-post-cleanup-postgres.mjs
scripts/test-stabilization-native-postgres.mjs
supabase/ACCOUNT_DELETION_R03.md
supabase/ACTIVITY.md
supabase/COMMENT_DISCOVERY.md
supabase/DAILY_POSTING_CAP.md
supabase/FRIENDSHIP_HELPER_SECURITY.md
supabase/MIGRATION_STATUS.md
supabase/NATIVE_POSTGRES_TESTS.md
supabase/PASSWORD_RECOVERY.md
supabase/POST_UPLOAD_RECOVERY.md
supabase/R03_LOCAL_INTEGRATION_ATTEMPT.md
supabase/SDK_VERSIONS.md
supabase/WEB_PUSH.md
supabase/functions/delete-account/index.ts
supabase/migrations/20261024171206_restrict_friendship_helper.sql
supabase/migrations/20261024174419_bound_activity_unread.sql
tests/account-deletion-races.test.mjs
tests/activity.test.mjs
tests/comments-submit.test.mjs
tests/daily-posting.test.mjs
tests/feed-refresh.test.mjs
tests/photos.test.mjs
tests/post-cleanup.test.mjs
tests/post.test.mjs
tests/profile-races.test.mjs
tests/recovery-version.test.mjs
tests/sdk-pinning.test.mjs
tests/security.test.mjs
```

Five unrelated untracked files were hash-checked unchanged and remain excluded:

```text
assets/logo.png
azice-confirm-ui-update.mjs
comment-discovery-storage-fix.patch
fix_azice_comment_tests.mjs
supabase/tests/comment_discovery_storage_compat.sql
```

No generated dist/, ignored tool/runtime/artifact directories, credentials or
temporary scripts belong in a release commit. Build packaging remains unchanged;
the source logo/master are excluded from dist by its existing filter.

## Verification executed during this preparation

| Check | Result and scope |
| --- | --- |
| Full JavaScript suite | **361 passed, 0 failed, 0 skipped**. Includes 13 version/recovery tests; pinned SDK artifact supplied and hash verified; network transport is synthetic. |
| PGlite | **97 groups passed**: F06 13, Activity 10 plus no-Cron 10, F02 17, F03 cleanup 7, historical Push 16, no-quiet-hours 6, username 7, daily cap 11. |
| Native PostgreSQL 15.18 | **24 checks/groups passed**: discovery/F07 16, stabilization 8. Includes F02 then F06, actual roles/RLS, rollback and overlapping-session locks/last-slot publishing. |
| JavaScript syntax | **46 modules passed**. |
| Edge syntax | All three entry points passed TypeScript syntax transpilation. Native Deno/import resolution not executed. |
| Production build | `node scripts/build.mjs` passed; output is the existing public-only dist allowlist. |
| Whitespace | `git diff --check` and checks covering new intended files passed. |
| Scope/secrets | Diff reviewed against 1b0e899; credential-pattern scan found no credential material. This is a heuristic plus manual review, not a guarantee. Both pending migration hashes and earlier SQL files are unchanged. |

Native checks used only the previously approved, marked loopback disposable
PostgreSQL cluster. Test fixtures create/drop their own disposable databases;
this is not production SQL application. The server was stopped afterward.
R03 native/real-service integration was not resumed. No Docker, VM or additional
Supabase project was created. Existing R03 mocked characterization tests remain
in the JavaScript suite; passing them reproduces the known gap, not a repair.

## Open risks and release gates

- **R03 unresolved and explicitly accepted by the owner for this beta:** local
  metadata/mock schedules expose a concurrency risk. Surviving physical Storage
  bytes are unverified, not confirmed. Integration testing is stopped; acceptance
  is not a fix or a complete-erasure guarantee.
- Real F03 Storage failure/recovery and native Deno/hosted Edge behavior remain
  unverified. Native SQL success is not Auth/Storage HTTP or physical-byte proof.
- Source/history documentation is corrected without fabricating ledger entries.
  Discovery and daily-cap exact-file production application were not independently
  compared here; the latter lacks a retained individual apply receipt. The owner
  must verify existing prerequisites read-only before release. Stop on differences,
  rather than replaying those migrations.
- F02/F06 are applied. Read-only release checks confirmed F02 permissions/profile
  guard and the exact F06 body/invoker/grants. delete-account v7 is ACTIVE, JWT
  verification enabled, import map disabled, source matching the reviewed pin.
  Do not reapply SQL or redeploy the function during final publication.
- No local checks failed. Device camera/push behavior and hosted release smoke
  tests were not performed in this run. Production remains unchanged.

## Final publication checklist — owner authorized

1. Preserve the 40-file scope and five exclusions; backend steps are complete.
2. Do not reapply F02/F06, modify the ledger or redeploy delete-account v7.
3. Rerun local checks and stage only reviewed stabilization files.
4. Commit remaining changes on stabilization, fast-forward main where possible,
   verify complete release/history, then push only main without force.
5. Existing Netlify builds with
   `node scripts/build.mjs`, publishing **dist**; do not manually trigger it.
6. Confirm actual deployment status/commit, online badge v0.1.1.0, exact SDK URL,
   private-path exclusion and approved smoke checks. An online reload is needed
   for old open/offline clients to adopt new code. See DEPLOY.md for stop/rollback.
