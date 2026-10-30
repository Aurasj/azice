# Deployment and production status

**Production:** BETA v0.1.1.1 at `edf1427c9daa3080600ebfeb2a6f71ee8957cc88`.
The A01–A04 stabilization patch is prepared as **BETA v0.1.1.2**, local and unreleased.


[PR #2](https://github.com/Aurasj/azice/pull/2) deployed the refactor. Its
[main CI run](https://github.com/Aurasj/azice/actions/runs/40955200941) passed;
Netlify deploy `6ae3b5cd377506dda6b4462f` was published from that main commit.
This is recorded release evidence, not a deployment performed by these instructions.
[Architecture](docs/ARCHITECTURE.md) describes the module layout;
[publication readiness](docs/open-source-readiness.md) lists the separate visibility gates.

## Previous release evidence (2026-10-28)

 BETA v0.1.1.0, main at
`34b4766124d94aece509b444a61fd6cc157a465d`.
[PR #1](https://github.com/Aurasj/azice/pull/1) completed open-source preparation.
[Merge CI](https://github.com/Aurasj/azice/actions/runs/40713147522) succeeded.
Netlify's published production deploy `6ae2103d4d6e571a86722ca6` is ready at that
commit (read-only metadata verified 2026-10-28). This document deploys nothing.


## Existing build contract

- Netlify command: `node scripts/build.mjs`; publish directory: **dist**.
- Its production context generates dist/config.js from the unchanged public
  config.production.json. Privileged keys never belong in browser configuration.
- Local `npm run build` and Netlify preview/branch contexts generate demo output.
  Use `npm run build:production` only for explicit production packaging checks;
  do not open that output as a contributor sandbox. Restore demo output afterward.
- The explicit build allowlist excludes docs, tests, SQL, Edge source, local
  configuration, original logo/master, tooling and credentials. Never publish the
  repository root or commit dist. PWA identity and worker registration stay intact.

## Hosted settings and approval boundary

The recorded deployment configuration identifies main as the production branch, production-branch-only deploys
and disabled Deploy Previews. GitHub token/fork settings and remaining public-release
checks are recorded in [open-source readiness](docs/open-source-readiness.md).
Do not assume future branch/PR pushes are harmless if those settings change.

Future commits, pushes, merges and releases require their own approval. Existing
Git-connected Netlify publication follows an approved main update; no manual deploy
trigger, new site, DNS change or backend operation is required by this refactor.
Verify both GitHub checks and Netlify's published commit after any approved release;
a push or CI success alone is not proof of deployment.

## Verification before a separately approved release

From the repository root:

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run test:sql
npm run build
node scripts/check-demo-build.mjs
npm run build:production
npm run build
node scripts/check-demo-build.mjs
node scripts/check-doc-links.mjs
git diff --check
```

Compare generated production public settings with the approved profile without
logging values. Inspect the public-only package and retain a known-good frontend
artifact/commit for reviewed recovery. Do not reset user data as a release shortcut.
For module/offline/browser gates see [Phase 1 testing](tests/MODULE_TESTING.md)
and [current verification limits](docs/testing/verification-limits.md).
Mocks, PGlite and syntax transpilation do not prove physical devices, native Deno,
real Storage cleanup or authenticated offline behavior.

## Backend state — do not repeat completed operations

F02 then F06 are already applied and verified. delete-account v7 is active with
Supabase SDK 2.118.0. No SQL, Edge, secrets, RLS, Storage or scheduler change is
needed for this frontend/module/documentation refactor. [Migration status](docs/backend/migration-status.md)
is an evidence inventory, not a fabricated or repaired Supabase migration ledger.
Never bulk-apply repository migrations or replay supabase/schema.sql on production.

R03 remains unresolved and accepted for this beta; physical leakage is unconfirmed.
Further investigation is stopped. [Security policy](SECURITY.md) remains authoritative.

The complete [earlier deployment checklist](docs/archive/beta-v0.1.1.0-deployment-checklist.md)
and [stabilization report](docs/archive/beta-v0.1.1.0-stabilization.md) are historical
records, including original approvals, rollout and rollback considerations. They
are not instructions to repeat backend deployment or change production today.
