-- Follow-up to the already deployed Web Push migration. Apply this file only once.
begin;
do $$begin
 -- Fail closed if the deployed RPCs are absent: never create wrappers with default ACLs.
 perform 'public.push_claim()'::regprocedure,'public.push_validate(uuid,uuid,uuid)'::regprocedure;
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Run as the reviewed database administrator with BYPASSRLS';
 end if;
 if pg_has_role('authenticated',current_user,'MEMBER') or pg_has_role('anon',current_user,'MEMBER') then
  raise exception 'Browser roles must not inherit the migration owner';
 end if;
end $$;
-- Serialize the one-time repair with claimers; leased in-flight batches are excluded.
select pg_advisory_xact_lock(839204771);
-- CREATE OR REPLACE preserves existing owners and exact EXECUTE ACLs.
-- Keep SECURITY DEFINER, the empty search_path, signatures and live authorization checks.
create or replace function public.push_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare b azice_push.batches; j azice_push.jobs; p public.notification_preferences; local_time timestamp; day date; scan integer;
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
 if not exists(select 1 from azice_push.reservations where batch_id=b.id and local_day=day) then
  if b.category='new_posts' and (select count(*) from azice_push.reservations where user_id=b.user_id and category=b.category and local_day=day)>=2 then
   update azice_push.batches set due_at=(day+1+time '00:00') at time zone p.timezone where id=b.id;continue;
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

create or replace function public.push_validate(p_batch uuid,p_token uuid,p_device uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from azice_push.batches b join public.notification_preferences p on p.user_id=b.user_id
  join azice_push.subscriptions s on s.user_id=b.user_id and s.id=p_device
  join azice_push.deliveries d on d.batch_id=b.id and d.subscription_id=s.id
  where b.id=p_batch and b.token=p_token and b.leased_until>now() and not b.done and b.expires_at>now() and not d.terminal
   and p.enabled and (to_jsonb(p)->>b.category)::boolean and s.expires_at>now()
   and exists(select 1 from azice_push.jobs j where j.batch_id=b.id and azice_push.allowed(j)))
$$;

-- Recalculate valid future batch deadlines from their remaining constraints, rather
-- than identifying 09:00 in today's timezone (the saved timezone may have changed).
-- Grouping deadlines, daily budgets and legitimate retry backoff remain protected.
-- Never recreate events, extend expiry, reset quotas/attempts, or erase device receipts.
-- For attempted batches, retain a conservative full retry backoff (at most one hour),
-- capped at the old deadline: no legitimate retry is accelerated by this repair.
update azice_push.batches b
set due_at=greatest(now(),
 (select max(j.due_at) from azice_push.jobs j where j.batch_id=b.id),
 case when b.attempts>0 then least(b.due_at,now()+make_interval(secs=>least(3600,30*(2^b.attempts)::integer))) else now() end,
 case when b.category='new_posts'
  and not exists(select 1 from azice_push.reservations r where r.batch_id=b.id and r.local_day=(now() at time zone p.timezone)::date)
  and (select count(*) from azice_push.reservations r where r.user_id=b.user_id and r.category='new_posts' and r.local_day=(now() at time zone p.timezone)::date)>=2
 then (((now() at time zone p.timezone)::date+1)+time '00:00') at time zone p.timezone else now() end)
from public.notification_preferences p
where p.user_id=b.user_id and p.enabled and (to_jsonb(p)->>b.category)::boolean
 and b.category in ('new_posts','comments','reactions') and not b.done
 and b.due_at>now()
 and b.expires_at>now() and b.attempts<5 and (b.leased_until is null or b.leased_until<now())
 and exists(select 1 from azice_push.jobs j where j.batch_id=b.id and azice_push.allowed(j))
 and exists(select 1 from azice_push.subscriptions s where s.user_id=b.user_id and s.expires_at>now());

-- Reminders still use allowed()'s same-local-day 20:00 hour gate and reminders()'s
-- 20:00-20:29 enqueue window. Stale reminders are never released into overnight delivery.
notify pgrst,'reload schema';
commit;
