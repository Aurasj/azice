# Documentation

**Production:** BETA v0.1.1.1 at `edf1427c9daa3080600ebfeb2a6f71ee8957cc88`.
The A01–A04 stabilization patch is prepared as **BETA v0.1.1.2**, local and unreleased.

Start with [README](../README.md) and [contributor setup](../CONTRIBUTING.md).
This index separates current guidance, technical evidence and historical records.
All shell commands assume the repository root unless a guide explicitly says otherwise.

## Current project and release guidance

- [Architecture](ARCHITECTURE.md): coordinator, `src/` helpers/adapters, compatibility
  entries, backend trust boundaries, notifications, build and PWA caching.
- [Deployment and production status](../DEPLOY.md): BETA v0.1.1.1 at main `edf1427`.
- [Open-source readiness](open-source-readiness.md): merged PR #1, successful CI,
  reviewed settings and decisions still required before public visibility.
- [Security policy](../SECURITY.md), [branding/artwork](../BRANDING.md) and [license](../LICENSE).
- [Portfolio screenshots and provenance](screenshots/README.md): real local-demo
  captures, synthetic data, isolation checks and remaining artwork approval.

This describes the deployed BETA v0.1.1.1 refactor. The present stabilization patch remains local.
Production evidence is dated in DEPLOY.md; historical PR #1 CI does not establish
that unpublished local changes have run on GitHub.

## Backend

- [Migration status and evidence boundaries](backend/migration-status.md)
- [Comment-author discovery](backend/comment-discovery.md)
- [Friendship helper permissions (F02)](backend/friendship-helper-security.md)
- [Username friend requests](backend/username-friend-requests.md)
- [Activity and bounded unread state (F06)](backend/activity.md)
- [Daily posting cap](backend/daily-posting-cap.md)
- [Post upload recovery (F03)](backend/post-upload-recovery.md)
- [Password recovery](backend/password-recovery.md)
- [Pinned SDK versions](backend/sdk-versions.md)
- [Web Push architecture and historical setup](backend/web-push.md)

These guides describe existing functionality. Initial setup/rollout sections are
historical or for separately approved fresh environments, not authorization to
reapply migrations, rerun schema.sql or redeploy the current backend.
Executable SQL, migration filenames, function paths and configuration remain in
supabase/ unchanged; documentation moves do not modify a migration ledger.

## Testing

- [Current verification boundaries and short Activity fixture limitation](testing/verification-limits.md)
- [Phase 1 real-module, packaging and worker-model gates](../tests/MODULE_TESTING.md)
- [Photo checks and Android/iPhone acceptance steps](testing/photos.md)
- [Safe-area checks and Safari/PWA acceptance steps](testing/safe-areas.md)
- [Historical native PostgreSQL verification and opt-in prerequisites](testing/postgres.md)

Default checks use synthetic responses and PGlite. Historical counts describe the
recorded run, not a current test result. Native Deno, physical devices and real
Storage/controller behavior require separate verification; CI success is not proof
of those properties. No R03 investigation is authorized or resumed.

## Security evidence

- [Account-deletion concurrency risk: unresolved](security/account-deletion-r03.md)
- [Earlier local integration attempt and evidence limits](security/r03-local-integration-attempt.md)

R03 is an accepted unresolved beta risk; physical Storage leakage is unconfirmed.
These are existing records, not new exploit guidance or permission to test users.
Public disclosure remains an explicit owner decision.

## Archive

- [BETA v0.1.1.0 stabilization report](archive/beta-v0.1.1.0-stabilization.md)
- [Superseded stabilization handoff](archive/stabilization-handoff.md)
- [Earlier deployment checklist](archive/beta-v0.1.1.0-deployment-checklist.md)
- [Open-source preparation checkpoint](archive/open-source-preparation-2026-10-28.md)

Archives retain original plans, baselines, approvals and useful evidence. Their
past-tense status/paths must not override current guidance or trigger operations.

