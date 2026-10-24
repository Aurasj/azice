-- F02: keep the shared definer helper for trusted callers, not browser RPCs.
-- Apply once as the existing function/table owner; never rerun schema.sql.
begin;

do $$
declare owner_id oid := (select oid from pg_catalog.pg_roles where rolname=current_user);
begin
 if not exists(select 1 from pg_catalog.pg_proc
  where oid='public.are_friends(uuid,uuid)'::regprocedure and proowner=owner_id and prosecdef)
 or (select relowner from pg_catalog.pg_class where oid='public.profiles'::regclass)<>owner_id then
  raise exception 'Run as the existing owner of are_friends and profiles; review any SECURITY DEFINER changes';
 end if;
 if exists(select 1 from pg_catalog.pg_roles where rolname in ('anon','authenticated')
  and (rolsuper or rolbypassrls or pg_catalog.pg_has_role(oid,owner_id,'MEMBER')
   or pg_catalog.pg_has_role(oid,'service_role','MEMBER'))) then
  raise exception 'API roles must not inherit privileged database roles';
 end if;
 if not pg_catalog.has_function_privilege('service_role','public.are_friends(uuid,uuid)','EXECUTE') then
  raise exception 'Expected existing service-role EXECUTE privilege; review before applying';
 end if;
 -- All inspected internal callers execute as this same trusted owner. The
 -- private invoker helper is reached only through owner-run definer wrappers.
 if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','azice_private','azice_push','azice_activity')
   and p.prosrc like '%are_friends%' and p.proowner<>owner_id) then
  raise exception 'Unexpected friendship helper caller owner; review internal EXECUTE dependencies';
 end if;
 if not exists(select 1 from pg_catalog.pg_policy
  where polrelid='public.profiles'::regclass and polname='profiles_confirmed_read_guard'
   and not polpermissive and polcmd='r'
   and polroles=array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]) then
  raise exception 'Expected restrictive authenticated profile SELECT guard';
 end if;
 -- The replacement subquery runs under caller RLS, with no profile/helper
 -- recursion. Fail closed if that underlying policy has changed since review.
 if not pg_catalog.has_table_privilege('authenticated','public.friendships','SELECT')
 or not exists(select 1 from pg_catalog.pg_class where oid='public.friendships'::regclass and relrowsecurity)
 or not exists(select 1 from pg_catalog.pg_policy
  where polrelid='public.friendships'::regclass and polname='friends_read_own'
   and polpermissive and polcmd='r'
   and polroles=array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]
   and pg_catalog.pg_get_expr(polqual,polrelid)='((user_a = auth.uid()) OR (user_b = auth.uid()))')
 or (select count(*) from pg_catalog.pg_policy where polrelid='public.friendships'::regclass)<>1 then
  raise exception 'Unexpected friendships RLS policy set; review for recursion/access changes';
 end if;
end $$;

-- Preserve the independent restrictive guard, without requiring browser
-- EXECUTE on the arbitrary-pair helper. The indexed canonical pair lookup
-- intersects with friends_read_own, so it can only read the caller's edges.
alter policy profiles_confirmed_read_guard on public.profiles using (
 id=auth.uid() or exists (
  select 1 from public.friendships f
  where f.user_a=least(profiles.id,auth.uid())
   and f.user_b=greatest(profiles.id,auth.uid())
 )
);

-- PUBLIC revocation alone misses Supabase's explicit default role grants.
-- Do not change the function body, owner, OID, search_path, service-role grant,
-- any other function's ACL, schema defaults, or any Storage policy.
revoke execute on function public.are_friends(uuid,uuid) from public, anon, authenticated;

do $$
begin
 -- Also detects unexpected inherited/custom grants. Any failure rolls back
 -- BOTH the policy change and the revocations, leaving no half-applied fix.
 if pg_catalog.has_function_privilege('anon','public.are_friends(uuid,uuid)','EXECUTE')
 or pg_catalog.has_function_privilege('authenticated','public.are_friends(uuid,uuid)','EXECUTE') then
  raise exception 'API roles retain inherited EXECUTE on are_friends; review role grants';
 end if;
 if not pg_catalog.has_function_privilege('service_role','public.are_friends(uuid,uuid)','EXECUTE') then
  raise exception 'Trusted service-role access must remain intact';
 end if;
 if exists(select 1 from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','storage') and (
   pg_catalog.pg_get_expr(p.polqual,p.polrelid) like '%are_friends(%'
   or pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) like '%are_friends(%')) then
  raise exception 'Unexpected direct RLS dependency on are_friends; review before applying';
 end if;
end $$;

commit;
