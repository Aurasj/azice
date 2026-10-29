> **Archived open-source preparation checkpoint — historical, not current instructions.**
> Original baselines, plans, approvals and test results below describe their recorded
> point in time. PR #1 is now merged, CI passed and production main is `34b4766`.
> See [current deployment guidance](../../DEPLOY.md) and the
> [documentation index](../README.md). Do not repeat completed operations.

# Publication decisions and settings — owner review required

Target: the existing Aurasj/azice repository. Nothing here changes visibility,
permissions, deployments or production data. No history rewrite is proposed.

## Local changes prepared

Fresh checkouts/source config, default builds and Netlify previews are demo-only.
config.local.json is ignored, validated and limited to a nonproduction project.
The exact existing production public values are retained in config.production.json;
only explicit local production packaging or Netlify's production context uses it.
These are browser-visible values, not a new secret store. Existing Netlify command
`node scripts/build.mjs`, dist publish directory, headers, runtime features,
APP_VERSION 0.1.1.0, PWA identity, service worker and backend are unchanged.

The new package/lock contain test tools only. CI uses pinned official Actions,
Node 24, read-only contents permissions, no stored credentials, no production
backend, no deployment and no pull_request_target. PGlite is not hosted SQL.
After dependencies are acquired, CI runs checks in a Linux network namespace
with only loopback enabled, dropping back to the ordinary runner user before
executing tests. This blocks accidental production/internet calls during checks;
workflow changes are still untrusted code requiring review. That Linux runner
setup must be confirmed on its first GitHub run; local Windows tests do not prove it.
Four optional SDK transport smoke tests skip unless the known fixture is supplied;
default branding integrity checks use committed artifacts, not an untracked logo.

## Required GitHub review before public contributions

- Add a main branch rule/ruleset: PRs, passing **Contributor checks**, resolved
  conversations; deny force pushes and deletion. Review administrator bypasses.
- Require one approval when another maintainer is available. Avoid an impossible
  self-approval requirement for a solo maintainer; document the chosen exception.
- Explicitly review changes to authentication, SQL, Edge Functions, workflow/build
  scripts and deployment configuration. Optional CODEOWNERS can assign that review.
- Enable secret scanning/push protection where available. Run a dedicated redacted
  history scan before visibility changes; local pattern checks are not proof of
  absence. Review any future Actions logs/artifacts before making them public.
- Enable private vulnerability reporting and approve SECURITY.md's contact/support
  process. Issue templates are not a private security-reporting channel.

## Required Netlify review

- Keep production deployment limited to reviewed main updates. Preserve the
  existing command, dist publication and production service configuration.
- For untrusted PRs, require approval or withhold sensitive variables. Do not use
  “Deploy without restrictions.” Review the proposed code before approval.
- Keep privileged credentials out of frontend/build contexts that do not need
  them. This static build needs only the tracked public profile; it does not read
  production secret environment variables.
- Preview code is untrusted even when it defaults to demo. Never sign in with real
  production accounts in a contributor-controlled preview. Do not add broad Auth
  redirects to make fork previews work with production.
- A public configuration URL/key is already browser-visible. Separating the profile
  prevents accidental use, not discovery or abuse; RLS remains the authorization
  boundary. No keys were rotated and no hosted policy was inspected/changed here.

## Explicit owner decisions still outstanding

1. Confirm origin/rights for the legacy assets/icon-192.png, assets/icon-512.png
   and assets/demo-beer.svg before publication. The owner has authorized MIT for
   source code and reserved official branding. LICENSE now records that scope;
   BRANDING.md records the confirmed ChatGPT mascot provenance. All bundled art
   is excluded from MIT. Package metadata points to LICENSE, with publishing private.
   Review the public copyright attribution, "2026 Aurasj and contributors".
2. Consent to historical author/committer personal email and machine-specific paths
   already present in Git history/docs. Future no-reply addresses or deleting a
   current line do not conceal earlier history. No private values are repeated here.
   The audit found one author/committer identity across the 17 published commits;
   a machine-specific command example is in supabase/ACCOUNT_DELETION_R03.md.
   The intentionally public Safety & Privacy contact is also an owner decision.
3. Approve public disclosure of the existing R03 investigation and reproduction
   details. Acceptance for this beta is not automatically approval for public
   disclosure. Physical leakage remains unconfirmed; the risk is not fixed.
   Do not add more security-sensitive publicity or resume integration work here.
4. Approve safe synthetic screenshots if desired; none were fabricated and real
   accounts/photos/invitation links must not appear in portfolio screenshots.
5. Approve the GitHub/Netlify settings above and, separately, repository visibility.
   Making a repository private later cannot recall other people's copies/forks.

Preserve the five unrelated untracked files. In particular, assets/logo.png is
not implicitly approved for a public commit by making its tests reproducible.
Operational files, ignored .temp databases/artifacts, dist, .env files and local
tool state must never be included in an accidental workspace archive or mirror push.

