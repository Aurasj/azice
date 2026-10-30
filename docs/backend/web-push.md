# AziCe? Web Push — review and backend-first rollout

> **Current reading note:** Web Push and its 24/7-delivery migration are deployed. Initial setup/rollback sections below are operator references, not current rollout instructions.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


Contributor setup: `npm ci --ignore-scripts`, then `npm run check` and
`npm run test:sql`. Test dependencies are locked at the repository root. Older
supabase/.temp installation instructions below are historical, not needed for
these checks. No production credentials or live backend are used by contributor CI.

The initial Web Push backend and the 24/7 delivery migration are deployed. The operator confirmed that `20261023202526_remove_push_quiet_hours.sql` was applied successfully and that a real Android push for a new comment was received afterward. This is operator-reported production verification; the recorded audit did not execute remote SQL or perform that device test.

For current deployment status use [migration-status.md](migration-status.md) and ../../DEPLOY.md.
The initial setup/earlier rollout sections below are historical; do not replay
them or treat old pending-discovery wording as current migration status. F02/F06
are already applied and verified; delete-account v7 is ACTIVE with its SDK pin.
Do not repeat backend steps. Push functions, secrets, Vault and Cron are unchanged.

## Data flow and authorization

1. Transactional triggers observe successful pending friend-request creation (both existing invitation and comment-discovery RPCs), draft → published transitions, comment inserts and initial reaction inserts. There are no network calls in these transactions and no client API that accepts push recipients or lock-screen text. Existing RLS/business logic is retained. The outbox is atomic with the source transaction.
2. Jobs are created only for enabled recipients with an active device. Posts target confirmed friends; comments/reactions target the owner and exclude self activity. Initial/default consent and posting reminders are OFF. No historical backfill occurs on enable.
3. A database tick checks indexed due work once per minute and invokes one dispatcher only when needed. Opt-in reminder candidates are evaluated in one set-based query every five minutes. No per-user polling or Realtime configuration is needed.
4. The service-only dispatcher claims a bounded batch, reserves quotas under a preference-row lock, and leases it for two minutes. Database authorization, subscription ownership/expiry, current preferences, pending request/confirmed friendship, source existence and reminder evening eligibility are checked again immediately before each device send. Only allowed vendor HTTPS push endpoints are used; redirects, credentials, nonstandard ports and local/arbitrary hosts are rejected. Registration validates JWTs, keys and the P-256 point.
5. Web Push uses VAPID plus RFC message encryption via the pinned, server-only `web-push@3.6.7` dependency. The browser has no new dependency. The encrypted payload contains only category, opaque batch ID and random device binding. The service worker supplies fixed generic text; it never receives names, reasons, private photos, comment text or emoji content.
6. A tap opens `/?notification=<batch UUID>`. An authenticated, owner-scoped RPC resolves it and checks current post access; the frontend then fetches the post through the ordinary RLS-protected query. Unavailable/foreign/deleted updates return to Feed with a generic message. Friend requests open the existing Friends screen. Existing comments/reactions work in the authorized single-post view.

## Timing and limits

| Category | Grouping / delivery |
| --- | --- |
| Friend requests | Queued immediately; next tick, normally within a minute plus relay delay. Prioritized over digests. Eligible at any hour. |
| New posts | Ten-minute collection window, across friends; at most two reserved batches per recipient/local calendar day. |
| Comments | Three-minute collection window per post/owner; no self notifications. |
| Reactions | Fifteen-minute summary per post/owner. Emoji edits create no events; post/reactor uniqueness prevents repeated remove/re-add spam. |
| Posting reminders | Explicit opt-in; approximately 20:00–20:30 in the saved IANA timezone; no published post that local day and a confirmed friend's published update in the last 48 hours. Maximum three attempts in any rolling seven days, stricter than a calendar-week cap. |

