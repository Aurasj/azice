# Activity Center — local implementation, not deployed

Activity contains only comments and initial reactions from other authenticated users on the recipient's own published posts. It is independent of Web Push consent, devices, notification preferences and delivery. No friend requests, new-post notifications or reminders are copied into this list. No source content, names, avatars or post reasons are stored in Activity.

## Review and deployment order

1. Review `migrations/20261023193752_in_app_activity.sql` and test in an isolated Supabase staging project. Apply it once as the reviewed database administrator/owner, after the existing schema. Do not reapply the original schema or already-applied migrations. There is no historical backfill; recording begins when this migration is applied.
2. The migration creates `activity_notifications`, two source INSERT triggers, an internal capture/purge schema and two browser RPCs: `get_activity()` and `mark_activity_read(text)`. Existing source policies, Storage, Web Push triggers/queue/Edge Functions, preferences, secrets and the Web Push schedule are untouched.
3. Retention is enforced in RLS and mark-read authorization at exactly 30 days. Where pg_cron is installed, the migration adds only the independent `azice-activity-retention` job (`17 3 * * *`, database scheduler time), running `select azice_activity.purge();` as the migration owner's scheduled role. An existing job with that name causes migration rollback rather than replacement. Review this new retention job; it does not dispatch notifications or alter `azice-push-dispatch`.
4. If Cron is absent, the migration emits a notice and does not install extensions. The administrator must schedule the private purge function using an independent maintenance mechanism. Expired rows are always unreadable, but physical removal otherwise waits for maintenance or new incoming activity for that recipient. With the daily job, physical deletion may follow the visibility cutoff by up to one day.
5. Verify source events, ownership, read marking, old-post read-only behavior, actor/post/account deletion and the independent retention job in staging. Then publish the reviewed frontend after separate approval. A frontend deployed before the RPCs exist retains a working Feed and displays an Activity retry/error state.

## Authorization and edge cases

- `activity_notifications` has recipient, actor, category, post, event identity, timestamp and read timestamp only. Recipient, actor and post foreign keys cascade on deletion. Actor/post/recipient indexes support those cascades; recent/unread/expiration indexes support bounded reads and cleanup.
- Authenticated users receive SELECT only, protected by recipient ownership, a 30-day cutoff, published-post ownership and the existing `can_view_post()` helper. They cannot insert, delete, change event metadata or directly alter read timestamps. Anonymous users cannot read the table or execute the browser RPCs.
- `get_activity()` runs as invoker, so RLS also applies inside the RPC. It returns the newest 50 rows in descending timestamp/event order. After the F06 migration below, its unread flag describes exactly these same 50 rows; older hidden unread events cannot keep the bell active.
- `mark_activity_read(text)` is a SECURITY DEFINER wrapper with an empty search path and exact grants to authenticated only. It checks `auth.uid()`, recipient ownership, expiry and current post authorization before updating only `read_at`. It is idempotent. Foreign, expired or inaccessible event keys return false without revealing other recipients' data.
- The internal trigger function checks that the source actor equals `auth.uid()` and that existing `can_interact_post()` authorization still permits the action. It also checks published-post ownership, confirmed friendship and self exclusion. Privileged inserts without an authenticated source actor do not create Activity. Existing browser comment/reaction behavior uses that actor normally; Activity does not authorize new source writes.
- Comment identity uses the source comment ID. Reaction identity uses post + actor; emoji updates do not trigger Activity, and removing/reinserting a reaction preserves its original timestamp/read state. Comment/reaction deletion does not erase the historical event; post/actor/recipient deletion does. There is no new source deletion UI.
- The capture/purge functions use SECURITY DEFINER and an empty search path in a private schema. Browsers and service_role receive no schema usage/EXECUTE on them. Apply as the reviewed owner able to read source rows and schedule its private purge function. ACL statements name only the newly created objects.
- Actor display names are fetched through existing profile RLS, selecting only ID/display name. Removed friendships do not expose private profiles: missing actor names display as “Someone.” No profile or Storage access is widened. Tapping Activity re-fetches the published post using the existing RLS-protected single-post adapter and additionally requires current-user ownership.
- The post remains readable after 48 hours when existing access rules permit it; existing frontend and database interaction limits make it read-only. Comment entries expand comments. Back follows Post → Activity → Feed. Missing/deleted/revoked targets remain unavailable and are not marked read.
- The Feed bell refreshes on Feed entry, Activity opening/read marking and the existing visibility/focus return flow. There is no polling or new Realtime configuration; another user's activity is not guaranteed to appear instantly while this app remains continuously focused.
- Account changes reset Activity immediately and discard in-flight reads/post opening. Read marking can finish after Back without moving the user away from Activity.
- Demo mode has an empty Activity view; persistent capture is implemented in Supabase only.