## Phase 2 move inventory

The former paths below are historical names; the linked destinations are current.
README.md, CONTRIBUTING.md, SECURITY.md, BRANDING.md, LICENSE and DEPLOY.md stay at root.

| Former source | Current destination |
| --- | --- |
| `PHOTO_TESTING.md` | [testing/photos.md](testing/photos.md) |
| `SAFE_AREA_TESTING.md` | [testing/safe-areas.md](testing/safe-areas.md) |
| `OPEN_SOURCE.md` | [open-source-readiness.md](open-source-readiness.md) |
| `STABILIZATION_RELEASE.md` | [archive/beta-v0.1.1.0-stabilization.md](archive/beta-v0.1.1.0-stabilization.md) |
| `GEMINI_NEXT_STEP.md` | [archive/stabilization-handoff.md](archive/stabilization-handoff.md) |
| `supabase/NATIVE_POSTGRES_TESTS.md` | [testing/postgres.md](testing/postgres.md) |
| `supabase/SDK_VERSIONS.md` | [backend/sdk-versions.md](backend/sdk-versions.md) |
| `supabase/ACTIVITY.md` | [backend/activity.md](backend/activity.md) |
| `supabase/COMMENT_DISCOVERY.md` | [backend/comment-discovery.md](backend/comment-discovery.md) |
| `supabase/DAILY_POSTING_CAP.md` | [backend/daily-posting-cap.md](backend/daily-posting-cap.md) |
| `supabase/FRIENDSHIP_HELPER_SECURITY.md` | [backend/friendship-helper-security.md](backend/friendship-helper-security.md) |
| `supabase/MIGRATION_STATUS.md` | [backend/migration-status.md](backend/migration-status.md) |
| `supabase/PASSWORD_RECOVERY.md` | [backend/password-recovery.md](backend/password-recovery.md) |
| `supabase/POST_UPLOAD_RECOVERY.md` | [backend/post-upload-recovery.md](backend/post-upload-recovery.md) |
| `supabase/USERNAME_FRIEND_REQUESTS.md` | [backend/username-friend-requests.md](backend/username-friend-requests.md) |
| `supabase/WEB_PUSH.md` | [backend/web-push.md](backend/web-push.md) |
| `supabase/ACCOUNT_DELETION_R03.md` | [security/account-deletion-r03.md](security/account-deletion-r03.md) |
| `supabase/R03_LOCAL_INTEGRATION_ATTEMPT.md` | [security/r03-local-integration-attempt.md](security/r03-local-integration-attempt.md) |

The two additional archive snapshots preserve the former OPEN_SOURCE.md and
DEPLOY.md bodies. Superseded file inventories intentionally retain original names.

<details>
<summary>Other Phase 2 changed paths (review inventory)</summary>

Besides the 18 source/destination moves above, Phase 2 updates/adds:

- Root guidance/navigation: README.md, CONTRIBUTING.md, SECURITY.md, BRANDING.md, DEPLOY.md.
- New index: docs/README.md.
- Additional original-body snapshots: docs/archive/open-source-preparation-2026-10-28.md
  and docs/archive/beta-v0.1.1.0-deployment-checklist.md.
- Documentation-only checker/test: scripts/check-doc-links.mjs, tests/docs.test.mjs.
- Comment/setup-message document references only: scripts/test-account-deletion-native-postgres.mjs,
  scripts/test-activity-postgres.mjs, scripts/test-comment-discovery-postgres.mjs,
  scripts/test-daily-posting-postgres.mjs, scripts/test-stabilization-native-postgres.mjs,
  scripts/test-username-friends-postgres.mjs, tests/sdk-pinning.test.mjs.

At completion of Phase 2, all ten pre-existing Phase 1 files were byte-identical,
and runtime/build/backend files were unchanged; its named native runners were not
executed. Later approved phases adapted relevant module fixtures and packaging.
This inventory preserves that checkpoint, not a claim about the current total diff.

</details>
