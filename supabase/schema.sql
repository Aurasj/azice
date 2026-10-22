-- AziCe? v0.1 — run ONCE in a NEW, SEPARATE Supabase project.
-- Requires PostgreSQL 15+ and Supabase Auth/Storage. Do not run against Beyuno.
-- This is an initial beta schema, not a substitute for production security review.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  bio text not null default '' check (char_length(bio) <= 150),
  avatar_path text,
  is_18_plus_confirmed boolean not null default false check (is_18_plus_confirmed = true),
  created_at timestamptz not null default now()
);

create table public.invites (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique,
  updated_at timestamptz not null default now()
);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','canceled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);
create unique index one_pending_request_per_pair on public.friend_requests
  (least(sender_id, receiver_id), greatest(sender_id, receiver_id)) where status = 'pending';

create table public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a,user_b),
  check (user_a < user_b)
);
create index friendships_b_idx on public.friendships (user_b);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('drank','sober')),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index posts_recent_idx on public.posts (published_at desc) where status = 'published';
create index posts_author_idx on public.posts (author_id,published_at desc);

create table public.post_photos (
  post_id uuid not null references public.posts(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  path text not null unique,
  primary key (post_id,slot)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments(post_id,created_at);

create table public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('😂','❤️','😮','🔥','👏')),
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);

