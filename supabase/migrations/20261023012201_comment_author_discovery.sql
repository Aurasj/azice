-- UNDEPLOYED migration, revised after privacy/concurrency review.
-- Apply once to the existing AziCe? database; never rerun schema.sql.
begin;

-- Fail closed on owner/namespace mismatches instead of changing unrelated ACLs
-- or creating a helper that the existing invitation-function owner cannot call.
do $$
declare owner_id oid := (select oid from pg_catalog.pg_roles where rolname=current_user);
 privileged boolean;
begin
 if pg_catalog.to_regnamespace('azice_private') is not null then
  raise exception 'azice_private already exists: review ownership and choose a fresh migration namespace';
 end if;
 if (select proowner from pg_catalog.pg_proc where oid='public.send_friend_request(text)'::regprocedure) <> owner_id
 or (select relowner from pg_catalog.pg_class where oid='public.profiles'::regclass) <> owner_id
 or (select proowner from pg_catalog.pg_proc where oid='public.can_view_profile(uuid)'::regprocedure) <> owner_id then
  raise exception 'Run as the existing owner of send_friend_request, profiles, and can_view_profile';
 end if;
 if pg_catalog.pg_has_role('authenticated',owner_id,'MEMBER') or pg_catalog.pg_has_role('anon',owner_id,'MEMBER') then
  raise exception 'API roles must not inherit the migration/function owner';
 end if;
 if not pg_catalog.has_function_privilege(owner_id,'auth.uid()','EXECUTE')
 or not pg_catalog.has_function_privilege(owner_id,'public.are_friends(uuid,uuid)','EXECUTE')
 or not pg_catalog.has_function_privilege(owner_id,'public.can_view_post(uuid)','EXECUTE')
 or not pg_catalog.has_function_privilege(owner_id,'public.can_view_profile(uuid)','EXECUTE') then
  raise exception 'Migration owner lacks EXECUTE on an existing authorization helper';
 end if;
 -- Before changing a shared authorization helper, verify the inspected
 -- Storage policy dependencies are still intact; no Storage DDL is attempted.
 if not exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='storage' and tablename='objects'
   and policyname='avatar_select' and cmd='SELECT'
   and 'authenticated'=any(roles) and qual like '%can_view_profile%'
 ) or not exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='storage' and tablename='objects'
   and policyname='post_image_select' and cmd='SELECT'
   and qual like '%post-images%'
 ) or exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='storage' and tablename='objects'
   and cmd in ('SELECT','ALL') and permissive='PERMISSIVE'
   and policyname not in ('avatar_select','post_image_select')
 ) then
  raise exception 'Unexpected Storage SELECT policy set: review avatar authorization';
 end if;
 select rolsuper or rolbypassrls into privileged from pg_catalog.pg_roles where oid=owner_id;
 if not privileged and exists(
  select 1 from pg_catalog.pg_class c where c.oid=any(array[
   'public.profiles'::regclass,'public.posts'::regclass,'public.comments'::regclass,
   'public.friendships'::regclass,'public.friend_requests'::regclass,'public.invites'::regclass])
   and (c.relowner<>owner_id or c.relforcerowsecurity)
 ) then raise exception 'Function owner cannot safely execute the explicit authorization wrappers'; end if;
end $$;

create schema azice_private;

-- The deployed profiles_read and avatar_select policies BOTH call this
-- existing SECURITY DEFINER helper. Narrow it once, at its owner, so neither
-- pending-request peers nor unknown users can see private profiles or avatars.
-- CREATE OR REPLACE preserves its function identity/ACLs and existing callers.
-- Critically, there is NO DDL against storage.objects (owned in hosted Supabase
-- by supabase_storage_admin rather than postgres).
create or replace function public.can_view_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and (
  p_profile = auth.uid() or public.are_friends(p_profile,auth.uid())
 )
$$;

-- An extra restrictive RLS guard protects private profile rows even if some
-- other permissive SELECT policy is added. Existing permissive policy remains.
create policy profiles_confirmed_read_guard on public.profiles as restrictive
for select to authenticated using (id=auth.uid() or public.are_friends(id,auth.uid()));

