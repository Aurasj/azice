# Open-source readiness — current status

This guide applies to the existing **private** Aurasj/azice repository and
production BETA v0.1.1.0, with BETA v0.1.1.1 prepared locally. Local refactoring/documentation does not authorize publication,
deployment, backend changes or further R03 investigation.

## Completed preparation

- [PR #1](https://github.com/Aurasj/azice/pull/1) is merged as
  `34b4766124d94aece509b444a61fd6cc157a465d` on main.
- GitHub CI succeeded for the [preparation PR](https://github.com/Aurasj/azice/actions/runs/40711627964)
  and the [merge commit](https://github.com/Aurasj/azice/actions/runs/40713147522).
  The earlier first-Linux-run uncertainty is superseded by those results; they do
  not establish real-device, native Deno or physical Storage correctness.
- Netlify's published deploy `6ae2103d4d6e571a86722ca6` is ready, from main at
  that merge commit. Read-only metadata confirmed this on 2026-10-28.
- Fresh source checkouts/default builds are demo-only. Production packaging
  retains the existing public configuration. See [contributor setup](../CONTRIBUTING.md)
  and [deployment guidance](../DEPLOY.md).
- Source code/documentation use [MIT](../LICENSE); official branding/artwork is
  excluded under [BRANDING.md](../BRANDING.md). The owner confirmed ChatGPT mascot
  provenance; the three legacy/demo graphics still need their separate review.

The subsequent module/CSS/docs work remains local and uncommitted on
`refactor/project-structure`, with APP_VERSION 0.1.1.1. It preserves root adapter
compatibility while introducing the layout described in [architecture](ARCHITECTURE.md).
No GitHub CI or Netlify result is claimed for that unpublished work.

## Hosted settings reviewed by the owner

The owner reported the following settings before the preparation branch push.
These are owner-reviewed facts, not a new settings/API audit by this refactor.

| Service | Reviewed setting |
| --- | --- |
| Netlify | Production branch main; branch deploys production branch only; Deploy Previews disabled. |
| GitHub Actions | Default token can read contents/packages; Actions cannot create/approve PRs; fork PR workflows disabled. |

The committed workflow is read-only and has pull_request plus push-to-main
triggers, SHA-pinned Actions, no secret references and no deployment. Dependency
installation precedes loopback-only test execution on the Linux runner. A branch
push alone does not trigger this workflow; a PR or main push can.

Recheck settings after any change. Before public contributions, review inherited
secrets, environment scopes, apps/webhooks/build hooks, preview access protection,
main rulesets/bypasses, fork approvals and private vulnerability reporting. The
owner's reported subset does not establish that every secret/integration is safe.
Do not change these settings as part of documentation organization.

A preview's empty demo configuration prevents accidental production use, not a
malicious source change. The production public profile is already browser-visible;
RLS remains the authorization boundary. Never sign in with real users in untrusted
previews or supply privileged credentials to contributor-controlled builds.

## Decisions still required before public visibility

1. Confirm provenance/rights for assets/icon-192.png, assets/icon-512.png and
   assets/demo-beer.svg, and review copyright attribution.
2. Explicitly consent to existing personal author/committer metadata, historical
   machine paths and the intentional public privacy contact. The earlier review
   covered 17 commits before the preparation merge; it is not an assertion about
   the current history length or an exhaustive credential audit.
3. Approve disclosure scope for existing R03 notes and reproduction evidence.
   R03 remains unresolved; physical Storage leakage is unconfirmed. Accepted beta
   risk is not an erasure guarantee or permission to resume investigation.
4. Approve any synthetic portfolio screenshots and the final GitHub/Netlify
   settings review. No real users, photos, credentials or invitation links.
5. Separately approve repository visibility. No visibility change occurs here.

A local, read-only metadata recheck on 2026-10-29 covered 19 reachable commits and
four distinct author/committer email identities. Non-noreply identities and
historical machine-path matches remain. Values are deliberately not republished
here, and no history was rewritten. This was a metadata check, not a renewed full
credential audit. Public privacy contact details also require intentional consent.

The [proposed screenshots](screenshots/README.md) contain synthetic data only;
the Feed capture still depicts the uncleared legacy demo illustration. Screenshot
privacy checks do not settle artwork licensing. The [short Activity fixture result](testing/verification-limits.md)
also remains documented, without claiming a production/device reproduction.

## Proposed GitHub About settings

Copy only after the owner's separate settings/publication approval; none are set
by this document.

- **Description:** A mobile-first, friends-only PWA built with vanilla JavaScript
  and Supabase, with private media, daily check-ins, Web Push and a backend-free
  contributor demo.
- **Website:** https://azice.aagameri.tech — the actual beta, not a contributor test
  environment. Keep the local-demo instructions prominent in README.
- **Topics:** `pwa`, `vanilla-javascript`, `supabase`, `postgresql`,
  `row-level-security`, `web-push`, `netlify`, `mobile-first`, `testing`,
  `portfolio-project`. Do not imply an audited or risk-free production service.

## Recommended final release/publication checklist

1. Approve legacy artwork provenance, screenshot selection, historical identity
   metadata, public contact/reporting arrangements and the existing R03 disclosure
   scope. R03 remains unresolved; add no new exploit detail or production testing.
2. Review the entire local diff against `34b4766`. Keep APP_VERSION intentional;
   check both compatibility shims and all reachable `src/` modules. Leave unrelated
   authoring assets, patches/tooling, credentials and generated output unstaged.
3. Run contributor tests, syntax/PGlite checks, demo/production packaging and link,
   whitespace/credential checks. Restore demo output. Read
   [verification boundaries](testing/verification-limits.md) before describing results.
4. Recheck GitHub rulesets/bypasses, review/status requirements, token permissions,
   fork approvals, secrets/integrations and private vulnerability reporting. For
   main, require PR review and contributor CI, restrict direct pushes/bypasses and
   disallow force pushes/deletion. Verify Netlify production-branch-only deploys,
   disabled previews and environment scopes; if previews are later enabled, review
   fork approval and secrets access first. Local demo mode alone is insufficient.
5. Obtain separate authorization before a local commit, private branch push or PR.
   A PR may run CI; do not infer the current branch passed from old PR #1 results.
   Do not rewrite history, force-push or publish repository visibility as a shortcut.
6. After PR/owner approval, separately authorize any main integration and push.
   Existing Netlify automation may then publish the frontend: verify the actual
   published commit and smoke-test the approved artifact. Do not manually trigger
   deployment, reapply SQL, redeploy Edge Functions or change schedules/secrets.
7. Only after those decisions, separately approve public visibility and About
   settings. Retain [DEPLOY.md](../DEPLOY.md) as the operator checklist and update
   status prose to match verified facts, not planned actions.

See [SECURITY.md](../SECURITY.md) for reporting and testing boundaries and the
[documentation index](README.md) for backend/test evidence.

## Historical evidence

The complete [preparation checkpoint](archive/open-source-preparation-2026-10-28.md)
retains its original inventory, baseline and pre-push checklist. Those describe
what was pending then, not what remains pending now. Release/deployment records
are indexed under [archive](README.md#archive). No Git history was rewritten.
