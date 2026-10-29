# Verification limits and known UI result

Current guidance for the local BETA v0.1.1.1 refactor, recorded 2026-10-29.
See [architecture](../ARCHITECTURE.md) and historical
[module gates](../../tests/MODULE_TESTING.md). This authorizes no hosted testing.

| Evidence | Establishes | Does not establish |
| --- | --- | --- |
| Node/UI/adapters | Synthetic account races, interactions, media errors and configuration contracts | Live Supabase or physical Storage behavior |
| Native ESM fixtures | Real linking, exports, identity, browser-realm ownership and boot in VM contexts | Real worker controllers or device APIs |
| PGlite | SQL/RLS in disposable in-memory databases | Native multi-session locking, hosted configuration or object bytes |
| Edge transpilation | TypeScript syntax | Deno/npm resolution or deployed execution |
| Build/packaging/MIME | Allowlists, reachable modules, local content types and config selection | Netlify publication or safe hosted permissions |
| Worker models | Inventory, cached bootstrap, evaluated clients, update/rollback and failed installs | Authenticated offline use, eviction or every in-flight release race |
| Headless Chrome | Actual desktop-engine rendering/encoding with synthetic content | Physical cameras, notches/keyboards or Safari behavior |

Four optional SDK tests need the hash-verified artifact in
[SDK versions](../backend/sdk-versions.md); their transport is synthetic. Default
checks require no private config or untracked logo. Historical counts are dated
results, not a substitute for running current checks.

## Pre-existing 390×320 Activity fixture limitation

The synthetic safe-area fixture reports **“Last Activity row clears navigation”**
as false at 390×320. It existed before CSS formatting and remained identical
afterward. This is not a newly reproduced production/device defect. No correction
is included in formatting or documentation work.

Chrome 155.0.8059.85 comparisons used fresh processes per viewport, 14 synthetic
views and seven presets: 320×740, 375×812, 390×844, 430×932, 844×390 landscape,
390×320 short height and 1024×768. Safe insets were simulated. All 98 snapshots
matched before/after, including CSSOM, computed properties, pseudo-elements and
geometry across 5,166 element instances. Of 1,337 geometry assertions, 1,336
passed per run; the remaining one is the unchanged Activity result above.
The ordered contract retained 326 style rules, seven media groups and 1,186
declarations, including duplicates and order.

For separately approved acceptance checks, use the existing
[safe-area instructions](safe-areas.md) and inspect short-viewport scrolling on
physical devices. Do not infer a fix from documentation changes or remove the check.

## Screenshots and releases

[Portfolio captures](../screenshots/README.md) are real local-demo screenshots,
not backend-delivery, authorization or physical-device evidence. They use empty
configuration and no production connection.

Published CI/deployment evidence remains dated in [DEPLOY.md](../../DEPLOY.md).
Local tests of an uncommitted branch are not a new GitHub run or production release.
R03 remains unresolved and physical leakage unconfirmed; the existing
[security policy](../../SECURITY.md) and disclosure scope remain unchanged.
