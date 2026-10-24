# F02: restrict the arbitrary-pair friendship helper

Local forward-only migration: `migrations/20261024171206_restrict_friendship_helper.sql`.
No frontend, old migration, Storage policy, Edge Function, scheduler, or version changes.
Apply only after owner review. Never rerun `schema.sql` against an existing database.

## Root cause and disclosure boundary

Read-only hosted metadata inspection on 2026-10-24 confirmed:

```sql
create function public.are_friends(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$select exists(select 1 from public.friendships f
where f.user_a = least(p_a,p_b) and f.user_b = greatest(p_a,p_b))$$;
```

Owner: `postgres`. ACL: `postgres=X/postgres`, `anon=X/postgres`,
`authenticated=X/postgres`, `service_role=X/postgres`. No PUBLIC grant remained.
The hosted `postgres` default privileges in `public` explicitly grant function
execution to `anon`, `authenticated`, and `service_role`. The original schema
revokes only PUBLIC and explicitly grants authenticated execution. Revoking
PUBLIC does not revoke separate default grants to named roles. This explains the
anonymous grant; authenticated execution was also deliberately granted in source.

The definer's table privileges bypass friendship RLS, and the function does not
bind either UUID to the caller. Thus anyone who knows or guesses two UUIDs can
learn whether that pair is confirmed friends, without participating in it.
It returns only a boolean: it does not itself enumerate users or reveal names,
emails, bios, posts, or pending requests. Unknown UUID pairs return false, just
like existing nonfriends. Browser callers must lose execution entirely; adding
`auth.uid()` checks here would break push eligibility checks on behalf of other
users and scheduled processing without a user JWT.

`search_path` remains `public, pg_temp`; the table reference is schema qualified,
and hosted anon/authenticated have no CREATE privilege in public. Neither the
body nor owner/search_path/function identity is changed by this fix.

## Complete application dependency inventory

The local schema/migration chain, frontend, all Edge Function sources, scheduler
source, and hosted function bodies, policies, views and dependency metadata were
inspected. String-body SQL/PLpgSQL calls are not necessarily registered in
`pg_depend`; source/body inspection supplements that catalog.

Direct current callers (all owned by `postgres`):

| Caller | Context and dependency |
| --- | --- |
| `public.can_view_profile(uuid)` | Definer; own or confirmed-friend private profile/avatar access. Discovery migration replaces the original pending-inclusive implementation. |
| `public.can_view_post(uuid)` | Definer; own posts or published friend posts within existing 30-day authorization window. |
| `public.can_interact_post(uuid)` | Definer; existing 48-hour interaction authorization. |
| `azice_private.create_friend_request(uuid,uuid)` | Private invoker helper; executes inside owner-run invitation, comment-discovery and username definer wrappers. Checks existing confirmed friendship. |
| `public.comment_author_card(uuid)` | Definer; authorized comment-author relationship and avatar projection. |
| `public.pending_friend_request_profiles()` | Definer; minimal request-peer projection and friend-only avatar visibility. |
| `azice_push.allowed(azice_push.jobs)` | Definer; rechecks recipients, posts, source events and reminder eligibility during claim/validation/navigation. |
| `azice_push.reminders()` | Definer; checks recent confirmed-friend activity for opt-in reminders. |
| `azice_activity.capture()` | Definer trigger; only other confirmed friends' comments/reactions on the recipient's posts. |
| `public.send_username_friend_request(text)` | Definer; confirmed-friend response before private request helper. |
| `profiles_confirmed_read_guard` | Sole direct RLS dependency, restrictive authenticated SELECT on profiles. Replaced by this migration. |

Original `schema.sql` also calls the helper from `send_friend_request(text)`;
the discovery migration supersedes that body with a call to the private helper.
There are no direct helper calls in the daily-cap or quiet-hours migrations.

Transitive policies:

- `profiles_read` and Storage `avatar_select` use `can_view_profile`.
- `posts_read`, `photos_read`, `comments_read`, `reactions_read`, Storage
  `post_image_select`, and `activity_read_own` use `can_view_post`.
