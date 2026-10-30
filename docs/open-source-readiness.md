# Open-source readiness — current status

**Production:** BETA v0.1.1.1 at `edf1427c9daa3080600ebfeb2a6f71ee8957cc88`.
The A01–A04 stabilization patch is prepared as **BETA v0.1.1.2**, local and unreleased.

This guide applies to the existing **private** Aurasj/azice repository and
production BETA v0.1.1.1 at main `edf1427`. Local refactoring/documentation does not authorize publication,
deployment, backend changes or further R03 investigation.

## Completed preparation

- [PR #1](https://github.com/Aurasj/azice/pull/1) is merged as
  `34b4766124d94aece509b444a61fd6cc157a465d` on main.
- GitHub CI succeeded for the [preparation PR](https://github.com/Aurasj/azice/actions/runs/40711627964)
  and the [merge commit](https://github.com/Aurasj/azice/actions/runs/40713147522).
  The earlier first-Linux-run uncertainty is superseded by those results; they do
  not establish real-device, native Deno or physical Storage correctness.
- Historical Netlify deploy `6ae2103d4d6e571a86722ca6` was ready, from main at
  that merge commit. Read-only metadata confirmed this on 2026-10-28.
- Fresh source checkouts/default builds are demo-only. Production packaging
  retains the existing public configuration. See [contributor setup](../CONTRIBUTING.md)
  and [deployment guidance](../DEPLOY.md).
- Source code/documentation use [MIT](../LICENSE); official branding/artwork is
  excluded under [BRANDING.md](../BRANDING.md). Project provenance records identify ChatGPT mascot
  provenance; the legacy/demo graphics now have the separate maintainer attestation
  recorded in BRANDING.md, without claiming independent rights verification.

The subsequent module/CSS/docs work was merged and deployed from
`refactor/project-structure`, with APP_VERSION 0.1.1.1. It preserves root adapter
compatibility while introducing the layout described in [architecture](ARCHITECTURE.md).
The production merge CI and Netlify release completed; see the current release record above.

## Recorded hosted settings

Deployment records report the following settings before the preparation branch push.
These are maintainer-reviewed facts, not a new settings/API audit by this refactor.

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
recorded subset does not establish that every secret/integration is safe.
Do not change these settings as part of documentation organization.

A preview's empty demo configuration prevents accidental production use, not a
malicious source change. The production public profile is already browser-visible;
RLS remains the authorization boundary. Never sign in with real users in untrusted
previews or supply privileged credentials to contributor-controlled builds.

## Decisions still required before public visibility

1. The legacy icons and demo illustration have a maintainer statement that they
   were created for AziCe? during initial development, not knowingly copied from
   external sources. This clarification is recorded in [BRANDING.md](../BRANDING.md);
   it is not independent verification or an MIT grant for artwork. The active demo
   illustration and historical icon URLs are retained; no artwork is replaced.
2. Publication of the previously identified Git author/committer email addresses
   and historical machine paths is accepted. No history rewrite is authorized.
   This acceptance does not cover unexpected credentials or real-user data.
3. Existing R03 details in source, tests and reachable history need a separate
   informed disclosure decision. They identify authorization and finalization gaps
   requiring a previously authenticated account. No arbitrary-user access or
   physical Storage leakage was established, but the details can reduce the effort
   needed to probe retention/quota abuse. Treat that as a material publication risk,
   not proof of harmlessness. Keep the existing repository private until disclosure
   is accepted or the risk is mitigated. Removing current notes alone would not
   remove historical versions; no deletion or history rewrite is performed.
4. Verify the public-fork approval policy and secret/integration exposure before
   visibility changes. Private-fork workflow restrictions do not establish the
   policy that will apply to a public repository. Keep preview/branch deployments off.
5. Repository visibility requires a separate authorization. This preparation
   neither changes visibility nor claims that public exposure is approved.

A local, read-only metadata recheck on 2026-10-29 covered 19 reachable commits and
four distinct author/committer email identities. Non-noreply identities and
historical machine-path matches remain. Values are deliberately not republished
here, and no history was rewritten. This was a metadata check, not a renewed full
credential audit. The identified historical identities and machine paths now have publication consent.
The existing public privacy contact remains intentional.

The [proposed screenshots](screenshots/README.md) contain synthetic data only;
the Feed capture depicts the retained, maintainer-attested demo illustration. Screenshot
privacy checks do not settle artwork licensing. The [short Activity fixture result](testing/verification-limits.md)
also remains documented, without claiming a production/device reproduction.

## Proposed GitHub About settings

Copy only after separate maintainer settings/publication approval; none are set
by this document.

- **Description:** A friends-only social PWA for sharing daily moments through photos, reactions, and comments.
- **Website:** https://azice.aagameri.tech — the actual beta, not a contributor test
  environment. Keep the local-demo instructions prominent in README.
- **Topics:** `pwa`, `progressive-web-app`, `javascript`, `vanilla-javascript`,
  `supabase`, `postgresql`, `social-app`, `friends-only`, `mobile-first`,
  `web-push`, `netlify`, `open-source`. Do not imply an audited or risk-free production service.

## Recommended final release/publication checklist

1. Retain the recorded artwork attestation and accepted historical identity/path
   publication decision. Review screenshot selection, public contact/reporting
   arrangements and the existing R03 disclosure scope separately. R03 remains
   unresolved; add no new exploit detail or production testing.
2. Review future stabilization changes against production `edf1427`. Keep APP_VERSION intentional;
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
6. After PR/maintainer authorization, separately authorize any main integration and push.
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
