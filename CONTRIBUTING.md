# Contributing to AziCe?

The application source code and documentation are MIT-licensed under LICENSE.
Official branding and bundled artwork are excluded; read BRANDING.md before
creating a separate distribution. Repository visibility still needs maintainer authorization.
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
node scripts/check-doc-links.mjs
```

- npm test uses synthetic/mocked backend responses. Four optional real-SDK tests
  explicitly skip unless AZICE_TEST_SUPABASE_UMD points to the hash-verified artifact
  described in docs/backend/sdk-versions.md. They never download/visit a backend.
- Default branding tests verify the committed master core's decoded-pixel hash,
  icon format/sizing, safe zone and PWA references. They need no assets/logo.png.
  To additionally compare a maintainer-held original, set AZICE_BRANDING_SOURCE to its
  absolute path and run `node --test tests/branding.test.mjs`. Do not commit that
  authoring asset implicitly or change its rights/licensing. BRANDING.md records
  maintainer-attested mascot and legacy/demo provenance, distinguished from
  independent rights verification. All bundled artwork remains reserved.
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
changing for this code path. See docs/open-source-readiness.md for settings still needing review.

GitHub CI acquires dependencies first, then uses a Linux loopback-only network
namespace for `npm run ci:offline`. That script runs the commands above and checks
demo packaging; it does not itself configure OS networking when run manually.
The Linux setup passed in PR #1 and the production merge CI run; links are in
[open-source readiness](docs/open-source-readiness.md). This does not prove real
Storage, native Deno or physical-device behavior.

Use the [documentation index](docs/README.md) to distinguish current guides from
archived release evidence. Phase 1 module gates remain in [tests](tests/MODULE_TESTING.md).

## Where to work

- [Architecture](docs/ARCHITECTURE.md) maps ownership and trust boundaries.
  `app.js` remains the stateful UI coordinator. Adapter implementations are in
  `src/cloud.js` and `src/demo.js`; root files are compatibility exports, not a
  second implementation. Preserve their public URLs and export/function identity.
- Presentation, Auth/recovery and image helpers live in `src/`. Keep account,
  camera and upload lifecycle changes out of independent helpers.
- `styles.css` is the only production stylesheet. Its later overrides are
  intentional. CSS property assertions ignore formatting, while the complete
  ordered snapshot detects selector/declaration/media changes. Update that
  snapshot only for a reviewed intentional style change, not to hide a regression.
- Read [verification limits](docs/testing/verification-limits.md), including the
  pre-existing short Activity fixture result. A local screenshot or PGlite pass
  is not real-device or hosted-backend verification.
- Use [synthetic screenshot guidance](docs/screenshots/README.md) for visual
  evidence. Never attach real users, photos, tokens or personal invitation links;
  underlying artwork rights still need review even in a screenshot.

Current module documentation supersedes checkpoint-specific paths in archived
notes. The local refactor has not yet been committed, pushed or deployed; earlier
PR #1 CI results do not validate an unpublished branch.

## Pull requests

Open a focused issue/PR describing the problem, scope and tests actually run.
Preserve the mobile dark/orange design, accessibility, camera-only post capture,
privacy checks and existing features. Do not bump APP_VERSION automatically.

Keep generated dist/, node_modules, local configuration, logs, user photos and
credentials out of commits. Preserve unrelated files. Use forward-only reviewed
SQL for backend changes; never reapply schema.sql on an existing database or
repair migration history to bypass a failed prerequisite. Production SQL, Edge
deployment and service changes need separate explicit maintainer authorization.

Report security concerns privately as described in SECURITY.md. Do not reproduce
R03 against production; its accepted beta risk is not authorization to test users.
Use respectful, constructive discussion. There is no promised support SLA.