- `comments_add`, `reactions_add`, `reactions_modify` (USING and WITH CHECK),
  and `reactions_remove` use `can_interact_post`.
- `friends_read_own` uses only `user_a=auth.uid() OR user_b=auth.uid()`;
  it does not read profiles or call another authorization helper.
- Other profile write, draft, invitation and request policies have no helper
  dependency and remain unchanged.

Transitive server paths:

- Invitation `send_friend_request`, `send_comment_friend_request`, and username
  requests invoke the private request helper under their definer owner.
  Accept/decline/cancel/removal functions retain their current rules and ACLs.
- `push_claim` / `push_validate` / `resolve_notification` call `azice_push.allowed`;
  notification taps additionally call `can_view_post`. Source triggers
  `push_friend_request`, `push_published_post`, `push_comment`, `push_reaction`
  enqueue unchanged. Completion, release and subscriptions do not call the
  friendship helper directly.
- `get_activity` reads through activity RLS; `mark_activity_read` rechecks post
  access. Comment/reaction capture uses `azice_activity.capture`.
- Cron `azice-push-dispatch` runs `select azice_push.tick();` as its privileged
  owner, which invokes reminders and the existing dispatcher. Cron
  `azice-activity-retention` runs `select azice_activity.purge();`, which has no
  friendship dependency. Neither job definition is altered.
- Edge `push-dispatch` uses service-only claim/validate/complete/release RPCs;
  `push-subscriptions` uses service-only registration/unregistration after JWT
  validation. Neither directly calls `are_friends`. `delete-account` uses its
  existing privileged Storage/Auth deletion and cascades, without direct helper
  calls. No Edge source or credentials change.
- `cloud.js`/`app.js`/`demo.js` do not call the helper RPC. Friendship lists read
  the caller's own RLS-protected edges. Feed, single posts, comments, reactions,
  photos, private profile edits and Activity use the policies/RPCs above.

Hosted metadata showed no view or direct Cron call to `are_friends`;
`pg_depend` recorded only the restrictive profile policy as a direct dependency.

## Fix and compatibility

One transaction:

1. Verify the existing owner, definer status, same-owner internal callers,
   service-role access, restrictive profile guard, and exact own-edge friendships
   RLS policy/SELECT permission. Reject API roles inheriting privileged roles.
2. ALTER only `profiles_confirmed_read_guard` to use an indexed canonical-pair
   EXISTS subquery against friendships under caller RLS, or the caller's own ID.
   It remains restrictive and independent of the permissive profile policy.
3. Revoke EXECUTE on exactly `public.are_friends(uuid,uuid)` from PUBLIC, anon,
   authenticated. Preserve existing owner and service-role access and all other
   ACLs/defaults. No new browser wrapper or privilege is added.
4. Assert effective browser execution is false (including inherited grants),
   service execution remains true, and no direct public/Storage policy call is
   left. Unexpected grants/dependencies abort the whole transaction.

The profile subquery cannot recurse: the reviewed sole friendships SELECT
policy references only caller identity, never profiles. Pending requests cannot
produce a friendship row, so private profiles and avatars remain hidden.
Trusted definer calls still execute as postgres, including when auth.uid() is
null in dispatcher/scheduler operations. No rows, delivery receipts, queued jobs,
rate limits, quotas, invitation tokens or cascades are recreated or modified.

## Local verification

Run `node scripts/test-friendship-helper-postgres.mjs` with the existing ignored
PGlite installation documented in `WEB_PUSH.md`. It creates a fresh in-memory
database, synthetic Auth/Storage fixtures and three disposable identities, then
replays the existing migration chain and this migration. It never connects to
Supabase or reads credentials. Auth claims, roles, grants, RLS and SQL functions
are exercised by the PostgreSQL engine; Storage bytes, HTTP/Vault and Cron are
not live services.

To reproduce the failing regression before the fix in PowerShell:

