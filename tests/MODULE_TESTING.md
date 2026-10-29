# Phase 1: real-module and packaging gates

Baseline: production main `34b4766124d94aece509b444a61fd6cc157a465d`, BETA v0.1.1.0.
No application source, styles, worker, backend or Netlify configuration changes.
Existing behavior tests and their assertions remain in place.

## Run

```sh
node --test tests/module-graph.test.mjs tests/module-packaging.test.mjs
npm test
npm run check
npm run test:sql
npm run build
node scripts/check-demo-build.mjs
npm run build:production
npm run build
node scripts/check-demo-build.mjs
git diff --check
```

The native module tests launch a child Node process with
`--experimental-vm-modules`; Node 24 needs this flag for SourceTextModule.
No global flags, production dependencies or package-script changes are needed.
The linker evaluates the unchanged application and dependencies in a synthetic
browser realm. It does not strip imports, append private exports or remove startup.
Each realm owns a module map; repeated/concurrent entry imports reuse one module.

The tests cover exported adapter surfaces, demo and signed-out cloud boot, exact
listener/worker-registration counts, nested imports/re-exports/dynamic literals,
cycles and invalid/missing exports. Cloud transport is synthetic; no SDK download,
credentials, permission prompt or backend request is used. Demo-only methods and
optional cloud-only APIs are intentionally distinct; the test preserves both.

Packaging tests build isolated copies using a synthetic public profile, follow
every reachable public module, compare its bytes and check JavaScript MIME types
through the actual dev server. A missing future src/ dependency fails the graph;
a module missing from the worker inventory is also detected. Servers stop before
their temporary directories are removed, including on assertion failure.

The worker fixture evaluates actual sw.js/push-sw.js with simulated network and
CacheStorage. It checks cached public-module startup, private/config interception
boundaries, an already-evaluated older client, a synthetic added module/update,
rollback to the original shell and failed precaching. It does NOT implement a real
browser worker controller, process lifecycle, eviction or device cache storage.
The offline startup test is demo-only: config.js deliberately bypasses worker fetch
interception; authenticated offline startup and the external CDN SDK are not proven.

## Optional browser checks (separate from Node verification)

```sh
node tests/fixtures/photos-browser.mjs
# http://localhost:5197/modules
node tests/fixtures/safe-area-browser.mjs
# http://localhost:5198/modules
```

The new /modules route serves the real HTML/ESM dependency graph with an empty
configuration. It never reads config.local.json or config.production.json.
Service-worker scripts deliberately return 404 here, keeping these fixture origins
uncontrolled. Existing / and query-based synthetic photo/layout checks are unchanged.
The server-level test confirms the new route and headers, not browser rendering.

With a real browser, verify module requests/MIME types, console errors, one boot,
Feed/Profile navigation and reload. For worker/controller tests use a separately
approved local demo build served with real HTTP MIME types in a fresh browser
profile: install online, reload offline, update with an old tab open, roll back,
then inspect cache versions and module requests. Do not use production configuration,
production accounts or enable permissions. Module-map/cache simulation alone cannot
prove browser timing, mixed-version lazy loads, authenticated offline behavior,
physical iPhone/Android behavior or Netlify CDN content types.

## Gates for later extractions

Keep legacy VM-based behavior coverage. Browser-dependent helpers must load in
the same realm as their DOM/canvas mocks; injecting a Node-realm function is not
equivalent. Add module-boundary regressions rather than deleting behavior tests.
The source/packaging scanner intentionally rejects external/bare ESM imports,
computed dynamic imports and inline module entries until explicitly reviewed.

When src/ first appears, the production build allowlist, worker inventory, source
syntax/security scans and exact output inventory still need their planned updates.
These tests detect omissions; they do not change those runtime/build contracts.
Documentation moves may proceed independently after link checks. R03 work remains
stopped; none of these tests starts a native database or real Supabase environment.

## Local verification — 2026-10-28

- 12 focused module/packaging gates passed.
- Full suite: 386 passed with the existing hash-verified optional SDK artifact;
  the default suite passed 382 with four explicit optional SDK skips.
- All 97 configured PGlite regression groups passed. No native PostgreSQL, R03
  integration investigation, real Auth/Storage, hosted push or native Deno
  execution was performed. Existing mocked regression tests stayed in the suite.
- 60 JavaScript syntax checks, all three Edge syntax-transpilation checks and
  config validation passed. Production/demo builds, simulated Netlify production,
  preview/branch contexts and packaging checks passed; final dist is demo-only.
- Real browser/controller, physical mobile and Netlify MIME checks were not run;
  the optional routes and acceptance steps above remain available for that review.
