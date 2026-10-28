# Security policy

This beta is not a guarantee of complete privacy or production readiness. The
latest published beta (currently BETA v0.1.1.0) is the maintenance target; older
versions have no separate security-support commitment.

## Reporting

Prefer GitHub's private vulnerability reporting form **when the owner enables it**:
https://github.com/Aurasj/azice/security/advisories/new

If unavailable, use the existing Safety & Privacy contact linked in README.md to
ask for a private reporting channel. Do not open a public issue with exploit steps,
tokens, personal data or real-user screenshots. Include affected version, impact
and a synthetic/disposable reproduction privately. Handling is best-effort; no
response deadline, bounty or permission for penetration testing is promised.

## Testing boundaries

The MIT source-code license and public browser keys do not authorize testing the deployed
backend, accounts or Storage. Use the local demo, mocks/PGlite or an explicitly
approved disposable environment. Do not run destructive tests against production,
attempt to access other users' data, or attach credentials to issues/PRs.

## Known limitation

R03 (concurrent account deletion and uploads) remains unresolved and accepted for
this beta. Local metadata/mock tests identified a concurrency risk; surviving
physical Storage bytes have not been verified. Do not claim complete erasure or
infer that acceptance makes the operation race-free. No new exploit details are
introduced by this policy. Further R03 integration work is stopped for this beta.

Native Deno and real Storage failure/recovery verification also remain incomplete.
The owner must approve public disclosure scope and the reporting process before
changing visibility; this file does not change any GitHub or hosted-service setting.
