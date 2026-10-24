-- F06: unread describes exactly the same newest-50 RLS-visible events as items.
-- Forward-only replacement; no event/read-state backfill or permission changes.
begin;

do $$
begin
 if not exists(select 1 from pg_catalog.pg_proc
  where oid='public.get_activity()'::regprocedure and not prosecdef
   and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user)
   and prorettype='jsonb'::regtype) then
  raise exception 'Run as the existing get_activity owner; expected SECURITY INVOKER returning jsonb';
 end if;
 if not exists(select 1 from pg_catalog.pg_class where oid='public.activity_notifications'::regclass and relrowsecurity)
 or not exists(select 1 from pg_catalog.pg_policy
  where polrelid='public.activity_notifications'::regclass and polname='activity_read_own' and polcmd='r')
 or not pg_catalog.has_function_privilege('authenticated','public.get_activity()','EXECUTE')
 or pg_catalog.has_function_privilege('anon','public.get_activity()','EXECUTE')
 or pg_catalog.has_function_privilege('service_role','public.get_activity()','EXECUTE') then
  raise exception 'Unexpected Activity RLS or RPC privileges; review before applying';
 end if;
end $$;

-- One materialized bounded relation supplies both fields in one statement
-- snapshot, including a deterministic tie-break. Existing caller RLS still runs.
create or replace function public.get_activity() returns jsonb
language sql stable security invoker set search_path='' as $$
 with visible as materialized (
  select * from public.activity_notifications
  order by created_at desc,event_key desc limit 50
 )
 select jsonb_build_object(
  'items',coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.event_key desc),'[]'::jsonb),
  'unread',coalesce(bool_or(a.read_at is null),false)
 ) from visible a
$$;

-- CREATE OR REPLACE retains the function OID, owner and exact existing ACLs.
-- mark_activity_read, RLS, source triggers, retention and Web Push are untouched.
commit;