## History review and remaining disclosure limits

Local read-only review on 2026-10-28 covered all 17 commits reachable from local
refs and 199 text blob versions. One author/committer email identity appears across
all 17 commits and is potentially personal; the actual address is not repeated
here. A machine-specific path appears in historical versions of
supabase/ACCOUNT_DELETION_R03.md. The deliberate public privacy contact in current
UI/docs is another owner consent decision. No history was rewritten or fetched.

Pattern checks found no privileged-role JWT, recognized private-key block or
recognized provider credential token in the scanned historical text. This is not
an exhaustive secret-scanner attestation; binary files, remote-only refs, hosted
logs/artifacts and hosted settings are not cleared by this review. R03 operational
notes, test barriers and reproduction code already exist in history; approving
source licensing does not approve their public disclosure. Keep the current risk
warning, do not publicize additional exploit detail, and obtain explicit disclosure
approval before visibility changes. Physical Storage leakage is still unconfirmed.

## Local branch checkpoint

The authorized review branch is chore/open-source-readiness, based on local
production main 67626267ece2ae5b2831c68f71a9dd8f9aea7da8 (BETA v0.1.1.0).
Local main and the cached origin/main match that baseline; no fetch or hosted
state verification is performed by this checkpoint. Only a local commit is
currently authorized. main must remain at the production baseline. No push,
merge, deployment, visibility change or hosted-setting change is authorized.

Local pre-commit verification on 2026-10-28: 374/374 JavaScript tests passed with
an explicitly supplied hash-verified SDK fixture; the default suite passed 370
and skipped four optional SDK checks. 97 PGlite regression groups, 53 JavaScript
syntax checks, all three Edge syntax-transpilation checks, production/demo/preview
packaging and whitespace/credential-pattern checks passed. These are local tests,
not hosted-service, native Deno or physical-device verification. Production public
configuration matches the baseline exactly; app/runtime/backend/asset/Netlify files
and APP_VERSION are unchanged. All five unrelated files remain hash-identical.
The checkpoint uses public-handle/no-reply commit metadata only; historical personal
metadata is retained and still requires an owner decision before PUBLIC visibility.

## Hosted settings gate before ANY branch push

All items below are **UNVERIFIED HOSTED SETTINGS**, not claims about the current
site/account. The owner must verify them before separately authorizing a push.
Demo output alone cannot establish deployment or secret safety.

### GitHub — Aurasj/azice

- Settings → General: confirm the repository remains private and the default
  branch is main. Check repository/org rulesets, app installations, webhooks and
  existing automations for any branch-push/PR deployment or build-hook trigger.
- Settings → Actions → General: use restricted/read-only workflow permissions;
  disable Actions creating/approving PRs. Confirm allowed Actions include the
  reviewed, SHA-pinned checkout/setup-node and use GitHub-hosted runners only.
- In the private-repository fork policy, keep sending write tokens and secrets
  to fork PR workflows disabled. Require fork-run approval where available;
  recheck the public-repository fork approval policy before visibility changes.
- Settings → Secrets and variables → Actions, including inherited organization
  secrets and Environments: inventory names/scopes without revealing values.
  This CI needs no production secrets, service-role keys or deployment tokens.
  Protect any production environment with explicit reviewers/branch restrictions;
  ensure no untrusted workflow can request it or obtain deployment credentials.
- Review workflow triggers as code: this CI has pull_request and push to main,
  contents: read, no secret references, no deployment, no pull_request_target,
  no workflow_run escalation, and checkout credential persistence is disabled.
  A plain push to chore/open-source-readiness does NOT run this workflow. A later
  private PR can run it, but may also trigger Netlify; verify that gate first.
- Before a future merge, protect main with reviewed PRs, passing Contributor
  checks and resolved conversations, block force pushes/deletion and review
  bypass rights. Establish the actual check name with a real private PR run
  before making it required. Local tests do not verify Linux namespace support.

### Netlify — existing production project

- Project configuration → Developer settings → Continuous deployment → Branches
  and deploy contexts: verify the connected repository is Aurasj/azice and the
  ONLY production branch is main. Keep command node scripts/build.mjs and dist
  publish directory. Confirm the intended review branch is not the production
  branch, and has no production alias/domain or other deployment automation.
- At that same screen, inspect Branch deploys: No branch deploys, or an explicit
  allowlist that excludes chore/open-source-readiness, prevents this branch push
  from automatically creating a branch deploy. All branches or a matching pattern
  may create one. Verify the actual saved setting; do not assume the default.
- Inspect Deploy Previews separately. Disable them for this review if no hosted
  execution is intended; otherwise approve their security/visibility explicitly.
  Opening a private PR can create a preview even when branch deploys are disabled.
- Project configuration → Environment variables: inspect every variable's deploy
  contexts and scopes, including team/shared variables and plugins. No privileged
  values should be available to this branch, deploy-preview or preview-server
  build. This build needs no privileged credentials in any context. Do not change
  production variables as part of this checkpoint or export/log their values.
