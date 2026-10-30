# Migration status — BETA v0.1.1.0

**Production:** BETA v0.1.1.1 at `edf1427c9daa3080600ebfeb2a6f71ee8957cc88`.
The A01–A04 stabilization patch is local and unreleased.

> **Current reading note:** This inventory preserves recorded deployment evidence. The preceding frontend was BETA v0.1.1.0 at main 34b4766; no migration ledger was queried or changed here.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


This is an operator inventory, **not** Supabase ledger data. Final release
preflight read-only verified F02's effective grants/profile guard and F06's exact
reviewed body, invoker behavior and grants. No ledger modification or SQL
application was performed during the recorded release review.
Historical pre-stabilization baseline: `1b0e899`, BETA v0.1.0.2.
Previous frontend production main was `34b4766`, BETA v0.1.1.0. No backend
operation or ledger query was performed during this documentation organization.

## Existing production baseline

| Source | Known status and evidence |
| --- | --- |
| `schema.sql` | Historical bootstrap of the existing app; never replay on production. Not a forward migration or reconstructed ledger entry. |
| `20261023012201_comment_author_discovery.sql` | Existing production prerequisite in the recorded stabilization scope; the later username RPC depends on its helper. No independent exact-file apply receipt/remote comparison was obtained here. Its historical UNDEPLOYED header is not current rollout guidance. |
| `20261023175105_web_push_notifications.sql` | Deployment records report production application, deployed push functions, secrets, Vault and scheduler configured. Do not reapply/recreate scheduling. |
| `20261023193752_in_app_activity.sql` | Deployment records confirm application of the unchanged reviewed file, SHA-256 `7760f36a29e6e2e5612c3cdd31ad114f3e53ea48b6191f62387520ea5653a652`; not a ledger query. |
| `20261023202526_remove_push_quiet_hours.sql` | Deployment records report successful production application and a real Android push afterward; the recorded audit did not perform the device test. |
| `20261023210942_add_friend_by_username.sql` | Deployment records report application and verified `public.send_username_friend_request(text)` exists. |
| `20261024112734_daily_posting_cap.sql` | Included in the recorded production source baseline, treated as an existing release prerequisite. No separate exact-file SQL apply receipt is retained. Verify live cap/helper definitions before release; Git presence is not proof and does not justify reapplication. |

The release introduced **only F02/F06 as new production SQL; both are now applied**.
If read-only prerequisite checks contradict this baseline, stop for maintainer review;
do not silently add an older migration. Manual SQL may not have corresponding CLI
history. Neither a ledger row nor its absence proves exact live function bodies.

## Stabilization migrations — applied in production

Deployment records confirm application and verification in this order. Read-only release
preflight confirmed the effective definitions/permissions; these are source
records, not instructions to reapply or fabricated ledger receipts:

1. **F02: `20261024171206_restrict_friendship_helper.sql`**
   - SHA-256: `709c0f5885cbc4befa65518a81461b5404d3d8aefa3fa53c374d84eef31da11d`.
   - Requires existing trusted owner/definer/service grant for `are_friends`,
     discovery's restrictive profile guard and canonical own-edge friendships RLS.
     Restricts browser EXECUTE, preserving trusted internal callers.
2. **F06: `20261024174419_bound_activity_unread.sql`**
   - SHA-256: `e27e112e3c9659c4d967f04795cd57338581a949500f81e514167443c57b4f8f`.
   - Requires the existing invoker `get_activity()`, owner, authenticated-only ACL
     and Activity RLS. A single bounded set supplies both items and unread.

F06 adds no dependency on F02's changed ACL. Native/PGlite tests exercise them in
timestamp order with existing RLS. Each commits independently. Incompatible
owner/ACL/policy prerequisites fail closed; do not weaken guards to apply them.
Neither changes Storage policies, subscriptions, push functions, secrets or Cron.
F01/F03/F04/F05/F07/R02/F08 require no additional production SQL.

## History and deployment rules

- Preserve all applied files, including historical comments. This inventory
  supersedes stale local-review status prose; it is not automatic replay guidance.
- Do not bulk `db push`, reset, rerun schema.sql, fabricate ledger rows or repair
  history. Reconciliation requires a separately authorized operator audit.
- **delete-account v7 is ACTIVE**, SDK **2.118.0**, verify_jwt=true, no import
  map. Retrieved source matches the reviewed file. Do not redeploy it during
  frontend publication. Push functions and scheduler remain unchanged.
- Reverse committed SQL only with a reviewed forward correction. Removing F02
  restrictions would reopen disclosure. See ../../DEPLOY.md for stop/rollback rules.
- R03 has **no fix or migration**. Physical Storage leakage is unverified. The
  owner explicitly accepted this unresolved risk for the beta and stopped further
  integration testing. Acceptance is not a complete-erasure guarantee.