-- NO new avatar policy is needed. Existing storage.avatar_select already calls
-- public.can_view_profile, so it inherits the narrowed authorization. This
-- depends on the reviewed hosted policies; verify them again before release.

-- Only trusted definer wrappers can invoke this UUID-taking helper.
create function azice_private.create_friend_request(p_recipient uuid, p_comment_id uuid default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
 caller uuid := auth.uid();
 pending public.friend_requests%rowtype;
 visible_comment public.comments%rowtype;
 visible_post public.posts%rowtype;
 request_id uuid;
begin
 if caller is null or not exists(select 1 from public.profiles where id=caller) then raise exception 'Profile required'; end if;
 if p_recipient is null or not exists(select 1 from public.profiles where id=p_recipient) then raise exception 'User unavailable.'; end if;
 if p_recipient=caller then raise exception 'You cannot add yourself'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('azice:request-sender:' || caller::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'azice:request-pair:' || least(caller,p_recipient)::text || ':' || greatest(caller,p_recipient)::text,0));

 if p_comment_id is not null then
  -- Real row locks also coordinate with existing DELETE/UPDATE/cascade paths.
  -- A revoker that wins first makes these reads fail; otherwise it waits until
  -- this request transaction commits. No change to remove_friend is required.
  select c.* into visible_comment from public.comments c where c.id=p_comment_id for share;
  if not found or visible_comment.author_id<>p_recipient then raise exception 'User unavailable.'; end if;
  select p.* into visible_post from public.posts p where p.id=visible_comment.post_id for share;
  if not found or visible_post.status<>'published' then raise exception 'User unavailable.'; end if;
  if visible_post.author_id<>caller then
   perform 1 from public.friendships f
   where f.user_a=least(caller,visible_post.author_id) and f.user_b=greatest(caller,visible_post.author_id) for share;
   if not found then raise exception 'User unavailable.'; end if;
  end if;
 end if;

 select * into pending from public.friend_requests r
 where r.status='pending' and least(r.sender_id,r.receiver_id)=least(caller,p_recipient)
  and greatest(r.sender_id,r.receiver_id)=greatest(caller,p_recipient) for update;
 -- Recheck after all potentially blocking authorization/request locks. The held
 -- SHARE locks protect the exact author, post and visibility-granting friendship.
 if p_comment_id is not null and (
  not public.can_view_post(visible_post.id) or
  (visible_post.author_id<>caller and visible_post.published_at<pg_catalog.clock_timestamp()-interval '30 days')
 ) then raise exception 'User unavailable.'; end if;
 if public.are_friends(caller,p_recipient) then raise exception 'Already friends'; end if;
 if pending.id is not null then
  if pending.sender_id=caller then return pending.id; end if;
  raise exception 'A request is already pending';
 end if;
 if (select count(*) from public.friend_requests where sender_id=caller and created_at>now()-interval '1 hour') >= 30 then
  raise exception 'Too many friend requests. Try again later.';
 end if;
 insert into public.friend_requests(sender_id,receiver_id) values(caller,p_recipient)
 on conflict do nothing returning id into request_id;
 if request_id is null then raise exception 'A request is already pending'; end if;
 return request_id;
exception when foreign_key_violation then raise exception 'User unavailable.';
end $$;