## Local verification commands

```powershell
node --test tests/*.test.mjs
node scripts/test-activity-postgres.mjs
$env:AZICE_ACTIVITY_NO_CRON='1'
node scripts/test-activity-postgres.mjs
Remove-Item Env:\AZICE_ACTIVITY_NO_CRON
node scripts/build.mjs
git diff --check
```

The PostgreSQL runner uses the existing ignored PGlite tooling installed for Web Push tests. It applies the schema plus comment-discovery/Web Push migrations only to a fresh in-memory database, then the Activity migration. It executes real PostgreSQL RLS/trigger/RPC tests; Cron scheduling is a local stub, not actual pg_cron execution or multi-session verification. JavaScript tests use mocked API transports. No local test applies remote SQL or verifies live push/device behavior.

Local verification on 2026-10-23: 235 JavaScript tests passed, including nine focused Activity tests; 31 JavaScript syntax checks, production build and whitespace checks passed. Ten Activity PostgreSQL regression groups passed with a Cron stub and again without Cron. All 16 existing Web Push PostgreSQL regression groups passed. Isolated headless Chrome checked Feed/Activity/list/empty/error states at 320×568, 390×844, 844×390 and 568×320, including synthetic safe areas, header fit, comment navigation/Back and read marking. These are simulated desktop-browser checks, not physical Android/iPhone or hosted database tests.

## Safe rollback

For the F06 correction, use the narrower deployment/recovery procedure below;
do not remove Activity tables, triggers or schedules to roll back that correction.

After approval, unschedule only `azice-activity-retention` if installed. Restore the earlier frontend, then use a separately reviewed forward migration to drop the two `activity_*` source triggers, `get_activity()`, `mark_activity_read(text)`, the Activity table and its private schema. Export any needed metadata first. Leave all Web Push and original schema objects untouched.

## F06: bounded unread state (local, awaiting review)

New forward-only migration: `migrations/20261024174419_bound_activity_unread.sql`.
The already-applied original Activity migration is unchanged. The old function
limited `items` to 50 but ran `unread` EXISTS over every RLS-visible event. With
51 eligible events, all 50 visible rows read and only the oldest unread, the bell
stayed active even though the UI provided no row to open. The new disposable SQL
test reproduced this (`true !== false`) before the correction.

The replacement materializes one newest-50 RLS-visible relation, then derives
both the ordered JSON list and `bool_or(read_at is null)` from it in a single
statement snapshot. Empty lists return `[]` and false. The ordering remains
`created_at DESC, event_key DESC`, including ties. No events are marked read,
deleted, backfilled, or newly exposed by the migration. Older hidden read state
is preserved; only its contribution to the bounded indicator changes.

Dependency/permission review:

- Only `public.get_activity()` changes. It remains SQL/STABLE/SECURITY INVOKER,
  returning the same JSON shape with an empty search path. CREATE OR REPLACE
  preserves its OID, owner and ACLs. A preflight rejects unexpected owner/definer
  mode, missing RLS or unexpected anon/authenticated/service-role RPC privileges.
- It reads `public.activity_notifications` through the existing `activity_read_own`
  policy, which checks auth.uid(), recipient ownership, 30-day event retention,
  can_view_post() and current published-post ownership. No RLS changes or new
  helper calls are introduced, so there is no added recursion or definer bypass.
- `mark_activity_read(text)` remains the existing SECURITY DEFINER wrapper,
  with its existing recipient/access checks, idempotency, empty search path and
  authenticated-only grant. It does not call get_activity(). Capture/purge and
  their triggers/indexes/FKs are unchanged. Neither Edge Functions nor schedules
  nor Web Push delivery/subscriptions depend on get_activity().
