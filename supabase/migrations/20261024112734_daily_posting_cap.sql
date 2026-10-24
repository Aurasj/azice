-- Apply once after the existing notification-preferences migration. No history backfill/deletion.
begin;
do $$begin
 if (select proowner from pg_proc where oid='public.publish_post(uuid)'::regprocedure)<>(select oid from pg_roles where rolname=current_user)
 or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Run as the existing publish_post owner with BYPASSRLS';
 end if;
 if pg_has_role('authenticated',current_user,'MEMBER') or pg_has_role('anon',current_user,'MEMBER') then raise exception 'API roles must not inherit the owner'; end if;
 perform 'public.notification_preferences'::regclass,'azice_private'::regnamespace;
end $$;

-- One private row per account, not a second post/history store. Concurrent upserts
-- contend on this row; repeatable-read conflicts abort rather than over-admit.
create table azice_private.daily_post_usage(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 local_day date not null, timezone text not null,
 used integer not null check(used between 1 and 3)
);
alter table azice_private.daily_post_usage enable row level security;

create function azice_private.posting_status(p_user uuid,p_timezone text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare zone text; stamp timestamptz; day date; starts timestamptz; ends timestamptz; total integer; reserved integer;
begin
 if p_timezone is not null and not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
 -- Existing saved timezone is authoritative. For an unconfigured account, the
 -- UI supplies its IANA timezone once; no notification consent is enabled.
 if p_timezone is not null then
  insert into public.notification_preferences(user_id,timezone) values(p_user,p_timezone) on conflict(user_id) do nothing;
 end if;
 select timezone into zone from public.notification_preferences where user_id=p_user for update;
 if zone is null then raise exception 'Posting timezone is not configured. Reopen Create Post.'; end if;
 stamp:=clock_timestamp();day:=(stamp at time zone zone)::date;
 starts:=day::timestamp at time zone zone;ends:=(day+1)::timestamp at time zone zone;
 select count(*) into total from public.posts where author_id=p_user and status='published' and published_at>=starts and published_at<ends;
 select used into reserved from azice_private.daily_post_usage where user_id=p_user and local_day=day and timezone=zone;
 return jsonb_build_object('count',greatest(total,coalesce(reserved,0)),'limit',3,'day',day,'timezone',zone,'reset_at',ends,'server_now',stamp);
end $$;

create function public.get_daily_posting_status(p_timezone text default null) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profile required'; end if;
 return azice_private.posting_status(auth.uid(),p_timezone);
end $$;

create or replace function public.publish_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.posts%rowtype;
  photo_count integer;
  actual_storage_count integer;
  daily jsonb;
  reserved integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into p from public.posts where id = p_post_id for update;
  if p.id is null or p.author_id <> auth.uid() or p.status <> 'draft' then
    raise exception 'Draft not found';
  end if;

  select count(*) into photo_count from public.post_photos where post_id = p_post_id;
  if photo_count > 3 or (p.kind = 'drank' and photo_count < 1) then
    raise exception 'Invalid photo count';
  end if;

  -- Validate actual uploaded photos in storage.objects, preventing unuploaded/spoofed image paths
  if photo_count > 0 then
    select count(*) into actual_storage_count
    from storage.objects s
    join public.post_photos pp on s.name = pp.path
    where pp.post_id = p_post_id
      and s.bucket_id = 'post-images'
      and s.name like auth.uid()::text || '/' || p_post_id::text || '/%';

    if actual_storage_count <> photo_count then
      raise exception 'Photo verification failed: storage files do not match draft photos';
    end if;
  end if;

  daily:=azice_private.posting_status(auth.uid());
  if (daily->>'count')::integer>=3 then raise exception using errcode='P0001',message='DAILY_POST_LIMIT'; end if;
  insert into azice_private.daily_post_usage as u(user_id,local_day,timezone,used)
  values(auth.uid(),(daily->>'day')::date,daily->>'timezone',(daily->>'count')::integer+1)
  on conflict(user_id) do update set
   local_day=excluded.local_day,timezone=excluded.timezone,
   used=case when u.local_day=excluded.local_day and u.timezone=excluded.timezone then greatest(u.used,excluded.used-1)+1 else excluded.used end
  where (case when u.local_day=excluded.local_day and u.timezone=excluded.timezone then greatest(u.used,excluded.used-1) else excluded.used-1 end)<3
  returning used into reserved;
  if reserved is null then raise exception using errcode='P0001',message='DAILY_POST_LIMIT'; end if;
  update public.posts set status = 'published', published_at = (daily->>'server_now')::timestamptz where id = p_post_id;
end $$;



-- Exact object-scoped ACLs; retain the existing publish_post identity/owner/grants.
do $$declare entry record; granted record; role_sql text; begin
 for entry in
  select 'table' kind,c.relowner owner_id,c.relacl acl,'azice_private.daily_post_usage' name from pg_class c where c.oid='azice_private.daily_post_usage'::regclass
  union all
  select 'function',p.proowner,p.proacl,p.oid::regprocedure::text from pg_proc p where p.oid=any(array['azice_private.posting_status(uuid,text)'::regprocedure,'public.get_daily_posting_status(text)'::regprocedure])
 loop
  for granted in select distinct a.grantee from aclexplode(coalesce(entry.acl,acldefault(case when entry.kind='table' then 'r'::"char" else 'f'::"char" end,entry.owner_id))) a where a.grantee<>entry.owner_id loop
   role_sql:=case when granted.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(granted.grantee)) end;
   execute format('revoke all on %s %s from %s',entry.kind,entry.name,role_sql);
  end loop;
 end loop;
end $$;
revoke all on azice_private.daily_post_usage from public,anon,authenticated,service_role;
revoke all on function azice_private.posting_status(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_daily_posting_status(text) from public,anon,service_role;
grant execute on function public.get_daily_posting_status(text) to authenticated;
notify pgrst,'reload schema';
commit;
