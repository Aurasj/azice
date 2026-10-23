-- Review and apply once, backend first. No cron/network/secret configuration here.
begin;
do $$begin
 if to_regnamespace('azice_push') is not null then raise exception 'azice_push exists; review migration history'; end if;
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Run as the reviewed database administrator with BYPASSRLS';
 end if;
 if pg_has_role('authenticated',current_user,'MEMBER') or pg_has_role('anon',current_user,'MEMBER') then raise exception 'Browser roles must not inherit the migration owner'; end if;
end $$;
create schema azice_push;
revoke all on schema azice_push from public,anon,authenticated,service_role;

create table public.notification_preferences(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 enabled boolean not null default false,
 friend_requests boolean not null default true,
 new_posts boolean not null default true,
 comments boolean not null default true,
 reactions boolean not null default true,
 posting_reminders boolean not null default false,
 timezone text not null default 'UTC',
 updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public,anon,authenticated;
grant select on public.notification_preferences to authenticated;
create policy notifications_read_own on public.notification_preferences for select to authenticated using(user_id=auth.uid());
create index notifications_reminder_candidates on public.notification_preferences(user_id) where enabled and posting_reminders;

create table azice_push.subscriptions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(length(endpoint)<=2048),
 p256dh text not null, auth text not null,
 binding text not null check(binding ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null default now()+interval '90 days'
);
create index push_subscription_owner on azice_push.subscriptions(user_id,expires_at);
create table azice_push.batches(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 category text not null check(category in ('friend_requests','new_posts','comments','reactions','posting_reminders')),
 created_at timestamptz not null default now(),
 due_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 token uuid, leased_until timestamptz, attempts integer not null default 0, done boolean not null default false
);
create index push_batches_due on azice_push.batches(due_at) where not done;
create table azice_push.jobs(
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique,
 user_id uuid not null references public.profiles(id) on delete cascade,
 category text not null,
 actor_id uuid references public.profiles(id) on delete cascade,
 post_id uuid references public.posts(id) on delete cascade,
 request_id uuid references public.friend_requests(id) on delete cascade,
 created_at timestamptz not null default now(), due_at timestamptz not null,
 batch_id uuid references azice_push.batches(id) on delete cascade
);
create index push_jobs_due on azice_push.jobs(due_at) where batch_id is null;
create index push_jobs_batch on azice_push.jobs(batch_id);
create table azice_push.deliveries(
 batch_id uuid references azice_push.batches(id) on delete cascade,
 subscription_id uuid references azice_push.subscriptions(id) on delete cascade,
 terminal boolean not null default false,
 primary key(batch_id,subscription_id)
);
create table azice_push.reservations(
 batch_id uuid references azice_push.batches(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 category text not null, local_day date not null, reserved_at timestamptz not null default now(),
 primary key(batch_id,local_day)
);
create index push_reservations_budget on azice_push.reservations(user_id,category,local_day);
-- Defense in depth: private tables have no browser policies, even if exposed accidentally.
alter table azice_push.subscriptions enable row level security;
alter table azice_push.batches enable row level security;
alter table azice_push.jobs enable row level security;
alter table azice_push.deliveries enable row level security;
alter table azice_push.reservations enable row level security;
revoke all on all tables in schema azice_push from public,anon,authenticated,service_role;

create function public.save_notification_preferences(p_preferences jsonb) returns public.notification_preferences
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.notification_preferences;
begin
 if u is null or not exists(select 1 from public.profiles where id=u) then raise exception 'Authentication required'; end if;
 insert into public.notification_preferences(user_id) values(u) on conflict do nothing;
 select * into p from public.notification_preferences where user_id=u for update;
 if p_preferences ? 'timezone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_preferences->>'timezone') then raise exception 'Invalid timezone'; end if;
 update public.notification_preferences set
 enabled=coalesce((p_preferences->>'enabled')::boolean,p.enabled),
 friend_requests=coalesce((p_preferences->>'friend_requests')::boolean,p.friend_requests),
 new_posts=coalesce((p_preferences->>'new_posts')::boolean,p.new_posts),
 comments=coalesce((p_preferences->>'comments')::boolean,p.comments),
 reactions=coalesce((p_preferences->>'reactions')::boolean,p.reactions),
 posting_reminders=coalesce((p_preferences->>'posting_reminders')::boolean,p.posting_reminders),
 timezone=coalesce(p_preferences->>'timezone',p.timezone),updated_at=now()
 where user_id=u returning * into p;
 -- Cancellation is final; opting back in must not replay old events or reset budgets.
 delete from azice_push.jobs j where j.user_id=u and (not p.enabled or not (to_jsonb(p)->>j.category)::boolean);
 update azice_push.batches b set done=true where b.user_id=u and (not p.enabled or not (to_jsonb(p)->>b.category)::boolean);
 if not p.enabled then delete from azice_push.subscriptions where user_id=u; end if;
 return p;
end $$;

-- Service-only registration. Edge Function authenticates the JWT and validates endpoints/keys.
create function public.push_register(p_user uuid,p_subscription jsonb,p_binding text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; owner_id uuid;
begin
 perform 1 from public.notification_preferences where user_id=p_user and enabled for update;
 if not found then raise exception 'Notifications disabled'; end if;
 select user_id into owner_id from azice_push.subscriptions where endpoint=p_subscription->>'endpoint';
 if owner_id is not null and owner_id<>p_user then raise exception 'Subscription unavailable'; end if;
 if owner_id is null and (select count(*) from azice_push.subscriptions where user_id=p_user)>=5 then raise exception 'Device limit reached'; end if;
 insert into azice_push.subscriptions(user_id,endpoint,p256dh,auth,binding)
 values(p_user,p_subscription->>'endpoint',p_subscription#>>'{keys,p256dh}',p_subscription#>>'{keys,auth}',p_binding)
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,binding=excluded.binding,expires_at=now()+interval '90 days'
 where azice_push.subscriptions.user_id=p_user returning id into result;
 return result;
end $$;
create function public.push_unregister(p_user uuid,p_endpoint text) returns void
language sql security definer set search_path='' as $$delete from azice_push.subscriptions where user_id=p_user and endpoint=p_endpoint$$;

create function azice_push.allowed(j azice_push.jobs) returns boolean
language sql stable security definer set search_path='' as $$
 select case
 when j.category='friend_requests' then exists(select 1 from public.friend_requests r where r.id=j.request_id and r.receiver_id=j.user_id and r.sender_id=j.actor_id and r.status='pending')
 when j.category='posting_reminders' then exists(
  select 1 from public.notification_preferences p where p.user_id=j.user_id and p.enabled and p.posting_reminders
   and extract(hour from now() at time zone p.timezone)=20
   and (j.created_at at time zone p.timezone)::date=(now() at time zone p.timezone)::date
   and not exists(select 1 from public.posts x where x.author_id=j.user_id and x.status='published' and (x.published_at at time zone p.timezone)::date=(now() at time zone p.timezone)::date)
   and exists(select 1 from public.posts x where x.status='published' and x.published_at>now()-interval '48 hours' and public.are_friends(x.author_id,j.user_id)))
 else exists(select 1 from public.posts p where p.id=j.post_id and p.status='published' and p.published_at>now()-interval '30 days'
  and j.actor_id<>j.user_id and public.are_friends(j.actor_id,j.user_id)
  and case when j.category='new_posts' then p.author_id=j.actor_id
   when j.category='comments' then p.author_id=j.user_id and exists(select 1 from public.comments c where 'comment:'||c.id::text||':'||j.user_id::text=j.event_key and c.post_id=p.id and c.author_id=j.actor_id)
   when j.category='reactions' then p.author_id=j.user_id and exists(select 1 from public.reactions r where r.post_id=p.id and r.user_id=j.actor_id)
   else false end)
 end
$$;
create function azice_push.enqueue(u uuid,c text,k text,a uuid default null,p uuid default null,r uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into azice_push.jobs(event_key,user_id,category,actor_id,post_id,request_id,due_at)
 select k,u,c,a,p,r,now()+case c when 'new_posts' then interval '10 minutes' when 'comments' then interval '3 minutes' when 'reactions' then interval '15 minutes' else interval '0' end
 from public.notification_preferences pref where pref.user_id=u and pref.enabled and (to_jsonb(pref)->>c)::boolean
  and exists(select 1 from azice_push.subscriptions s where s.user_id=u and s.expires_at>now())
 on conflict(event_key) do nothing
$$;
create function azice_push.capture() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if tg_table_name='friend_requests' then
  if new.status='pending' and (tg_op='INSERT' or old.status is distinct from new.status) then
   perform azice_push.enqueue(new.receiver_id,'friend_requests','request:'||new.id::text,new.sender_id,null,new.id);
  end if;
 elsif tg_table_name='posts' then
  if new.status='published' and new.published_at is not null and (tg_op='INSERT' or old.status is distinct from new.status) then
   for recipient in select case when f.user_a=new.author_id then f.user_b else f.user_a end from public.friendships f where new.author_id in (f.user_a,f.user_b) loop
    perform azice_push.enqueue(recipient,'new_posts','post:'||new.id::text||':'||recipient::text,new.author_id,new.id);
   end loop;
  end if;
 elsif tg_table_name='comments' then
  select author_id into recipient from public.posts where id=new.post_id and status='published';
  if recipient is not null and recipient<>new.author_id then perform azice_push.enqueue(recipient,'comments','comment:'||new.id::text||':'||recipient::text,new.author_id,new.post_id); end if;
 elsif tg_table_name='reactions' then
  select author_id into recipient from public.posts where id=new.post_id and status='published';
  if recipient is not null and recipient<>new.user_id then perform azice_push.enqueue(recipient,'reactions','reaction:'||new.post_id::text||':'||new.user_id::text,new.user_id,new.post_id); end if;
 end if;
 return new;
end $$;
create trigger push_friend_request after insert or update of status on public.friend_requests for each row execute function azice_push.capture();
create trigger push_published_post after insert or update of status on public.posts for each row execute function azice_push.capture();
create trigger push_comment after insert on public.comments for each row execute function azice_push.capture();
-- Emoji changes do not create new notifications. Reinsertion deduplicates by post/reactor.
create trigger push_reaction after insert on public.reactions for each row execute function azice_push.capture();

create function azice_push.reminders() returns void
language plpgsql security definer set search_path='' as $$
declare p public.notification_preferences;
begin
 for p in select * from public.notification_preferences where enabled and posting_reminders
  and exists(select 1 from azice_push.subscriptions s where s.user_id=notification_preferences.user_id and s.expires_at>now())
  and extract(hour from now() at time zone timezone)=20 and extract(minute from now() at time zone timezone)<30 loop
  if not exists(select 1 from public.posts x where x.author_id=p.user_id and x.status='published' and (x.published_at at time zone p.timezone)::date=(now() at time zone p.timezone)::date)
   and exists(select 1 from public.posts x where x.status='published' and x.published_at>now()-interval '48 hours' and public.are_friends(x.author_id,p.user_id)) then
   perform azice_push.enqueue(p.user_id,'posting_reminders','reminder:'||p.user_id::text||':'||(now() at time zone p.timezone)::date::text);
  end if;
 end loop;
end $$;

-- One bounded batch per call. Preferences row lock serializes each user's quota reservations.
create function public.push_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare b azice_push.batches; j azice_push.jobs; p public.notification_preferences; local_time timestamp; day date; next_time timestamptz; scan integer;
begin
 -- A short global transaction lock prevents duplicate grouping across concurrent dispatchers.
 if not pg_try_advisory_xact_lock(839204771) then return null; end if;
 delete from azice_push.batches where created_at<now()-interval '30 days';
 delete from azice_push.jobs where created_at<now()-interval '2 days' and batch_id is null;
 delete from azice_push.subscriptions where expires_at<now();
 for scan in 1..50 loop
 select * into b from azice_push.batches where not done and due_at<=now() and (leased_until is null or leased_until<now())
  and (category='friend_requests' or not exists(select 1 from azice_push.jobs where batch_id is null and category='friend_requests' and due_at<=now()))
  order by (category='friend_requests') desc,due_at limit 1 for update skip locked;
 if b.id is null then
  select * into j from azice_push.jobs where batch_id is null and due_at<=now() order by (category='friend_requests') desc,due_at limit 1 for update skip locked;
  if j.id is null then return null; end if;
  insert into azice_push.batches(user_id,category) values(j.user_id,j.category) returning * into b;
  update azice_push.jobs x set batch_id=b.id where x.batch_id is null and x.due_at<=now() and x.user_id=j.user_id and x.category=j.category
   and (case when j.category='friend_requests' then x.id=j.id when j.category in ('comments','reactions') then x.post_id=j.post_id else true end);
 end if;
 select * into p from public.notification_preferences where user_id=b.user_id for update;
 if p.user_id is null or not p.enabled or not (to_jsonb(p)->>b.category)::boolean or b.expires_at<=now() or b.attempts>=5
  or not exists(select 1 from azice_push.jobs x where x.batch_id=b.id and azice_push.allowed(x))
  or not exists(select 1 from azice_push.subscriptions s where s.user_id=b.user_id and s.expires_at>now()) then
  update azice_push.batches set done=true where id=b.id;continue;
 end if;
 local_time:=now() at time zone p.timezone;day:=local_time::date;
 if b.category<>'friend_requests' and (extract(hour from local_time)<9 or extract(hour from local_time)>=22) then
  next_time:=(date_trunc('day',local_time)+interval '9 hours'+case when extract(hour from local_time)>=22 then interval '1 day' else interval '0' end) at time zone p.timezone;
  update azice_push.batches set due_at=next_time where id=b.id;continue;
 end if;
 if not exists(select 1 from azice_push.reservations where batch_id=b.id and local_day=day) then
  if b.category='new_posts' and (select count(*) from azice_push.reservations where user_id=b.user_id and category=b.category and local_day=day)>=2 then
   update azice_push.batches set due_at=(day+1+time '09:00') at time zone p.timezone where id=b.id;continue;
  end if;
  if b.category='posting_reminders' and (select count(*) from azice_push.reservations where user_id=b.user_id and category=b.category and reserved_at>now()-interval '7 days')>=3 then
   update azice_push.batches set done=true where id=b.id;continue;
  end if;
  insert into azice_push.reservations(batch_id,user_id,category,local_day) values(b.id,b.user_id,b.category,day);
 end if;
 update azice_push.batches set token=gen_random_uuid(),leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=b.id returning * into b;
 insert into azice_push.deliveries(batch_id,subscription_id) select b.id,s.id from azice_push.subscriptions s where s.user_id=b.user_id and s.expires_at>now() on conflict do nothing;
 return jsonb_build_object('id',b.id,'token',b.token,'category',b.category,'devices',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.binding))
  from azice_push.deliveries d join azice_push.subscriptions s on s.id=d.subscription_id where d.batch_id=b.id and not d.terminal),'[]'::jsonb));
 end loop;
 return null;
end $$;

create function public.push_validate(p_batch uuid,p_token uuid,p_device uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from azice_push.batches b join public.notification_preferences p on p.user_id=b.user_id
  join azice_push.subscriptions s on s.user_id=b.user_id and s.id=p_device
  join azice_push.deliveries d on d.batch_id=b.id and d.subscription_id=s.id
  where b.id=p_batch and b.token=p_token and b.leased_until>now() and not b.done and b.expires_at>now() and not d.terminal
   and p.enabled and (to_jsonb(p)->>b.category)::boolean and s.expires_at>now()
   and (b.category='friend_requests' or extract(hour from now() at time zone p.timezone) between 9 and 21)
   and exists(select 1 from azice_push.jobs j where j.batch_id=b.id and azice_push.allowed(j)))
$$;
create function public.push_complete(p_batch uuid,p_token uuid,p_device uuid,p_result text) returns void
language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from azice_push.batches where id=p_batch and token=p_token and leased_until>now() and not done) then return; end if;
 if p_result='expired' then delete from azice_push.subscriptions where id=p_device and id in(select subscription_id from azice_push.deliveries where batch_id=p_batch);
 elsif p_result in ('sent','permanent','skipped') then update azice_push.deliveries set terminal=true where batch_id=p_batch and subscription_id=p_device;
 end if;