- `cloud.js` invokes this parameterless RPC and fetches permitted actor display
  names. `app.js` renders the returned flag and refreshes after read marking.
  Existing request/account generation guards prevent an older response replacing
  a newer one. No frontend implementation or version changes are required.

A concurrent arrival after a query's snapshot is eligible on the next existing
refresh; this fix adds no polling or real-time system. Items and unread agree
within each response. Events on owned posts older than 48 hours remain accessible
and markable but read-only, as before. Event expiry, unpublished/nonowned/deleted
posts, and account isolation retain their existing rules. Unfriending hides the
actor's private profile and blocks new comments, but does not erase clearable
historical activity on the recipient's own post. Deleting a source comment or
reaction retains its historical event; deleting the actor/post cascades it.

Verification commands:

```powershell
# Expected failing pre-fix assertion, using only synthetic identities:
$env:AZICE_F06_BEFORE_FIX='1'
node scripts/test-activity-unread-postgres.mjs
Remove-Item Env:AZICE_F06_BEFORE_FIX
# Corrected behavior, including migration failure/rollback and unchanged ACLs:
node scripts/test-activity-unread-postgres.mjs
node scripts/test-activity-postgres.mjs
node --test tests/*.test.mjs
```

PGlite executes PostgreSQL RLS/functions in a disposable in-memory database;
it is not native multi-session or hosted verification. The new runner tests
consecutive refresh snapshots, not truly simultaneous connections. JavaScript
tests use mocked responses and include out-of-order refreshes and visible read
clearing. No hosted SQL, native server, actual Cron or live device push is tested.

Local F06 verification: all 346 JavaScript tests, 13 focused F06 PGlite groups
and 74 existing PGlite groups passed. Syntax checks passed for 42 JavaScript
modules and syntax-only transpilation of both unchanged push Edge Functions.
Production build, `git diff --check` and whitespace checks for new files passed.
The earlier F02 migration hash remains unchanged, and APP_VERSION remains 0.1.0.3.

Before production deployment (not executed):

1. Review this migration and verify the production function is still the expected
   SECURITY INVOKER function, with authenticated-only execution and
   the existing RLS enabled. Save its definition/ACLs for review. Review any custom
   dependencies absent from this repository. Do not apply old schema/migrations.
2. Apply this single migration to a matching disposable native PostgreSQL/Supabase
   staging database as the existing function owner (normally postgres). Test the
   51-event boundary with synthetic recipients, read all visible rows, verify false,
   then create a new authorized event and verify true/clear on opening. Check
   another account and anon cannot read/mark foreign activity. Verify overlapping
   native sessions return internally consistent snapshots and the existing app
   refresh picks up the next arrival.
3. After owner approval, apply ONLY `20261024174419_bound_activity_unread.sql` as
   that owner using the reviewed production SQL workflow. It contains BEGIN/COMMIT.
   Do not replay the original Activity migration or run a blanket database push.
   F02's separate migration has its own review/order; F03 has no SQL prerequisite.
4. Confirm get_activity remains invoker with its original OID/owner/ACLs and
   mark_activity_read is unchanged. Repeat the bounded read/unread smoke checks
   with operator-controlled accounts. Existing frontend versions are compatible;
   no frontend/Edge deployment, secret, subscription or scheduler change is needed.
5. If migration application fails, ROLLBACK the failed transaction and inspect the preflight
   error. The regression test injects a failure after replacement and verifies the
   old definition/ACLs and all read state are restored. After successful COMMIT,
   use a reviewed forward-only corrective migration if needed. Do not drop the
   Activity feature or restore the unbounded unread expression as a workaround.

Read-only metadata checks for the operator (do not invoke the data RPC as an
administrator to test recipient isolation; use actual authenticated test sessions):

```sql
select pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig,proacl,
 pg_get_functiondef(oid) definition
from pg_proc where oid='public.get_activity()'::regprocedure;
select r,has_function_privilege(r,'public.get_activity()','EXECUTE') allowed
from unnest(array['anon','authenticated','service_role']) t(r);
-- Expected execution: false, true, false. prosecdef must remain false.
select relrowsecurity from pg_class where oid='public.activity_notifications'::regclass;
select policyname,roles,qual from pg_policies
where schemaname='public' and tablename='activity_notifications';
```