-- Preserve invitation-token requests and share the existing pair/quota logic.
create or replace function public.send_friend_request(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profile required'; end if;
 select user_id into recipient from public.invites where token=p_token;
 if recipient is null then raise exception 'Invite not found or revoked'; end if;
 return azice_private.create_friend_request(recipient);
end $$;
revoke all on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

create function public.comment_author_card(p_comment_id uuid)
returns table(id uuid,display_name text,username text,avatar_path text,relationship text,request_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare target uuid; pending public.friend_requests%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles me where me.id=auth.uid()) then raise exception 'User unavailable.'; end if;
 select c.author_id into target from public.comments c join public.posts p on p.id=c.post_id
 where c.id=p_comment_id and p.status='published' and public.can_view_post(c.post_id);
 if target is null then raise exception 'User unavailable.'; end if;
 select * into pending from public.friend_requests r where r.status='pending'
 and least(r.sender_id,r.receiver_id)=least(auth.uid(),target)
 and greatest(r.sender_id,r.receiver_id)=greatest(auth.uid(),target);
 return query select p.id,p.display_name,p.username,
  case when public.can_view_profile(p.id) and (p.id=auth.uid() or public.are_friends(p.id,auth.uid())) then p.avatar_path else null::text end,
  case when target=auth.uid() then 'self'
       when public.are_friends(auth.uid(),target) then 'friends'
       when pending.sender_id=auth.uid() then 'outgoing'
       when pending.receiver_id=auth.uid() then 'incoming'
       else 'none' end,
  pending.id from public.profiles p where p.id=target;
end $$;

create function public.send_comment_friend_request(p_comment_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'User unavailable.'; end if;
 select c.author_id into target from public.comments c join public.posts p on p.id=c.post_id
 where c.id=p_comment_id and p.status='published' and public.can_view_post(c.post_id);
 if target is null then raise exception 'User unavailable.'; end if;
 return azice_private.create_friend_request(target,p_comment_id);
end $$;

-- A parameterless, minimal projection for existing incoming/outgoing lists.
-- It reveals no arbitrary user's identity and no bio/private profile columns.
create function public.pending_friend_request_profiles()
returns table(id uuid,display_name text,username text,avatar_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles me where me.id=auth.uid()) then raise exception 'User unavailable.'; end if;
 return query select p.id,p.display_name,p.username,
  case when public.can_view_profile(p.id) and (p.id=auth.uid() or public.are_friends(p.id,auth.uid())) then p.avatar_path else null::text end
 from public.profiles p where exists(
  select 1 from public.friend_requests r where r.status='pending' and
   ((r.sender_id=auth.uid() and r.receiver_id=p.id) or (r.receiver_id=auth.uid() and r.sender_id=p.id))
 );
end $$;

-- Remove ALL non-owner default grants, including custom-role defaults, from
-- ONLY objects created by this migration. Do not touch unrelated schema ACLs.
do $$
declare entry record; granted record; role_sql text;
begin
 for granted in select distinct a.grantee from pg_catalog.pg_namespace n,
  lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
  where n.nspname='azice_private' and a.grantee<>n.nspowner
 loop
  role_sql := case when granted.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(granted.grantee)) end;
  execute 'revoke all on schema azice_private from ' || role_sql;
 end loop;
 for entry in select p.oid,p.proowner from pg_catalog.pg_proc p where p.oid=any(array[
  'azice_private.create_friend_request(uuid,uuid)'::regprocedure,
  'public.comment_author_card(uuid)'::regprocedure,
  'public.send_comment_friend_request(uuid)'::regprocedure,
  'public.pending_friend_request_profiles()'::regprocedure])
 loop
  for granted in select distinct a.grantee from pg_catalog.pg_proc p,
   lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   where p.oid=entry.oid and a.grantee<>entry.proowner
  loop
   role_sql := case when granted.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(granted.grantee)) end;
   execute pg_catalog.format('revoke all on function %s from %s',entry.oid::regprocedure,role_sql);
  end loop;
 end loop;
end $$;
-- Explicit denials also make the intended private boundary clear on fresh defaults.
revoke all on schema azice_private from public, anon, authenticated;
revoke all on function azice_private.create_friend_request(uuid,uuid) from public, anon, authenticated;
revoke all on function public.comment_author_card(uuid) from public, anon;
revoke all on function public.send_comment_friend_request(uuid) from public, anon;
revoke all on function public.pending_friend_request_profiles() from public, anon;
grant execute on function public.comment_author_card(uuid) to authenticated;
grant execute on function public.send_comment_friend_request(uuid) to authenticated;
grant execute on function public.pending_friend_request_profiles() to authenticated;

notify pgrst, 'reload schema';
commit;
