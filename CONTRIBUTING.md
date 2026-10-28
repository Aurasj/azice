# Contributing to AziCe?

The application source code and documentation are MIT-licensed under LICENSE.
Official branding and bundled artwork are excluded; read BRANDING.md before
creating a separate distribution. Repository visibility still needs owner approval.
Contributions to source code are submitted under the same MIT terms. Identify any
third-party material and its license; do not submit artwork without its provenance
and permission. No copyright assignment or separate contributor agreement is added.

## Setup

Use Node.js 24 and npm. No production credentials are needed:

```sh
npm ci --ignore-scripts
npm run dev
```

Open http://localhost:5173. A fresh checkout runs the existing labeled local demo.
Its posts/accounts are local sample data; it makes no Supabase connection. The
loopback development server serves source files: do not expose it with a tunnel.

For your own disposable Supabase environment, copy config.example.json to
**config.local.json** (ignored) and fill in only its public URL, publishable/anon
key and optional public VAPID key. Restart/reload the dev server. Never use real
production accounts, a service-role/secret key or a private VAPID key. The local
override rejects the production project's URL. See scripts/config.mjs.

The actual production values remain in config.production.json. They are public
browser settings, not secrets; separating them prevents accidental connections,
not discovery of an already-public endpoint. The source page never loads this
profile. Do not copy it into your local override or change it in ordinary PRs.

## Verification

```sh
npm test
npm run check
npm run test:sql
npm run build
```

- npm test uses synthetic/mocked backend responses. Four optional real-SDK tests
  explicitly skip unless AZICE_TEST_SUPABASE_UMD points to the hash-verified artifact
  described in supabase/SDK_VERSIONS.md. They never download/visit a backend.
- Default branding tests verify the committed master core's decoded-pixel hash,
  icon format/sizing, safe zone and PWA references. They need no assets/logo.png.
  To additionally compare an owner-held original, set AZICE_BRANDING_SOURCE to its
  absolute path and run `node --test tests/branding.test.mjs`. Do not commit that
  authoring asset implicitly or change its rights/licensing. BRANDING.md records
  owner-confirmed mascot provenance and the pending legacy/demo artwork review.
- npm run check checks JavaScript/Edge syntax and public configuration offline.
  TypeScript transpilation is not native Deno execution.
- npm run test:sql uses the locked PGlite dependency and new in-memory databases,
  not production PostgreSQL or real Storage bytes. Native runners remain explicit
  opt-in tools; their existing safety marker/loopback requirements must remain.
  Historical setup commands under supabase/.temp are not needed for these checks.
- npm run build creates **demo-only dist/**. `--local` is an explicit optional
  build using your ignored disposable configuration. No build deploys anything.

Production packaging is a maintainer-only offline check: `npm run build:production`.
That output points at production if opened, so do not use it for contributor or
fork previews. Existing Netlify production builds select the same public profile
automatically; Netlify previews/branches always use demo. No hosted settings need
changing for this code path. See OPEN_SOURCE.md for settings still needing review.

GitHub CI acquires dependencies first, then uses a Linux loopback-only network
namespace for `npm run ci:offline`. That script runs the commands above and checks
demo packaging; it does not itself configure OS networking when run manually.
The namespace setup is Linux-specific and needs its first hosted-run verification.

## Pull requests

Open a focused issue/PR describing the problem, scope and tests actually run.
Preserve the mobile dark/orange design, accessibility, camera-only post capture,
privacy checks and existing features. Do not bump APP_VERSION automatically.

Keep generated dist/, node_modules, local configuration, logs, user photos and
credentials out of commits. Preserve unrelated files. Use forward-only reviewed
SQL for backend changes; never reapply schema.sql on an existing database or
repair migration history to bypass a failed prerequisite. Production SQL, Edge
deployment and service changes need separate explicit owner approval.

Report security concerns privately as described in SECURITY.md. Do not reproduce
R03 against production; its accepted beta risk is not authorization to test users.
Use respectful, constructive discussion. There is no promised support SLA.
