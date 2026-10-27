# Local native PostgreSQL stabilization verification

## Actual environment and scope (2026-10-27)

The existing checkpoint/branch and APP_VERSION 0.1.0.3 were preserved. No software
was installed and no production migration, hosted SQL, provider configuration,
Windows service, commit, push or deployment was performed.

Read-only inspection found existing PostgreSQL **15.18** binaries in
`%TEMP%/azice-comment-discovery-pg15/node_modules/@embedded-postgres/windows-x64/native/bin`
and a working **pg 8.16.3** driver at
`%TEMP%/azice-pg-driver/node_modules/pg/lib/index.js`. They were not on PATH and the
AZICE_TEST_PG_MODULE variable was unset. postgres.exe, initdb.exe and pg_ctl.exe were
available; psql.exe and pg_isready.exe were absent. A direct version command and
driver import confirmed availability. No existing PostgreSQL process was running
and the loopback port 55439 refused connections.

After explicit owner approval, existing binaries initialized a NEW ignored cluster
under `supabase/.temp/native-stabilization-pg15/data`, with a log beside it. It was
started only on `127.0.0.1:55439`, with `cluster_name=azice_stabilization_disposable`.
The old temporary cluster was not reused. The test server runs as the current OS
user, not a registered Windows service. Trust authentication is limited in exposure
by its loopback-only listener and disposable test environment; do not use this as
an application deployment configuration.

Each runner requires the loopback listener, exact disposable marker and fixed test
administrator before any setup mutations. It creates a new timestamp/PID-named
database, initializes the original schema only there, then drops that database in
finally cleanup. Role setup is cluster-wide but confined to this approved disposable
cluster. Neither runner accepts a host, hosted database URL or existing app database
name from the environment. Synthetic Auth fixtures supply auth.uid(); PostgreSQL
roles and RLS are real. SQL Storage rows are metadata fixtures, not physical uploads.

Cleanup was verified: no runner-created databases remained, and the exact approved
server was stopped after testing. The ignored, stopped cluster/log remain locally
for inspection. Final regression checks passed: **346 JavaScript tests**, **97
PGlite groups** (including the no-Cron variant), **24 native PostgreSQL checks/groups**,
**43 JavaScript syntax checks**, both unchanged Edge Functions' syntax transpilation,
production build and tracked/new-file whitespace checks. F01-F06 source, both
forward-only migrations and the checkpoint commit were not changed by this task.

## Executed native tests

`scripts/test-comment-discovery-postgres.mjs`: **16 passed**.

- Before the fix, the unmodified native runner reproduced F07 with SQLSTATE P0001:
  `Unexpected Storage SELECT policy set: review avatar authorization`.
- The corrected runner proves this negative preflight still rejects the incomplete
  fixture without partial migration changes, then loads the exact existing
  post_image_select policy from schema.sql. It does not bypass the prerequisite.
- Namespace/owner preflights, exact grants/default privileges and the existing SQL
  regression script execute on native PostgreSQL.
- Storage SELECT policy behavior is checked against readable-friend, nonfriend,
  expired-post and draft-post metadata, alongside existing avatar/privacy assertions.
- Independent sessions actually block on row/advisory locks for both revocation
  orders (friendship, post visibility and comment deletion), same/opposite-direction
  requests and the shared invitation/comment 30-per-hour quota.

`scripts/test-stabilization-native-postgres.mjs`: **8 groups passed**.

- The existing migration chain is replayed, then F02
  `20261024171206_restrict_friendship_helper.sql`, then F06
  `20261024174419_bound_activity_unread.sql`. Both files remain unchanged.
- Native anonymous/authenticated arbitrary-pair probing is reproduced before F02,
  rejected after it, and service-role helper access remains intact. Confirmed-friend
  profile/post reads work; pending requests do not reveal private content.
- An injected error after F02 revocation rolls back both ACL and profile policy.
  An injected error after F06 replacement restores the original function and grants.
- The native 51-event mismatch is reproduced, then fixed while retaining get_activity
  identity/owner/ACL/invoker mode. Foreign marking and anon/service RPC execution fail.
- Two real sessions overlap: a REPEATABLE READ Activity reader retains its snapshot
  while a friend commits a comment; the next fresh read sees the new event and marking
  it clears the visible-set flag.
- With two posts already published today, two valid mixed-type drafts compete for
  slot three. The runner observes pg_stat_activity and pg_blocking_pids, confirming
  the competing session is blocked by the first transaction. Committing the winner
  rejects the loser with DAILY_POST_LIMIT; retrying the published UUID cannot publish
  again. Count remains three.
