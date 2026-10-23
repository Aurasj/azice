-- Forward-only Activity metadata. Independent of Web Push and notification preferences.
begin;
create schema azice_activity;
revoke all on schema azice_activity from public,anon,authenticated,service_role;

create table public.activity_notifications(
 event_key text primary key,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,
 category text not null check(category in ('comment','reaction')),
 post_id uuid not null references public.posts(id) on delete cascade,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 check(recipient_id<>actor_id)
);
create index activity_recipient_recent on public.activity_notifications(recipient_id,created_at desc,event_key desc);
create index activity_unread on public.activity_notifications(recipient_id,created_at desc) where read_at is null;
create index activity_actor on public.activity_notifications(actor_id);
create index activity_post on public.activity_notifications(post_id);
create index activity_expiry on public.activity_notifications(created_at);
alter table public.activity_notifications enable row level security;
revoke all on public.activity_notifications from public,anon,authenticated,service_role;
grant select on public.activity_notifications to authenticated;
create policy activity_read_own on public.activity_notifications for select to authenticated using(
 recipient_id=(select auth.uid()) and created_at>now()-interval '30 days'
 and public.can_view_post(post_id)
 and exists(select 1 from public.posts p where p.id=post_id and p.author_id=(select auth.uid()) and p.status='published')
);

create function azice_activity.capture() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; actor uuid; kind text; identity text;
begin
 if tg_table_name='comments' then
  actor:=new.author_id;kind:='comment';identity:='comment:'||new.id::text;
 else
  actor:=new.user_id;kind:='reaction';identity:='reaction:'||new.post_id::text||':'||actor::text;
 end if;
 -- Source RLS is unchanged; independently require the same authenticated actor/access.
 if actor is distinct from auth.uid() or not public.can_interact_post(new.post_id) then return new; end if;
 select author_id into recipient from public.posts where id=new.post_id and status='published';
 if recipient is null or recipient=actor or not public.are_friends(actor,recipient) then return new; end if;
 delete from public.activity_notifications where recipient_id=recipient and created_at<=now()-interval '30 days';
 insert into public.activity_notifications(event_key,recipient_id,actor_id,category,post_id)
 values(identity,recipient,actor,kind,new.post_id) on conflict(event_key) do nothing;
 return new;
end $$;
revoke all on function azice_activity.capture() from public,anon,authenticated,service_role;
create trigger activity_comment after insert on public.comments for each row execute function azice_activity.capture();
-- Updates do not notify. Remove/reinsert also keeps the original event/read state.
create trigger activity_reaction after insert on public.reactions for each row execute function azice_activity.capture();

create function public.get_activity() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.event_key desc)
   from (select * from public.activity_notifications order by created_at desc,event_key desc limit 50) a),'[]'::jsonb),
  'unread',exists(select 1 from public.activity_notifications where read_at is null)
 )
$$;
revoke all on function public.get_activity() from public,anon,authenticated,service_role;
grant execute on function public.get_activity() to authenticated;

create function public.mark_activity_read(p_event_key text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return false; end if;
 update public.activity_notifications a set read_at=coalesce(a.read_at,now())
 where a.event_key=p_event_key and a.recipient_id=auth.uid() and a.created_at>now()-interval '30 days'
  and public.can_view_post(a.post_id)
  and exists(select 1 from public.posts p where p.id=a.post_id and p.author_id=auth.uid() and p.status='published');
 return found;
end $$;
revoke all on function public.mark_activity_read(text) from public,anon,authenticated,service_role;
grant execute on function public.mark_activity_read(text) to authenticated;

create function azice_activity.purge() returns void
language sql security definer set search_path='' as $$
 delete from public.activity_notifications where created_at<=now()-interval '30 days'
$$;
revoke all on function azice_activity.purge() from public,anon,authenticated,service_role;
-- Separate retention maintenance only. Never replace or invoke the Web Push cron job.
do $$begin
 if to_regclass('cron.job') is not null then
  if exists(select 1 from cron.job where jobname='azice-activity-retention') then
   raise exception 'Activity retention job already exists; review before applying';
  end if;
  perform cron.schedule('azice-activity-retention','17 3 * * *','select azice_activity.purge();');
 else
  raise notice 'pg_cron unavailable: schedule azice_activity.purge() separately for physical retention. Expired rows are always hidden by RLS.';
 end if;
end $$;
commit;
