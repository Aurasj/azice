# Supabase JavaScript SDK pins (R02, local review)

## Inventory and selected version

All application Supabase JavaScript SDK references use **2.118.0**:

| Consumer | Artifact | Change |
| --- | --- | --- |
| Browser `app.js` loadSupabase | `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js` | Replaces floating @2 |
| Edge `delete-account/index.ts` | `https://esm.sh/@supabase/supabase-js@2.118.0` | Replaces floating @2 |
| Edge `push-subscriptions/index.ts` | Same exact esm.sh 2.118.0 entry | Already pinned; unchanged |
| Edge `push-dispatch/index.ts` | Same exact esm.sh 2.118.0 entry | Already pinned; unchanged |

Read-only public endpoint inspection on **2026-10-27** found:

- jsDelivr's resolve API returned version 2.118.0 for @2, and the floating UMD
  response had `x-jsd-version: 2.118.0`.
- esm.sh's floating @2 entry identified 2.118.0 and returned
  `x-esm-path: /@supabase/supabase-js@2.118.0/es2022/supabase-js.mjs`.
- npm's latest metadata also returned 2.118.0. Its five direct Supabase package
  dependencies (auth-js, storage-js, realtime-js, functions-js and postgrest-js)
  are each exactly 2.118.0; the inspected esm.sh entry references those exact versions.
- The package's declared Node engine is >=22.0.0. Local tests use Node 24.22.1.

Thus this freezes the version freshly served by both floating references, matching
the existing push functions, rather than intentionally upgrading their SDK. This
does not prove which older CDN response an installed browser or previously compiled
floating Edge deployment may have cached. No production runtime was inspected.

The application has no npm SDK dependency/manifest, import map, Deno lockfile or
SDK build dependency. `scripts/build.mjs` copies the public frontend allowlist and
does not resolve or fetch the SDK. Tests use mocks unless the optional exact-bundle
fixture below is supplied. Existing temporary PGlite/TypeScript/pg tooling contains
no application SDK dependency. No package, bundler, vendored SDK or dependency
installation is introduced. Other existing Edge imports (`web-push@3.6.7` and
`deno.land/std@0.168.0`) are already exact and remain unchanged.

## Compatibility verified locally

`tests/sdk-pinning.test.mjs` prevents floating SDK URL/npm/jsr references across
browser, Edge, test and build source, checks all four production entry points, and
checks exact Supabase versions in any future build/test package dependencies.
It explicitly rejects major-only, latest, caret, tilde, wildcard and unversioned
references. A service-worker fixture verifies external SDK requests are unhandled
and app.js remains network-first with cached-shell fallback.

Four additional tests execute the actual pinned UMD bundle in a Node VM with Web
APIs and a strictly synthetic fetch implementation. They do not replace createClient
with a mock and cannot send a request to a real service. They verify:

- Password sign-in, explicit token refresh, signup request/response, Google OAuth
  URL construction (without navigation), persisted primary session, verified
  getUser, profile selection, RPC response shapes and SDK version headers.
- The production recovery adapter's reset redirect, PKCE challenge/shared verifier,
  code exchange, isolated tab-local recovery session, implicit setSession and
  token-hash verification, password update and local sign-out. The normal
  account/session remains unchanged.
- Private Storage upload with the original JPEG Blob/MIME and authenticated header,
  list, Blob download and returned remove errors/success responses.
- Edge-style getUser(token), global-Authorization getUser(), admin.deleteUser and
  authenticated functions.invoke APIs used by the existing functions/application.

The artifact is downloaded only for local testing, into the ignored
`supabase/.temp/sdk-pinning-tests` directory. It is not shipped or committed.
Observed UTF-8 bundle size: **218544 bytes**. SHA-256:
`bee24fc29228ed5a370f76a2ba1ca3c399549edad2fef23453c80148856a49af`.
The tests check this hash before executing the bundle. This is a test-fixture check;
the production loader's architecture is unchanged and no SRI feature is added.

To reproduce the real-bundle tests without installing a package:

```powershell
$sdkDirectory = Join-Path (Get-Location) 'supabase/.temp/sdk-pinning-tests'
New-Item -ItemType Directory -Force -Path $sdkDirectory | Out-Null
$sdkArtifact = Join-Path $sdkDirectory 'supabase-2.118.0.umd.js'
Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js' -OutFile $sdkArtifact
Get-FileHash -Algorithm SHA256 -LiteralPath $sdkArtifact
$env:AZICE_TEST_SUPABASE_UMD = $sdkArtifact
node --test tests/sdk-pinning.test.mjs
node --test tests/*.test.mjs
Remove-Item Env:AZICE_TEST_SUPABASE_UMD
```

Tests never download code themselves. Without AZICE_TEST_SUPABASE_UMD the three
source/cache guards run and the four artifact smoke tests are explicitly skipped.
The reported full verification for this change supplies the fixture, so those four
tests actually run. Review version/hash changes deliberately on future SDK upgrades.

Local verification passed: 353 JavaScript tests with no skips (including all seven
SDK tests), 97 PGlite regression groups, 44 JavaScript syntax checks, syntax
transpilation for all three Edge Functions, the production build and whitespace
checks. Native Deno and hosted service integration were not executed.

## CDN, PWA and deployment considerations

Observed cache headers:

- Floating jsDelivr @2: `public, max-age=604800, s-maxage=43200`.
- Floating esm.sh @2: `public, max-age=600`.
- Exact jsDelivr 2.118.0: `public, max-age=31536000, s-maxage=31536000, immutable`.
- Exact esm.sh 2.118.0: `public, max-age=31536000, immutable`.

The pinned browser URL is a different HTTP cache key from @2. Once the network-first
app shell loads the new app.js, a fresh page loads the exact URL; an old open page
continues running its loaded code until reload. The worker still caches only its
same-origin public shell. It does not intercept/cache SDK CDN requests, user data
or private photos. No cache-name, worker registration, manifest or push change is
needed. A cold offline launch without an HTTP-cached SDK still cannot initialize
cloud mode; this pre-existing limitation is deliberately not expanded into a new
offline feature. Cached older app.js can still contain the older floating URL until
the application returns online and reloads successfully.

After a future frontend deployment, reload online and inspect the SDK script URL
to confirm the exact version; then test a warm offline launch separately.

Release update: **delete-account v7 is ACTIVE**, with JWT verification enabled
and no import map. Retrieved production source matches the reviewed SDK-2.118.0
file. Do not redeploy it during final frontend publication. The browser pin takes
effect through the approved BETA v0.1.1.0 frontend release. Push functions already
pin this version and remain unchanged. No SQL, secrets or scheduling changes are
needed for the SDK pins. See ../DEPLOY.md.

Root versions and the five observed Supabase components are pinned. This does not
create a fully hermetic Deno dependency graph: esm.sh build infrastructure/polyfills
and other third-party transitive dependencies remain outside a checked-in Deno lock.
No lockfile was invented without native Deno verification.

Native Deno is not available in the checked PATH/common installation locations.
UMD execution under Node and mocked Edge handler tests do not establish native Deno
or hosted Edge runtime compatibility. When available, run the existing native Deno
checks for all three function entry points with these pinned imports, followed by
isolated Supabase staging checks of sign-in/refresh/OAuth, recovery email callbacks,
Storage API behavior and account deletion. The server-side ESM entry was fetched
successfully and inspected, but not executed in Deno. No live Auth, Storage, Edge
account deletion, relay delivery or physical-device end-to-end test is claimed.
