-- Exact username request only: no directory, profile projection or UUID-taking public API.
begin;
do $$begin
 if (select proowner from pg_proc where oid='azice_private.create_friend_request(uuid,uuid)'::regprocedure)
  <> (select oid from pg_roles where rolname=current_user)
  or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Run as the existing reviewed friend-request helper owner with BYPASSRLS';
 end if;
 if pg_has_role('authenticated',current_user,'MEMBER') or pg_has_role('anon',current_user,'MEMBER') then
  raise exception 'API roles must not inherit the function owner';
 end if;
end $$;

-- One bounded counter per account; failed lookups count too. No usernames are logged.
create table azice_private.username_request_limits(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 window_started timestamptz not null,
 attempts integer not null check(attempts between 1 and 10)
);
alter table azice_private.username_request_limits enable row level security;

create function public.send_username_friend_request(p_username text) returns text
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); target uuid; normalized text; used integer; stamp timestamptz;
begin
 if caller is null or not exists(select 1 from public.profiles where id=caller) then
  raise exception 'Profile required';
 end if;
 -- Share sender/pair locking with invitations and comment discovery.
 perform pg_advisory_xact_lock(hashtextextended('azice:request-sender:'||caller::text,0));
 stamp:=clock_timestamp();
 insert into azice_private.username_request_limits as l(user_id,window_started,attempts)
 values(caller,stamp,1)
 on conflict(user_id) do update set
  window_started=case when l.window_started<=stamp-interval '1 hour' then stamp else l.window_started end,
  attempts=case when l.window_started<=stamp-interval '1 hour' then 1 else l.attempts+1 end
 where l.window_started<=stamp-interval '1 hour' or l.attempts<10
 returning attempts into used;
 if used is null then return 'rate_limited'; end if;
 -- Return statuses rather than raising on misses: an exception would roll back the counter.
 normalized:=regexp_replace(btrim(p_username),'^@','');
 if normalized is null or normalized !~ '^[a-z0-9_]{3,24}$' then return 'invalid'; end if;
 select id into target from public.profiles where username=normalized for key share;
 if target is null then return 'not_found'; end if;
 if target=caller then return 'self'; end if;
 perform pg_advisory_xact_lock(hashtextextended('azice:request-pair:'||least(caller,target)::text||':'||greatest(caller,target)::text,0));
 perform 1 from public.friend_requests where status='pending'
  and least(sender_id,receiver_id)=least(caller,target) and greatest(sender_id,receiver_id)=greatest(caller,target) for update;
 if public.are_friends(caller,target) then return 'friends'; end if;
 if exists(select 1 from public.friend_requests where status='pending'
  and least(sender_id,receiver_id)=least(caller,target) and greatest(sender_id,receiver_id)=greatest(caller,target)) then return 'pending'; end if;
 begin
  perform azice_private.create_friend_request(target);
  return 'sent';
 exception when others then
  -- This subtransaction leaves the lookup counter intact and conceals internal details.
  if sqlstate='P0001' and sqlerrm='Too many friend requests. Try again later.' then return 'rate_limited'; end if;
  return 'unavailable';
 end;
end $$;

-- Remove hostile default grants only from the two new objects, including custom roles.
do $$declare entry record; grantee record; role_sql text; begin
 for entry in
  select 'table' kind,c.oid,c.relowner owner_id,c.relacl acl,'azice_private.username_request_limits' name
   from pg_class c where c.oid='azice_private.username_request_limits'::regclass
  union all
  select 'function',p.oid,p.proowner,p.proacl,'public.send_username_friend_request(text)'
   from pg_proc p where p.oid='public.send_username_friend_request(text)'::regprocedure
 loop
  for grantee in select distinct a.grantee from aclexplode(coalesce(entry.acl,acldefault(case when entry.kind='table' then 'r'::"char" else 'f'::"char" end,entry.owner_id))) a where a.grantee<>entry.owner_id loop
   role_sql:=case when grantee.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grantee.grantee)) end;
   execute format('revoke all on %s %s from %s',entry.kind,entry.name,role_sql);
  end loop;
 end loop;
end $$;
revoke all on azice_private.username_request_limits from public,anon,authenticated,service_role;
revoke all on function public.send_username_friend_request(text) from public,anon,service_role;
grant execute on function public.send_username_friend_request(text) to authenticated;
notify pgrst,'reload schema';
commit;