end $$;
create function public.push_release(p_batch uuid,p_token uuid) returns void
language sql security definer set search_path='' as $$
 update azice_push.batches b set done=not exists(select 1 from azice_push.deliveries d where d.batch_id=b.id and not d.terminal),
  leased_until=null,due_at=now()+make_interval(secs=>least(3600,30*(2^b.attempts)::integer)) where b.id=p_batch and b.token=p_token
$$;
create function public.resolve_notification(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b azice_push.batches; target uuid;
begin
 select * into b from azice_push.batches where id=p_id and user_id=auth.uid() and created_at>now()-interval '2 days';
 if b.id is null then return null; end if;
 if b.category='friend_requests' then return jsonb_build_object('screen','friends'); end if;
 if b.category='posting_reminders' then return jsonb_build_object('screen','feed'); end if;
 select j.post_id into target from azice_push.jobs j where j.batch_id=b.id and azice_push.allowed(j) and public.can_view_post(j.post_id) order by j.created_at desc limit 1;
 if target is null then return null; end if;
 return jsonb_build_object('screen','post','post_id',target);
end $$;

-- Exact, object-scoped ACLs; hostile defaults must not expose SECURITY DEFINER wrappers.
do $$declare f record; grantee record; role_name text; begin
 -- Revoke hostile default grants on this new namespace and its new tables only.
 for f in select 'schema' as kind,n.oid,n.nspowner as owner_id,n.nspacl as acl,quote_ident(n.nspname) as name from pg_namespace n where n.nspname='azice_push'
  union all select 'table',c.oid,c.relowner,c.relacl,format('%I.%I',n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='azice_push' and c.relkind='r' loop
  for grantee in select distinct x.grantee from aclexplode(coalesce(f.acl,acldefault(case when f.kind='schema' then 'n'::"char" else 'r'::"char" end,f.owner_id))) x where x.grantee<>f.owner_id loop
   role_name:=case when grantee.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grantee.grantee)) end;
   execute format('revoke all on %s %s from %s',f.kind,f.name,role_name);
  end loop;
 end loop;
 for f in select p.oid,p.proowner,p.proacl,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='azice_push' or p.oid=any(array[
   'public.save_notification_preferences(jsonb)'::regprocedure,'public.push_register(uuid,jsonb,text)'::regprocedure,
   'public.push_unregister(uuid,text)'::regprocedure,'public.push_claim()'::regprocedure,'public.push_validate(uuid,uuid,uuid)'::regprocedure,
   'public.push_complete(uuid,uuid,uuid,text)'::regprocedure,'public.push_release(uuid,uuid)'::regprocedure,'public.resolve_notification(uuid)'::regprocedure]) loop
  for grantee in select distinct x.grantee from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) x where x.grantee<>f.proowner loop
   role_name:=case when grantee.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grantee.grantee)) end;
   execute format('revoke all on function %s from %s',f.oid::regprocedure,role_name);
  end loop;
  if f.nspname='public' then
   execute format('grant execute on function %s to %I',f.oid::regprocedure,case when f.proname in ('save_notification_preferences','resolve_notification') then 'authenticated' else 'service_role' end);
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
