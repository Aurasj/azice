# AziCe? BETA v0.1.1.0 release checklist

This is preparation for the **existing** Git-connected Netlify site and Supabase
backend. No new site, domain, DNS, Auth, SMTP or scheduler setup is needed.
The owner has authorized frontend publication. Previous frontend baseline:
1b0e899 / BETA v0.1.0.2. F02/F06 are already applied and verified; delete-account
v7 is ACTIVE with SDK 2.118.0. No backend redeployment is part of final publication.

## Review gates

1. Review the intended diff against 1b0e899: F01–F07, R02, F08 docs, tests and two
   forward-only migrations. Preserve the five unrelated untracked files identified
   in the release report; do not stage them.
2. Read [MIGRATION_STATUS.md](supabase/MIGRATION_STATUS.md). Source files/manual
   SQL receipts do not establish a matching migration ledger. Do not bulk-push
   migrations, replay schema.sql, insert history rows or repair history.
3. Record unresolved R03 and missing real F03 Storage/native Deno checks.
   The owner stopped further R03 integration testing for this beta; this does not
   close R03. The owner explicitly accepted the unresolved risk for this beta.

## Backend first — completed historical checklist; do not repeat

The following backend steps are already complete. Read-only release preflight
confirmed the effective changes; they are not pending frontend-release actions.

1. Read-only verify definitions, owners, grants and baseline prerequisites; arrange
   a backup/recovery point. Stop on unexpected differences. Do not reapply existing
   production changes merely because they exist locally.
2. Apply **only** supabase/migrations/20261024171206_restrict_friendship_helper.sql
   (F02), once as the reviewed owner. Verify anon/authenticated arbitrary-pair
   probing is rejected and authorized RLS/service-role operations still work.
3. Apply **only** supabase/migrations/20261024174419_bound_activity_unread.sql
   (F06), once as the reviewed owner. Verify newest-50 items/unread agree and
   visible events can be marked read. Both migrations reject incompatible
   owner/ACL/policy prerequisites.
4. Redeploy **only delete-account** from reviewed source to activate R02's exact
   SDK **2.118.0** import. Preserve existing JWT configuration/runtime credentials.
   Push functions already pin that version and are unchanged. Do not redeploy
   them or change secrets, Vault, Cron, RLS or Storage configuration.
   This redeployment pins a dependency; it does **not** fix R03.

## Frontend last — future separately approved publication

1. Run the full JavaScript suite with the optional pinned SDK artifact supplied
   ([instructions](supabase/SDK_VERSIONS.md)), available SQL regressions, syntax
   checks, production build and git diff --check.
2. **node scripts/build.mjs** recreates **dist/**. Inspect its public-only contents:
   index.html, app.js, cloud.js, demo.js, config.js, styles.css, sw.js,
   **push-sw.js**, manifest.webmanifest and runtime assets/.
   Original logo/master, tests, docs, SQL, Edge source, .env files and tooling
   must not be published. Never upload the repository root or commit dist/.
3. After explicit commit/push approval, stage only reviewed files; run
   git diff --cached --check and inspect the staged list. Publish through the
   approved branch/main workflow; never force-push.
4. Existing netlify.toml runs **node scripts/build.mjs** and publishes **dist**.
   Let the existing Git integration deploy after the approved merge/push.
   No manual Netlify trigger, new site or DNS change is required. A successful
   push is not proof of a successful Netlify build/deployment.
5. Verify the deployed commit; reload online and confirm **BETA v0.1.1.0** and
   the exact browser SDK URL. Open/offline clients may keep older code until an
   online reload. Do not change PWA identity/worker architecture to force a badge.
   Confirm nonpublic repository paths are unavailable on the deployed site.
6. With approved test accounts, smoke-test login/recovery/onboarding, account
   switching, Profile/avatar edits, Feed return refresh/revocation, comments,
   Activity, posting cap/cleanup, Friends and push preferences. Device and real
   Storage checks are separate from mocks/emulation. Normal account deletion is
   not proof of R03 concurrency safety or complete erasure.

## Rollback and stop conditions

A SQL error rolls back that migration; F02/F06 are separate transactions, not a
combined atomic deployment. If F06 fails after F02 commits, record that state and
stop for review. Never remove applied history or replay old schema.

Any reversal of committed SQL needs a separately reviewed new forward migration.
Restoring F02's browser EXECUTE access reopens disclosure; do not do it as an
automatic rollback. Restoring F06's old body restores stuck-unread behavior.
Review frontend rollback compatibility with the applied backend. Do not reset
data, receipts, preferences, quotas or Storage objects as a release shortcut.
