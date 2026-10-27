# AziCe? — mobile-first friends-only PWA

Production baseline: **BETA v0.1.0.2**, commit `1b0e899`.
Prepared local release: **BETA v0.1.1.0**, branch `stabilization/beta-v0.1.1.0`.
Preparation does not mean deployed or approved for unrestricted public use.

AziCe? is an existing static JavaScript PWA using Supabase Auth/Database/private
Storage and Netlify at https://azice.aagameri.tech. Feed, Friends & Invites,
private profiles/calendar, Activity and optional Web Push already exist. Post
photos remain camera-only (maximum three); the shared publishing limit is three
posts per configured local calendar day. Friends are reached from Feed, with
invitation links, exact-username requests and authorized comment-author discovery.

## Local development

Use Node.js 24 (local verification: 24.22.1):

```sh
node server.mjs
```

Open http://localhost:5173. This is a development source server, not a production
publish configuration. **Current config.js contains public production connection
settings: loading the browser app may contact production.** Do not use it for
destructive tests. Prefer mock-based tests or a separately approved disposable
configuration. Cloud mode is enabled when the public URL/key are present; the
labeled demo is used only when they are absent. Do not change production config
merely to run tests.

Never put service-role keys, private VAPID keys, SMTP credentials or access tokens
in frontend files. Publishable/anon keys and the public VAPID key are intentionally
browser-visible. The browser SDK is pinned to **2.118.0**; see
[SDK_VERSIONS.md](supabase/SDK_VERSIONS.md) for compatibility and caching limits.

## Build and checks

```sh
node --test tests/*.test.mjs
node --check app.js
node --check cloud.js
node scripts/build.mjs
git diff --check
```

The build is static packaging, not a bundler/minifier. It validates public config
and recreates **dist/** from an explicit allowlist, including **push-sw.js**.
SQL, Edge source, tests, docs, development tooling and original logo/master are
excluded. Never publish the repository root or commit generated dist/.

Optional real-SDK smoke tests need the hash-verified ignored artifact documented
in [SDK_VERSIONS.md](supabase/SDK_VERSIONS.md); otherwise four tests explicitly skip.
PostgreSQL/PGlite/native prerequisites and evidence boundaries are documented in
[NATIVE_POSTGRES_TESTS.md](supabase/NATIVE_POSTGRES_TESTS.md). Mock tests and SQL
metadata fixtures are not hosted Auth/Storage or physical Android/iPhone tests.
The standard JavaScript suite and build need no application package installation.

## Deployment and migration status

Existing [netlify.toml](netlify.toml) sets build command
**node scripts/build.mjs** and publish directory **dist**. Use the existing
Git-connected main workflow only after approval; no new site or DNS setup.

Read [DEPLOY.md](DEPLOY.md) and [MIGRATION_STATUS.md](supabase/MIGRATION_STATUS.md).
Never rerun schema.sql on production, bulk-apply repository migrations, invent
migration-history rows or repair the ledger without separate review.
The release's **F02 then F06** changes are already applied and verified.
**delete-account v7** is ACTIVE with the SDK pin. Do not repeat those backend
steps during final frontend publication.

## Remaining beta limitations

F01–F07 and R02 are implemented locally. **R03 remains an unresolved account-deletion
concurrency risk**: native SQL/mock tests expose authorization/timing gaps, but
surviving physical Storage objects have **not** been verified. Real R03/F03 Storage
integration was blocked; the owner has stopped further R03 integration work for
this beta. See [ACCOUNT_DELETION_R03.md](supabase/ACCOUNT_DELETION_R03.md) and
[R03_LOCAL_INTEGRATION_ATTEMPT.md](supabase/R03_LOCAL_INTEGRATION_ATTEMPT.md).
This is a recorded risk, not a fix or complete-erasure guarantee. Native Deno and
real Storage failure cleanup remain unverified. The owner explicitly accepted
R03's unresolved risk for this beta; acceptance does not establish complete erasure.

Safety & Privacy: [aagameriaa@gmail.com](mailto:aagameriaa@gmail.com).
Auth sender/SMTP configuration is separate; see
[PASSWORD_RECOVERY.md](supabase/PASSWORD_RECOVERY.md).