Friend requests, new posts, comments and reactions are eligible 24/7 after their grouping windows and quota checks. A capped new-post batch resumes at the next local midnight, rather than 09:00. Reminders expire outside their local 20:00 hour rather than appearing the next morning. Budget reservations are conservative: failed attempts consume capacity; retrying the same batch on the same day does not consume another slot. Retries on a new day reserve a new daily slot. Grouped batches expire after 24 hours; orphan queued events after two days. Event keys retained with batches prevent duplicates for up to 30 days. A subscription has a 90-day server expiry and is renewed on app return at most once per 30 days while consent still exists; Disable/Enable can also renew it. Timezone is captured on enable and refreshed on boot/Profile load and on return when the browser's timezone changes.

Each invocation handles at most two batches and five devices per batch. A delivery request has a five-second timeout and five-minute relay TTL; queue API calls time out after three seconds. The scheduler HTTP timeout is 135 seconds to allow the bounded dispatcher to finish. 404/410 removes a device; 429/5xx/network errors retry with exponential backoff, at most five batch attempts. Other 4xx responses are terminal for that event, not a reason to retry indefinitely. Successful/terminal device receipts are excluded from retries. Logs contain aggregate outcome counts, never endpoints, keys or private content.

## Preferences, devices and deletion

- Enable requests browser permission only from the explicit Profile button. Category switches do not request permission. iPhone/iPad users must first add the app to the Home Screen and open the installed PWA; unsupported browsers get an English explanation. The existing install dialog and in-app friend toast remain independent.
- Master Disable is account-wide: it removes that user's server subscriptions and cancels pending work without resetting quotas. Categories independently cancel their pending work. Other devices may retain an inert browser subscription until reopened/re-enabled or unsubscribed.
- Explicit logout clears the device binding, unsubscribes in the browser, and best-effort unregisters that endpoint before signing out. Auth-driven account changes also clear stale binding/subscriptions. The service worker persists only a random binding in IndexedDB, never JWTs or profile data. Old-account pushes/taps with a different binding are discarded. Fresh opt-in is required on a different account. A known endpoint already registered to another account cannot be hijacked; unsubscribe first.
- A device showing no browser subscription loses its local binding on return. `pushsubscriptionchange` clears the binding; re-enable notifications to register again. Permission revocation and failed/unavailable registration do not block ordinary app use.
- New tables reference `profiles` with cascading deletion, including actor references. The existing delete-account Edge Function still removes Storage first and then deletes Auth; database cascades remove preferences, subscriptions, jobs, receipts and delivery history. No Storage policy/cleanup changes are required.

## Objects and dependencies

Initial migration: `supabase/migrations/20261023175105_web_push_notifications.sql` (already deployed; never edit/reapply). Follow-up: `supabase/migrations/20261023202526_remove_push_quiet_hours.sql`.

- Depends on the existing `profiles`, `friend_requests`, `friendships`, `posts`, `comments`, `reactions`, `auth.uid()`, `are_friends(uuid,uuid)` and `can_view_post(uuid)` definitions. It does not replace their functions or policies.
- Adds owner-readable `public.notification_preferences`; mutations are via `save_notification_preferences(jsonb)` scoped to `auth.uid()`.
- Adds a new, non-exposed `azice_push` schema containing subscriptions, jobs, batches, delivery receipts, quota reservations and internal trigger/reminder helpers. All private tables have RLS and no browser policies/grants.
- Public `push_register`, `push_unregister`, `push_claim`, `push_validate`, `push_complete` and `push_release` are executable only by `service_role`; `resolve_notification` is authenticated and owner scoped. All new SECURITY DEFINER functions use an empty search path, qualified application objects and exact grants. Run as the reviewed BYPASSRLS administrator; browser roles must not inherit it. New-object default grants are removed without changing unrelated object ACLs/overloads.
- Works with the original invitation mechanism and the separately reviewed comment-discovery migration. That older migration is **not approved by this feature**. Local tests apply both in order; do not blindly push all pending migrations.
- `notifications_schedule.sql` is a separate optional operator script. It requires `pg_cron`, `pg_net`, Vault, deployed functions and matching secrets. No extensions or schedule are created by the feature migration.