```powershell
$env:AZICE_F02_BEFORE_FIX='1'
node scripts/test-friendship-helper-postgres.mjs
Remove-Item Env:AZICE_F02_BEFORE_FIX
```

Expected: the synthetic-pair disclosure reproduction passes, then the denial
assertion fails with `Missing expected rejection`. Normal mode applies the fix
and verifies denial, authorized reads/writes, pending privacy, invitation and
username requests, comment discovery, Activity, service dispatcher, scheduler,
revocation/expiry, deletion, unrelated-object preservation and migration rollback.
Wrong-owner, changed-RLS, inherited-grant and injected post-revocation failure
cases explicitly verify no partial migration. A second application is also safe.

Native psql/Postgres/Docker are unavailable in this environment. PGlite does not
verify hosted PostgREST schema-cache behavior, native multi-session locking,
Storage HTTP responses, real Cron or push delivery. Existing JS/F01/F04/F05 tests
are separate frontend regression checks, not PostgreSQL authorization tests.

Verification for this local change: 17 new F02 PostgreSQL regression groups,
50 existing PGlite regression groups (push, quiet-hours removal, Activity,
username requests, daily cap), and all 323 JavaScript tests passed. Syntax
checks passed for 39 JavaScript modules and syntax-only transpilation for both
push Edge Functions. Production build and tracked/new-file whitespace checks
passed. The pre-fix denial test failed as expected before applying the fix.

## Exact manual deployment and recovery steps (not executed)

1. Review this migration and inventory. Back up current function definition/ACLs,
   profile and friendships policies, role memberships and relevant owners using
   read-only metadata queries. Confirm production still matches the prerequisites
   above. Check any operator-created wrappers/views not in the repository.
2. In a disposable native PostgreSQL/Supabase staging database matching production,
   apply the single new migration as existing owner postgres. Verify anon and an
   unrelated authenticated account both get denied RPC responses for
   synthetic pairs; authenticated users' own direct helper calls also must fail.
   PostgREST may deny execution or omit the function from its RPC schema.
   Test confirmed-friend reads, nonfriend/pending denials, normal profile edits,
   Feed/photos/comments/reactions, invites/accept/removal, Activity and the real
   service-role dispatcher. Confirm owner-run scheduled processing succeeds.
3. Obtain owner approval. Apply ONLY
   `20261024171206_restrict_friendship_helper.sql` once, as postgres, in the
   production SQL Editor or the reviewed migration mechanism. It already contains
   BEGIN/COMMIT. Do not replay old migrations/schema.sql or use a blanket db push
   against this manually managed deployment. No frontend or Edge redeploy, secret,
   scheduler or version change is needed for F02.
4. Inspect effective permissions:

   ```sql
   select r, has_function_privilege(r,'public.are_friends(uuid,uuid)','EXECUTE')
   from unnest(array['anon','authenticated','service_role','postgres']) as t(r);
   -- false, false, true, true respectively
   select policyname,permissive,roles,qual from pg_policies
   where schemaname='public' and tablename in ('profiles','friendships');
   ```

   Verify synthetic direct HTTP RPC calls are denied and repeat the authorized
   smoke checks with operator-controlled accounts. Do not inspect real users'
   arbitrary relationships. Monitor permission errors in existing workflows.
5. If any statement fails, ROLLBACK the failed transaction before retrying;
   PostgreSQL restores both ACL and policy changes. Investigate the exact owner,
   policy or inherited grant instead of bypassing checks. No data repair is needed.
   After a successful COMMIT, use a separately reviewed forward-only corrective
   migration for compatibility issues. Do not restore browser EXECUTE or the old
   directly-calling policy: that would reopen F02 or break profile reads.

Remaining trust boundary: service_role and the existing database owner retain
arbitrary-pair access intentionally. Future DROP/recreate operations can reapply
the still-existing Supabase defaults and reopen exposure; retain this explicit
ACL check in review/regressions. Broad default-privilege changes and other audit
findings are outside this fix. Already-running requests/transactions cannot be
retroactively recalled; verify denial on new sessions after commit.
