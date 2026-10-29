# R03/F03 real-service integration attempt — 2026-10-27

> **Current reading note:** This earlier attempt remains inconclusive. No new integration work was run, and R03 remains unresolved. Retain the original evidence and teardown limitations below.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


Status: **BLOCKED at runtime preflight, before environment bootstrap or test data.**
R03 remains open. This is not an integration-test pass or evidence of a production
Storage leak. The approved scenarios remain in account-deletion-r03.md and the
Phase 1 review. No production fix is proposed from this attempt.

## Observed local prerequisites

- No Docker/Podman executable found on PATH or checked machine/per-user install
  locations; no standard Docker engine pipe found.
- `wsl --status` and `wsl --list --quiet` both report WSL is not installed.
- No Deno executable found on PATH or the normal per-user installation path.
- VirtualBox **7.2.8r173730** is available; zero running VMs were reported.
- The Windows session has no administrator token. The host reports a hypervisor
  present and VirtualBox reports hardware virtualization support. This is NOT
  interpreted as proof that a new guest can boot or that nested virtualization
  is unavailable.
- Host usable memory was approximately **7.36 GiB**, with only **1.8 GiB free**;
  approximately 130 GiB of disk space was free.

The missing Docker/WSL runtime cannot simply be supplied by a portable Deno binary
or Docker client. Docker's WSL route needs host prerequisites. A new VirtualBox
Linux guest is a possible alternative, but giving it a realistic budget for the
real database/Auth/Storage/Edge stack would put pressure on the already occupied
host. No undersized guest was started and no existing applications/VMs were
stopped, reconfigured or reused to free resources.

For context, Supabase recommends at least 7 GB RAM for its full default local
stack. A reduced stack may need less, but this attempt does not claim an exact
minimum for the required services or reliable behavior within the observed free
memory. Docker documents the WSL/virtualization prerequisites separately:

- https://supabase.com/docs/reference/cli/supabase-start
- https://docs.docker.com/desktop/setup/install/windows-install/

## Scenario results

All real-service scenarios are **NOT EXECUTED / INCONCLUSIVE**: normal deletion,
partial removal and retry, in-flight avatar/post-image uploads, stale JWTs, final
authorization/metadata commit barriers, delayed physical cleanup, unrelated-account
isolation and F03 upload recovery. No PostgreSQL/Auth/PostgREST/Storage/Edge service
versions were exercised together. No actual object bytes or provider versions
were created or inspected; no surviving physical object was observed or excluded.

Existing mocked R03/F03 tests were rerun separately as local regression checks.
All **26 tests passed**, with no skips; `git diff --check` and this report's
whitespace check also passed. Those checks do not change any integration result
above. No native database was started for this attempt. APP_VERSION remains
0.1.0.3, and both stabilization migration SHA-256 hashes remain unchanged.

## Isolation and teardown

Preflight stopped before credentials, a run manifest, a database marker, accounts,
objects, images, containers, networks, volumes or VMs were created. Consequently,
manifest/marker/egress checks were not implemented or verified for a running stack;
they remain mandatory gates before future test data. The proposed ports
55441–55443 had no listening TCP endpoint reported at the final check.

No Supabase project configuration, links, credentials or sessions were loaded.
No hosted Supabase request, SQL application, installation, image download, service
startup, system configuration change, commit, push or deployment was performed.
Only public documentation and local runtime/resource metadata were read. There
are no new runtime resources or temporary credentials to tear down. The only new
review artifact is this document; pre-existing test artifacts remain untouched.

## Smallest next step

Provide a working local Linux-container runtime and sufficient available memory,
or a dedicated disposable local Linux VM with an adequate resource budget. Setting
up host WSL/Docker prerequisites may require an interactive elevated session and
restart. No permission to access production or use a remote Docker context should
be inferred. Once runtime prerequisites are met, resume the approved isolation
gates, real-service barrier tests and physical-object checks before deciding on
any production correction. Do not replace them with SQL metadata fixtures or mock
responses.