- Project configuration → Environment variables → Site policies: when connected
  to a public repository, verify Sensitive variable policy is Require approval,
  never Deploy without restrictions. An alternative future policy must withhold
  sensitive values. Do not assume this public-repository policy protects private
  branch builds; trusted/member builds can bypass the untrusted-deploy gate.
- For the current private repository, also inspect Team settings → Access &
  security → Visitor access → Auto-approve deploys from non-team members. Verify
  manual approval for unrecognized authors. This Deploy Request Policy is distinct
  from Sensitive variable policy and is not a gate on a recognized owner's push.
- Inspect build hooks and GitHub/Netlify apps, build plugins, outgoing deployment
  workflows and any conditional production publishing. A branch push should not
  deploy production if main alone is production and no other automation promotes
  it; without checking these settings, that outcome cannot be guaranteed.
- Preview URLs can be publicly reachable despite a private GitHub repository.
  Review preview access protection before enabling them; noindex is not access
  control. Never sign in with real production accounts in a review preview.

The tracked production profile is intentionally public and readable by all source
code, including PR code. The reviewed build emits empty demo config in preview
contexts and retains exact existing public values only for production packaging.
That prevents accidental use, not a malicious contributor calling the endpoint.
Netlify builds do not inherit the CI test's loopback-only namespace. Treat all
preview/build code as untrusted and keep privileged values out of its environment.

Reference settings guidance: [GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository),
[Netlify preview controls](https://docs.netlify.com/deploy/deploy-types/deploy-previews/),
[Netlify environment policies](https://docs.netlify.com/build/environment-variables/get-started/),
[Netlify deploy request policy](https://docs.netlify.com/deploy/deploy-overview/).
No account settings were read or changed; these are owner verification instructions.

## Checklist before the first private push of these preparation changes

1. Review the complete diff and the exact inventory below. Keep all five unrelated
   untracked files out; do not use a workspace archive, mirror push or blanket add.
2. Record outstanding artwork-origin, attribution, historical-personal-metadata
   and R03-disclosure decisions. These remain gates before PUBLIC visibility;
   this private local checkpoint does not resolve them or approve disclosure.
   Do not rewrite history or silently remove the risk warning.
3. Approve and configure GitHub/Netlify restrictions separately: keep the existing
   repository private, prevent unreviewed production/main deployments, withhold
   preview secrets and never test production accounts in previews. Check whether
   a review-branch push itself would create a Netlify branch/preview deployment.
4. Re-run npm ci --ignore-scripts, npm test, npm run check, npm run test:sql,
   npm run build and demo packaging checks; run the explicit offline production
   packaging check and confirm public settings are unchanged. Restore demo output.
   Review a redacted credential scan and git diff --check, including new files.
5. Local branch creation, explicit staging and a local checkpoint commit are now
   authorized. Inspect git diff --cached --check and all staged names. No remote
   push or merge is authorized; main must remain unchanged.
6. Only after the hosted settings gate and separate push authorization, push that
   branch privately. This push alone does not trigger the current CI. A separately
   approved private PR can run Contributor checks, but may also start a Netlify
   preview. Validate the first Linux run, especially namespace isolation, then
   enable the actual required status check. Do not push main or trigger a release.
7. Public visibility is a later, explicit owner action after approvals and checks.
   No SQL migration, Edge deployment, key rotation or backend change is required.

## Exact local preparation inventory

41 reviewed paths for the local chore/open-source-readiness checkpoint:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/pull_request_template.md`
- `.github/workflows/ci.yml`
- `.gitignore`
- `BRANDING.md`
- `CONTRIBUTING.md`
- `DEPLOY.md`
- `LICENSE`
- `OPEN_SOURCE.md`
- `README.md`
- `SECURITY.md`
- `config.example.json`
- `config.js`
- `config.production.json`
- `package-lock.json`
- `package.json`
- `scripts/build.mjs`
- `scripts/check-config.mjs`
- `scripts/check-demo-build.mjs`
- `scripts/check-push-syntax.mjs`
- `scripts/check-syntax.mjs`
- `scripts/config.mjs`
- `scripts/test-activity-postgres.mjs`
- `scripts/test-activity-unread-postgres.mjs`
- `scripts/test-daily-posting-postgres.mjs`
- `scripts/test-friendship-helper-postgres.mjs`
- `scripts/test-post-cleanup-postgres.mjs`
- `scripts/test-push-postgres.mjs`
- `scripts/test-push-without-quiet-hours-postgres.mjs`
- `scripts/test-sql.mjs`
- `scripts/test-username-friends-postgres.mjs`
- `server.mjs`
- `supabase/NATIVE_POSTGRES_TESTS.md`
- `supabase/SDK_VERSIONS.md`
- `supabase/WEB_PUSH.md`
- `tests/branding.test.mjs`
- `tests/build-config.test.mjs`
- `tests/config.test.mjs`
- `tests/licensing.test.mjs`