-- Intentionally small security-definer helpers; never use unrestricted public data reads.
create function public.are_friends(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path = public
as $$select exists(select 1 from public.friendships f where f.user_a = least(p_a,p_b) and f.user_b = greatest(p_a,p_b))$$;

create function public.can_view_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = public
as $$
 select auth.uid() is not null and (
 p_profile = auth.uid() or public.are_friends(p_profile,auth.uid()) or exists (
  select 1 from public.friend_requests r
  where r.status='pending' and
  ((r.sender_id=auth.uid() and r.receiver_id=p_profile)
    or (r.receiver_id=auth.uid() and r.sender_id=p_profile))
  )
 )
$$;

create function public.can_view_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public
as $$
 select exists (select 1 from public.posts p
 where p.id=p_post and auth.uid() is not null
 and (p.author_id=auth.uid() or
 (p.status='published' and p.published_at >= now()-interval '30 days'
  and public.are_friends(p.author_id,auth.uid()))))
$$;

create function public.can_interact_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public
as $$
 select exists (select 1 from public.posts p
 where p.id=p_post and p.status='published'
 and p.published_at >= now()-interval '48 hours'
 and auth.uid() is not null
 and (p.author_id=auth.uid() or public.are_friends(p.author_id,auth.uid())))
$$;

alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.posts enable row level security;
alter table public.post_photos enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (public.can_view_profile(id));
create policy profiles_insert on public.profiles for insert to authenticated with check (id=auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy invites_read_own on public.invites for select to authenticated using (user_id=auth.uid());
create policy requests_read_own on public.friend_requests for select to authenticated
using (sender_id=auth.uid() or receiver_id=auth.uid());
create policy friends_read_own on public.friendships for select to authenticated
using (user_a=auth.uid() or user_b=auth.uid());
create policy posts_read on public.posts for select to authenticated using (public.can_view_post(id));
create policy posts_insert_draft on public.posts for insert to authenticated
with check (author_id=auth.uid() and status='draft' and published_at is null);
create policy photos_read on public.post_photos for select to authenticated
using (public.can_view_post(post_id));
create policy photos_add_draft on public.post_photos for insert to authenticated
with check (
 exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid() and p.status='draft')
 and path like auth.uid()::text || '/' || post_id::text || '/%'
);
create policy comments_read on public.comments for select to authenticated using (public.can_view_post(post_id));
create policy comments_add on public.comments for insert to authenticated
with check(author_id=auth.uid() and public.can_interact_post(post_id));
create policy reactions_read on public.reactions for select to authenticated using (public.can_view_post(post_id));
create policy reactions_add on public.reactions for insert to authenticated
with check(user_id=auth.uid() and public.can_interact_post(post_id));
create policy reactions_modify on public.reactions for update to authenticated
using (user_id=auth.uid() and public.can_interact_post(post_id))
with check (user_id=auth.uid() and public.can_interact_post(post_id));
create policy reactions_remove on public.reactions for delete to authenticated
using (user_id=auth.uid() and public.can_interact_post(post_id));

-- Capture comment author label server-side; clients cannot impersonate a name.
create function public.set_comment_author_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 select display_name into new.author_name from public.profiles where id=new.author_id;
 return new;
end $$;
create trigger comments_author_name before insert on public.comments
for each row execute function public.set_comment_author_name();

create function public.rotate_invite() returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then
  raise exception 'Profile required';
 end if;
 t := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
 insert into public.invites(user_id,token,updated_at) values(auth.uid(),t,now())
 on conflict(user_id) do update set token=excluded.token,updated_at=now();
 return t;
end $$;

create function public.preview_invite(p_token text)
returns table(id uuid,display_name text,username text)
language sql stable security definer set search_path = public as $$
 select p.id,p.display_name,p.username from public.invites i
 join public.profiles p on p.id=i.user_id where i.token=p_token limit 1
$$;

create function public.send_friend_request(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare recipient uuid; request_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profile required'; end if;
 select user_id into recipient from public.invites where token=p_token;
 if recipient is null then raise exception 'Invite not found or revoked'; end if;
 if recipient=auth.uid() then raise exception 'You cannot add yourself'; end if;
 if public.are_friends(recipient,auth.uid()) then raise exception 'Already friends'; end if;
 if (select count(*) from public.friend_requests where sender_id=auth.uid() and created_at>now()-interval '1 hour') >= 30 then
   raise exception 'Too many friend requests. Try again later.';
 end if;
 if exists(select 1 from public.friend_requests where status='pending' and
   least(sender_id,receiver_id)=least(recipient,auth.uid()) and
   greatest(sender_id,receiver_id)=greatest(recipient,auth.uid())) then
   raise exception 'A request is already pending';
 end if;
 insert into public.friend_requests(sender_id,receiver_id) values(auth.uid(),recipient) returning id into request_id;
 return request_id;
end $$;

create function public.handle_friend_request(p_request_id uuid,p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.friend_requests%rowtype;
begin
 select * into r from public.friend_requests where id=p_request_id for update;
 if r.id is null or r.status<>'pending' then raise exception 'Pending request not found'; end if;
 if p_action='cancel' then
  if r.sender_id<>auth.uid() then raise exception 'Not allowed'; end if;
  update public.friend_requests set status='canceled',responded_at=now() where id=r.id;
 elsif p_action in ('accept','decline') then
  if r.receiver_id<>auth.uid() then raise exception 'Not allowed'; end if;
  update public.friend_requests set status=case when p_action='accept' then 'accepted' else 'declined' end,responded_at=now() where id=r.id;
  if p_action='accept' then
   insert into public.friendships(user_a,user_b) values(least(r.sender_id,r.receiver_id),greatest(r.sender_id,r.receiver_id)) on conflict do nothing;
  end if;
 else raise exception 'Unknown action'; end if;
end $$;

create function public.remove_friend(p_friend_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null or p_friend_id=auth.uid() then raise exception 'Not allowed'; end if;
 delete from public.friendships where user_a=least(auth.uid(),p_friend_id) and user_b=greatest(auth.uid(),p_friend_id);
end $$;

create function public.publish_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.posts%rowtype; photo_count integer;
begin
 select * into p from public.posts where id=p_post_id for update;
 if p.id is null or p.author_id<>auth.uid() or p.status<>'draft' then raise exception 'Draft not found'; end if;
 select count(*) into photo_count from public.post_photos where post_id=p_post_id;
 if photo_count>3 or (p.kind='drank' and photo_count<1) then raise exception 'Invalid photo count'; end if;
 update public.posts set status='published',published_at=now() where id=p_post_id;
end $$;

-- Storage: both buckets PRIVATE. Never call getPublicUrl for private content.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values
 ('post-images','post-images',false,5242880,array['image/jpeg']),
 ('avatars','avatars',false,5242880,array['image/jpeg'])
on conflict(id) do nothing;

create policy post_image_insert on storage.objects for insert to authenticated
with check(bucket_id='post-images' and name like auth.uid()::text || '/%');
create policy post_image_select on storage.objects for select to authenticated using (
 bucket_id='post-images' and exists (
 select 1 from public.post_photos pp where pp.path=storage.objects.name and public.can_view_post(pp.post_id))
);
create policy avatar_insert on storage.objects for insert to authenticated
with check(bucket_id='avatars' and name like auth.uid()::text || '/%');
create policy avatar_select on storage.objects for select to authenticated
using(bucket_id='avatars' and
  (split_part(name,'/',1)=auth.uid()::text
   or (split_part(name,'/',1) ~ '^[0-9a-f-]{36}$'
       and public.can_view_profile(split_part(name,'/',1)::uuid))));
create policy avatar_remove on storage.objects for delete to authenticated
using(bucket_id='avatars' and name like auth.uid()::text || '/%');

revoke all on function public.rotate_invite() from public;
revoke all on function public.preview_invite(text) from public;
revoke all on function public.send_friend_request(text) from public;
revoke all on function public.handle_friend_request(uuid,text) from public;
revoke all on function public.remove_friend(uuid) from public;
revoke all on function public.publish_post(uuid) from public;
grant execute on function public.rotate_invite() to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.handle_friend_request(uuid,text) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.publish_post(uuid) to authenticated;