- Rolling the first transaction back releases the slot for the actually waiting
  second publisher. The rolled-back post remains a draft and count remains three.
- A REPEATABLE READ publishing competitor gets SQLSTATE 40001 after the lock wait
  rather than exceeding the cap. Revocation still blocks comments/private profiles,
  while existing own-post Activity remains clearable.

These are native execution results, not simulated PGlite concurrency. No new product
features, backend functions or migrations were needed for this verification.

## Safe setup/rerun instructions

Do not install software, initialize/start servers, change an existing cluster, or
register a service without owner approval. If the existing binaries/driver are
missing, stop and request approval for provisioning; neither runner installs them.
psql is not needed because the pg driver executes the SQL.

Use a fresh PowerShell session at the repository root. Inspect the existing binary
version/help first. Set these paths to the already-reviewed installed/downloaded
locations; never put credentials into them or into source control:

```powershell
$pgBin = Join-Path $env:TEMP 'azice-comment-discovery-pg15/node_modules/@embedded-postgres/windows-x64/native/bin'
$pgDriver = Join-Path $env:TEMP 'azice-pg-driver/node_modules/pg/lib/index.js'
& (Join-Path $pgBin 'postgres.exe') --version
& (Join-Path $pgBin 'pg_ctl.exe') --help
& (Join-Path $pgBin 'initdb.exe') --help
```

After explicit startup approval, verify that port 55439 is free. Do not stop or
reuse an unknown listener. A bounded nonmutating check is:

```powershell
node --input-type=module -e "import net from 'node:net';const s=net.connect({host:'127.0.0.1',port:55439});s.setTimeout(1500);s.on('connect',()=>{console.error('Port occupied: stop and inspect');s.destroy();process.exitCode=1;});s.on('error',e=>{console.log(e.code);if(e.code!=='ECONNREFUSED')process.exitCode=1;});s.on('timeout',()=>{s.destroy();process.exitCode=1;});"
if ($LASTEXITCODE -ne 0) { throw 'Local test port is not confirmed free' }
```

Create a fresh cluster inside the ignored workspace directory. Never initialize
over an existing directory. The commands below do not register a Windows service:

```powershell
$allowedRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'supabase/.temp'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $allowedRoot ('native-stabilization-' + [guid]::NewGuid().ToString('N'))))
if (!$testRoot.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test directory' }
if (Test-Path -LiteralPath $testRoot) { throw 'Directory already exists: inspect instead of overwriting' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$pgData = Join-Path $testRoot 'data'
$pgLog = Join-Path $testRoot 'postgres.log'
& (Join-Path $pgBin 'initdb.exe') -D $pgData -U azice_test_owner -A trust -E UTF8 --no-locale
if ($LASTEXITCODE -ne 0) { throw 'Disposable initdb failed' }
try {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -l $pgLog -o '-h 127.0.0.1 -p 55439 -c cluster_name=azice_stabilization_disposable' -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw 'Disposable server start failed' }
    $env:AZICE_TEST_PG_MODULE = $pgDriver
    $env:AZICE_TEST_PG_PORT = '55439'
    node scripts/test-comment-discovery-postgres.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Native discovery regression failed' }
    node scripts/test-stabilization-native-postgres.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Native stabilization regression failed' }
} finally {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -m fast -w -t 30 stop
    Remove-Item Env:AZICE_TEST_PG_MODULE -ErrorAction SilentlyContinue
    Remove-Item Env:AZICE_TEST_PG_PORT -ErrorAction SilentlyContinue
}
```

Stop only the cluster at the exact directory created for this run. No global
postgres process termination, recursive directory deletion, system PATH changes,
Windows service changes, extension installs or production connection is needed.
The stopped cluster/log may be retained in the ignored directory for inspection.

## Remaining verification limits

PostgreSQL 15.18 is the existing local binary version, not the production Supabase
PostgreSQL version. These native checks do not reproduce hosted PostgREST, Auth JWT
verification, pg_net, real Cron/Vault, Edge delivery, physical object storage or
device camera behavior. PGlite-only test cases remain PGlite-only unless explicitly
listed above. Before release, verify against matching disposable Supabase staging,
especially Storage remove/list responses and physical blob deletion for F03. Do not
claim all production end-to-end checks passed based on SQL roles/metadata fixtures.

Prior per-fix/checkpoint reports accurately describe their earlier verification.
This run supersedes their missing-native-environment limitations for the cases
executed here; it does not supersede real Storage/device/hosted integration limits.