## Initial backend setup — reference for a fresh environment only

For the deployed production backend use the follow-up rollout below, not these initial setup steps.

### Initial backend-first order — operator only, after approval

1. **Review/back up:** Review the complete migration, Edge code and this document. Verify the live definitions/owners match the inspected schema, take a backup, and first use an isolated Supabase staging project. For a fresh environment, review comment-discovery prerequisites independently;
   the current production prerequisites are already recorded in migration status. Do not rerun `schema.sql` on an existing database or blindly use a command that applies every pending migration.
2. **Local checks:** Run the JavaScript suite/build and disposable PostgreSQL tests below. Run native Deno checks and a staged Edge invocation with the pinned imports; local Node tests do not establish hosted runtime compatibility.
3. **Keys:** Generate one VAPID pair locally, for example `npx --yes web-push@3.6.7 generate-vapid-keys --json`. Keep the private key outside the repository. Use a real contact `mailto:` or HTTPS URL as `VAPID_SUBJECT`; do not use localhost. Generate a separate cryptographically random 256-bit dispatcher secret. Do not print secrets in CI/chat logs.
4. **Migration:** Apply only the approved forward migration `20261023175105_web_push_notifications.sql`, once, as the reviewed owner. Confirm RLS/ACLs, PostgREST schema reload, normal publishing and both request paths in staging. Every preference remains OFF until consent.
5. **Edge secrets/config:** Configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET` and exact HTTPS `APP_ORIGIN`. Verify the runtime-provided `SUPABASE_URL` and privileged `SUPABASE_SERVICE_ROLE_KEY` are available only server-side. `APP_ORIGIN` must be the actual app origin with no trailing slash. Deploy `push-subscriptions` and `push-dispatch` with the checked-in function-specific `verify_jwt=false` settings: they implement explicit user JWT and scheduler-secret checks, respectively. Do not change delete-account configuration.
6. **Backend smoke tests:** Without a correct user JWT, subscription management must fail; with a different/missing dispatcher secret, dispatch must fail. Ordinary users cannot call service-only RPCs/read queue tables or choose a recipient. Review aggregate send errors in Edge logs. Verify normal app account deletion in staging.
7. **Scheduling:** Enable/review `pg_cron`, `pg_net` and Vault. In Vault create `azice_push_dispatch_url` (the project's `/functions/v1/push-dispatch` URL) and `azice_push_dispatch_secret` (same opaque secret as the Edge Function). Then review/apply `notifications_schedule.sql` once. It fails if a job with the same name already exists. Use this cron tick **instead of** also installing a database HTTP webhook, which would duplicate dispatch invocations. The transactional triggers already provide the database event hooks.
8. **Frontend last:** Set only `pushPublicKey` in `config.js` to the matching public VAPID key. Build and publish the reviewed frontend including `push-sw.js` and updated `sw.js` together. Existing public-shell caching remains network-first; neither private payloads nor media are added to Cache Storage. No private key, dispatcher secret or service credential belongs in browser configuration.
9. **Real delivery acceptance:** On Android Chrome and an installed iOS Home Screen PWA, explicitly Enable with test accounts. Exercise both friend-request paths, accept/unfriend before send, multiple published posts/drafts, self/other comments, emoji edits, grouping windows, overnight delivery, all category toggles, optional reminders, two devices, logout/account switching, revocation/expired subscriptions and account deletion. Tap notifications signed in/out/as another user; unauthorized posts must stay unavailable. Verify lock-screen text contains no private content. Only after these checks should production opt-in be opened.

## Safe disable / rollback

First unschedule only `azice-push-dispatch` in the Cron dashboard and disable notifications globally (`update public.notification_preferences set enabled=false` as administrator). Remove/rotate dispatcher credentials and leave the new tables/history for inspection. Remove the browser public key to hide enable functionality. Existing notification taps still use authorization checks; already displayed OS notifications cannot be recalled.

For a complete schema rollback, create a separately reviewed **new forward migration**: drop only the four `push_*` triggers on source tables, then the eight new public RPCs by their exact signatures, then `azice_push` and `notification_preferences`. Do not drop/replace original schema, RLS, invitation/discovery RPCs or Storage objects. Preserve/export any needed delivery audit first. Never replay the original schema or edit an applied migration.

## Tests and limits

```powershell
node --test tests/*.test.mjs
node scripts/build.mjs
# Disposable, ignored test tooling only; not an app/browser dependency:
npm install --prefix supabase/.temp/push-tests --no-save --ignore-scripts @electric-sql/pglite@0.5.11 typescript@5.9.3
node scripts/test-push-postgres.mjs
node scripts/test-push-without-quiet-hours-postgres.mjs
node scripts/check-push-syntax.mjs
# Optional baseline-only compatibility run:
$env:AZICE_PUSH_BASE_ONLY='1'
node scripts/test-push-postgres.mjs
Remove-Item Env:\AZICE_PUSH_BASE_ONLY
```

Node tests cover endpoint/key validation, privacy, delivery classification, service-worker binding lifecycle, safe tap routing, explicit permission, subscription enable/disable and account-switch races. Handler tests execute the actual TypeScript handlers after Node's built-in type stripping (Node 22.13+), using native Node Request/Response/Web Crypto with mocked Deno.serve, Supabase, encryption and transport. They check JWT/secret rejection, authenticated subscription ownership, origin checks, malformed/oversize bodies, invalid EC points, endpoint policy, binary body bytes, response cancellation, redirects being disabled and retry classification. They do not import or execute the web-push dependency.

PGlite runs actual PostgreSQL-engine migration/RLS/trigger/RPC regressions with the original schema plus comment discovery, including grouping, quotas, the historical pre-follow-up deferral behavior, reminders, unsubscribe, recipient authorization and deletion. The separate 24/7 runner applies the full migration chain with a controlled PostgreSQL clock and verifies the follow-up behavior; deployed SQL is unchanged. Cron/Vault/HTTP are fixture stubs. It is not a multi-session concurrency test or a hosted Supabase test. The TypeScript check is syntax transpilation, not Deno dependency/runtime verification.

Local verification on 2026-10-23: 216 JavaScript tests (including 12 focused push tests), 29 JavaScript syntax checks, syntax transpilation of both Edge TypeScript files and the production build passed. PostgreSQL-engine regressions passed in both configurations: 16 groups with comment discovery and 15 groups with the base schema. The new due-time regression was also run against the original grouping statement and correctly failed (three grouped jobs instead of two). No real relay delivery, native Deno/hosted function execution or physical iPhone/Android push test was performed.

## Focused pre-deployment review

- `push_claim()` now adds `x.due_at<=now()` when assigning jobs to a new batch. Due jobs still group by recipient/category, comments/reactions additionally group by post, and friend requests remain individual. Future jobs remain unbatched until due. The regression checks due grouping, exclusion, no premature second claim and subsequent independent delivery.
- Neither Edge handler nor the shared policy required a confirmed authentication/endpoint fix. Subscriptions authenticate with Auth `getUser(token)` and use that user's ID for service-only registration/unregistration; client-supplied recipients are ignored. Exact-origin CORS is additional browser protection, not the authentication boundary. Dispatch requires POST plus the exact configured scheduler secret; an ordinary user JWT is rejected. Both functions intentionally retain function-specific `verify_jwt=false` and enforce these checks internally.
- Both paths use the existing shared HTTPS relay allowlist, excluding credentials, nondefault ports and fragments. Subscription registration also verifies a real P-256 point. Dispatch repeats endpoint and live-recipient checks and uses `redirect:'error'`, preventing a relay redirect from forwarding a VAPID authorization header elsewhere. Private queue RPCs remain service-only.
- Source review of pinned `web-push@3.6.7` confirms `generateRequestDetails()` returns encrypted Buffer bytes plus headers (including numeric TTL/content length). The handler passes those bytes directly to standard fetch, with no JSON conversion, and cancels the response stream. It deliberately does not call the library's Node HTTPS `sendNotification()`. Supabase documents npm and Node built-in support, but this is compatibility by inspection only until native execution passes. The Node transport fixture checks the exact Buffer slice bytes and header coercion; it does not verify native Deno's Node crypto/CommonJS dependency graph or actual encryption/relay acceptance. The top-level package is pinned; no native Deno dependency lockfile was generated or verified here.
- The existing scheduler is unchanged. Its installation transaction rejects an existing `azice-push-dispatch` job name; use that one schedule instead of adding a webhook or second schedule. The expanded PostgreSQL test checks the actual duplicate-name guard and tick function with stubs: empty/future work and active leases cause no HTTP call, while due jobs and expired leases do. Reminder enqueue remains idempotent under the existing event-key uniqueness test. Stubbed tests do not establish actual pg_cron/pg_net execution, timing or multi-session behavior.

Deno was absent from PATH and the usual local installation locations. Before deployment, run these checks in an environment with native Deno available, followed by isolated Supabase Edge smoke tests with the pinned imports and test-only keys:

```powershell
deno check --no-lock supabase/functions/push-subscriptions/index.ts
deno check --no-lock supabase/functions/push-dispatch/index.ts
```

Also execute `generateRequestDetails()` with a real generated test subscription/VAPID pair under Deno, build a native Request from its returned body/headers, and verify payload encryption plus a staged relay request. A successful type check alone does not verify those runtime paths. Follow the backend-first order above only after separate approval; this local review does not apply or approve a migration.

Delivery is at-least-once: a crash after relay acceptance but before recording the receipt can retry. Stable push topics and notification tags collapse duplicates where supported; exactly-once OS delivery is not promised. Revocation/disable can race after the final DB check or after a push has reached the relay (up to its five-minute TTL). Text remains generic, stale device bindings are rejected and taps reauthorize, but already displayed notifications cannot be revoked. Concurrent native PostgreSQL load/lock tests, real VAPID relay delivery, Android/iPhone permission/install behavior and hosted Edge dependency checks remain acceptance requirements.

References: [Supabase scheduling/Vault](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase dependencies](https://supabase.com/docs/guides/functions/dependencies), [Deno Node/npm compatibility](https://docs.deno.com/runtime/fundamentals/node/), [pinned Web Push request generation](https://github.com/web-push-libs/web-push/blob/v3.6.7/src/web-push-lib.js), [iOS Home Screen Web Push and explicit user gestures](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## 24/7 delivery follow-up — applied in production

The operator has already applied `supabase/migrations/20261023202526_remove_push_quiet_hours.sql` to production. Keep this reviewed file unchanged and do not reapply it. It replaces exactly `public.push_claim()` and `public.push_validate(uuid,uuid,uuid)`, retaining signatures, owners, SECURITY DEFINER, empty search paths and existing service-only EXECUTE grants. A missing prerequisite RPC or unsuitable migration role fails closed. The global claim advisory transaction lock serializes the repair with claimers. No triggers, policies, source events, tables, Edge Functions, secrets or schedules change.

The one-time repair recalculates future pending deadlines from the constraints that still apply. This also recovers batches whose saved timezone changed after the old deferral. It updates only eligible, unexpired, nonterminal comment/reaction/post batches with active consent/devices and a currently authorized source, excluding live leases. New deadlines respect original job due times and the two-post-batch local-day quota. Attempted batches retain a conservative full retry cooldown (up to one hour, capped at the old deadline). Legitimate grouping and retry deadlines remain protected. Existing IDs, event keys, batch assignments, expiry, attempts, reservation rows and per-device receipts remain intact. Already terminal devices are never selected again by this repair.

The old schema has no stored deferral-reason or last-attempt timestamp. Recomputing the full retry cooldown conservatively prevents accelerating a legitimate retry while allowing deferred retries to resume within at most one hour. Already leased batches retain their deadlines until their current attempt/lease ends; no in-flight send is rewritten. Expiry and source authorization remain authoritative; this change does not resurrect expired/deleted/disabled events or extend retention. The existing at-least-once relay crash window remains unchanged.

Posting reminders remain OFF by default. Enqueue remains approximately 20:00–20:29 local time, with final eligibility restricted to that same local calendar day's 20:00 hour. Own posting, recent confirmed-friend activity and the three-per-rolling-seven-day cap remain enforced. Old overnight/morning reminder batches are not released by the repair and fail the existing final eligibility gate.

### Rollout record and frontend publication

1. Backend migration: the operator reports successful application of the exact reviewed migration. No further SQL, Edge deployment, secret update or Cron change is required for this release.
2. Production smoke check: the operator reports receipt of a real Android push for a new comment after application. Overnight delivery, other categories, quotas, iPhone delivery and concurrent native database behavior have not been independently verified by the recorded audit.
3. Frontend last: after local checks, commit only the scoped migration, Notifications UI, regression tests and documentation, then push to origin/main. Check the automatic Netlify build separately; a successful Git push alone does not establish successful deployment.

If rollback is required, use a separately reviewed new forward migration restoring only the two prior function bodies (and the old next-day quota boundary). Do not replay the original Web Push migration, delete/recreate jobs or clear receipts/quotas. Recovered deadlines and already delivered notifications cannot be undone; the restored claim/validation time gates can defer subsequent nonurgent sends again.

Focused regression command: `node scripts/test-push-without-quiet-hours-postgres.mjs`. It exercises actual PostgreSQL in disposable PGlite with original discovery, Web Push, Activity and this follow-up migration, including pre-migration legacy batches and partial delivery receipts. This is not a native multi-session, hosted Supabase, Cron or Android/iPhone relay test.

Local follow-up verification: all 235 JavaScript tests, 30 JavaScript syntax checks, both existing Edge TypeScript syntax transpilation checks and the production build passed. PostgreSQL engine runs passed: 6 follow-up groups, 16 historical Web Push groups and 10 Activity groups. The follow-up includes recovery after a saved timezone change and protection of an existing future retry deadline. No remote database or real-device delivery was tested.

## Compact Notifications presentation

The dedicated Notifications screen uses one accessible, borderless preference group with subtle row dividers. All five native checkbox switches retain their existing saving behavior and explicit disabled states; the visible tracks are 40 × 24 px within 44 × 44 px hit areas. Status text and an orange dot identify an enabled device. Posting reminders remain optional and off by default. Timing guidance states that notifications can arrive anytime and device Do Not Disturb controls silencing; it does not change permission or backend behavior. Shared safe-area and bottom-navigation spacing remain unchanged.

Final UI verification: 236 JavaScript tests, 30 JavaScript syntax checks, two Edge TypeScript syntax transpilation checks, all 32 PostgreSQL regression groups (6 follow-up, 16 historical Push, 10 Activity), production build and whitespace checks passed. Chrome device emulation passed 35 layout/accessibility checks at each of 320×740, 390×844, 844×390, 320×480 and 1280×800; native Space activation toggled the switch successfully at every size. These are simulated safe-area/browser checks, not physical-iPhone testing. The reviewed migration remained byte-for-byte unchanged (SHA-256 `81aa7647212a4c8a1a5ec4d5abfdaa2a30db526a8567bb42b4d96729938500b3`).
