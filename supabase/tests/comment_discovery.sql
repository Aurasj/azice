-- OPTIONAL LOCAL DATABASE REGRESSION TEST (never run against production).
-- Requires schema.sql + the comment_author_discovery migration in a disposable
-- Supabase database. Run as its postgres owner with psql -v ON_ERROR_STOP=1 -f ...
-- All fixture data and test-only helpers are rolled back.
begin;

create function public.azice_discovery_test_expect_error(statement text, expected text) returns void
language plpgsql security invoker set search_path = '' as $$
declare failed boolean := false;
begin
 begin execute statement;
 exception when others then
  failed := true;
  if sqlerrm <> expected then raise exception 'Unexpected error: % (expected %)',sqlerrm,expected; end if;
 end;
 if not failed then raise exception 'Expected rejection: %',statement; end if;
end $$;
grant execute on function public.azice_discovery_test_expect_error(text,text) to authenticated;

insert into auth.users(id,email) values
 ('aa000000-0000-4000-8000-000000000001','azice-a-test@example.invalid'),
 ('bb000000-0000-4000-8000-000000000002','azice-b-test@example.invalid'),
 ('cc000000-0000-4000-8000-000000000003','azice-c-test@example.invalid');
insert into public.profiles(id,display_name,username,bio,avatar_path,is_18_plus_confirmed) values
 ('aa000000-0000-4000-8000-000000000001','Test A','azice_discovery_a','A private bio',null,true),
 ('bb000000-0000-4000-8000-000000000002','Test B','azice_discovery_b','B private bio',null,true),
 ('cc000000-0000-4000-8000-000000000003','Test C','azice_discovery_c','C private bio','cc000000-0000-4000-8000-000000000003/avatar.jpg',true);
insert into public.friendships(user_a,user_b) values
 ('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002'),
 ('bb000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003');
insert into public.posts(id,author_id,kind,reason,status,published_at) values
 ('dd000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002','sober','B post','published',now()),
 ('dd000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003','sober','C PRIVATE post','published',now()),
 ('dd000000-0000-4000-8000-000000000003','bb000000-0000-4000-8000-000000000002','sober','B expired post','published',now()-interval '31 days'),
 ('dd000000-0000-4000-8000-000000000004','bb000000-0000-4000-8000-000000000002','sober','B draft','draft',null);
insert into public.comments(id,post_id,author_id,body) values
 ('ee000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000003','C comments on B'),
 ('ee000000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003','Private C comment'),
 ('ee000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000003','Expired comment'),
 ('ee000000-0000-4000-8000-000000000004','dd000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000003','Admin-seeded draft comment'),
 ('ee000000-0000-4000-8000-000000000005','dd000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','A own comment');
insert into public.invites(user_id,token) values
 ('cc000000-0000-4000-8000-000000000003','azice-discovery-test-token');
insert into storage.objects(bucket_id,name) values
 ('avatars','cc000000-0000-4000-8000-000000000003/avatar.jpg');
-- The new restrictive guard must resist another permissive profile SELECT policy.
create policy azice_test_extra_profile_read on public.profiles for select to authenticated using (true);

-- New RPCs must be inaccessible to anon; UUID helper inaccessible to authenticated.
do $$begin
 if has_function_privilege('anon','public.comment_author_card(uuid)','execute')
 or has_function_privilege('anon','public.send_comment_friend_request(uuid)','execute')
 or has_function_privilege('authenticated','azice_private.create_friend_request(uuid,uuid)','execute')
 then raise exception 'Incorrect execute grants'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
do $$declare card record; first_request uuid; second_request uuid;
begin
 select * into strict card from public.comment_author_card('ee000000-0000-4000-8000-000000000001');
 if card.id <> 'cc000000-0000-4000-8000-000000000003'::uuid or card.relationship <> 'none' or card.avatar_path is not null then
  raise exception 'Incorrect non-friend card or avatar leak';
 end if;
 if exists(select 1 from public.profiles where id='cc000000-0000-4000-8000-000000000003')
 or exists(select 1 from public.posts where author_id='cc000000-0000-4000-8000-000000000003') then
  raise exception 'Discovery broadened normal profile/post RLS';
 end if;
 if not exists(select 1 from public.profiles where id='aa000000-0000-4000-8000-000000000001' and bio='A private bio')
 or not exists(select 1 from public.profiles where id='bb000000-0000-4000-8000-000000000002' and bio='B private bio') then
  raise exception 'Self/confirmed-friend profile access regressed';
 end if;
 perform public.azice_discovery_test_expect_error($q$select public.comment_author_card('ee000000-0000-4000-8000-000000000002')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000002')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.comment_author_card('ee000000-0000-4000-8000-000000000003')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000003')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.comment_author_card('ee000000-0000-4000-8000-000000000004')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000004')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('cc000000-0000-4000-8000-000000000003')$q$,'User unavailable.');
 perform public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000005')$q$,'You cannot add yourself');
 first_request := public.send_comment_friend_request('ee000000-0000-4000-8000-000000000001');
 second_request := public.send_comment_friend_request('ee000000-0000-4000-8000-000000000001');
 if first_request <> second_request then raise exception 'Duplicate send was not idempotent'; end if;
 if public.send_friend_request('azice-discovery-test-token') <> first_request then raise exception 'Invitation route does not share pending request'; end if;
 select * into strict card from public.comment_author_card('ee000000-0000-4000-8000-000000000001');
 if card.relationship <> 'outgoing' or card.avatar_path is not null then raise exception 'Outgoing relationship/avatar incorrect'; end if;
 if exists(select bio from public.profiles where id='cc000000-0000-4000-8000-000000000003')
 or exists(select 1 from storage.objects where name='cc000000-0000-4000-8000-000000000003/avatar.jpg') then
  raise exception 'Pending request exposed a private profile or avatar';
 end if;
 if not exists(select 1 from public.pending_friend_request_profiles() p where p.id='cc000000-0000-4000-8000-000000000003'
  and p.username='azice_discovery_c' and p.avatar_path is null and not (to_jsonb(p) ? 'bio')) then
  raise exception 'Pending minimal identity missing or leaking bio';
 end if;
 if exists(select 1 from public.posts where author_id='cc000000-0000-4000-8000-000000000003') then raise exception 'Pending request leaked private posts'; end if;
end $$;

-- C already has an incoming A request; trying the reverse via A's comment must fail.
select set_config('request.jwt.claim.sub','cc000000-0000-4000-8000-000000000003',true);
do $$declare card record;
begin
 select * into strict card from public.comment_author_card('ee000000-0000-4000-8000-000000000005');
 if card.relationship <> 'incoming' then raise exception 'Incoming relationship missing'; end if;
 if exists(select bio from public.profiles where id='aa000000-0000-4000-8000-000000000001') then raise exception 'Incoming request exposed private bio'; end if;
 perform public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000005')$q$,'A request is already pending');
 perform public.handle_friend_request(card.request_id,'decline');
end $$;

-- A fresh invitation request retains minimal identity without pending profile access.
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
select public.send_friend_request('azice-discovery-test-token');
do $$begin
 if exists(select bio from public.profiles where id='cc000000-0000-4000-8000-000000000003') then raise exception 'Invitation request exposed private bio'; end if;
 if not exists(select 1 from public.pending_friend_request_profiles() where id='cc000000-0000-4000-8000-000000000003') then raise exception 'Invitation identity missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','cc000000-0000-4000-8000-000000000003',true);
select public.handle_friend_request((select request_id from public.comment_author_card('ee000000-0000-4000-8000-000000000005')),'accept');
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
do $$begin
 if not exists(select bio from public.profiles where id='cc000000-0000-4000-8000-000000000003' and bio='C private bio')
 or not exists(select 1 from storage.objects where name='cc000000-0000-4000-8000-000000000003/avatar.jpg') then
  raise exception 'Accepted invitation did not restore confirmed-friend profile/avatar access';
 end if;
end $$;
select public.remove_friend('cc000000-0000-4000-8000-000000000003');
do $$begin
 if exists(select bio from public.profiles where id='cc000000-0000-4000-8000-000000000003')
 or exists(select 1 from storage.objects where name='cc000000-0000-4000-8000-000000000003/avatar.jpg') then
  raise exception 'Unfriending did not revoke profile/avatar access';
 end if;
end $$;

-- Removing A-B revokes the exact shared-comment card and its send permission.
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
select public.remove_friend('bb000000-0000-4000-8000-000000000002');
select public.azice_discovery_test_expect_error($q$select public.comment_author_card('ee000000-0000-4000-8000-000000000001')$q$,'User unavailable.');
select public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000001')$q$,'User unavailable.');

-- Restore shared access, hit quota through other request history, test aggregate limit.
reset role;
insert into public.friendships(user_a,user_b) values ('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002');
insert into public.friend_requests(sender_id,receiver_id,status)
select 'aa000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000003','declined' from generate_series(1,30);
set local role authenticated;
select public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000001')$q$,'Too many friend requests. Try again later.');
select public.azice_discovery_test_expect_error($q$select public.send_friend_request('azice-discovery-test-token')$q$,'Too many friend requests. Try again later.');

-- Signed-out callers cannot receive a card even if they could execute the RPC.
select set_config('request.jwt.claim.sub','',true);
select public.azice_discovery_test_expect_error($q$select public.comment_author_card('ee000000-0000-4000-8000-000000000001')$q$,'User unavailable.');
select public.azice_discovery_test_expect_error($q$select public.send_comment_friend_request('ee000000-0000-4000-8000-000000000001')$q$,'User unavailable.');
select public.azice_discovery_test_expect_error($q$select * from public.pending_friend_request_profiles()$q$,'User unavailable.');

reset role;
delete from auth.users where id='cc000000-0000-4000-8000-000000000003';
do $$begin
 if exists(select 1 from public.profiles where id='cc000000-0000-4000-8000-000000000003')
 or exists(select 1 from public.comments where author_id='cc000000-0000-4000-8000-000000000003')
 or exists(select 1 from public.friend_requests where sender_id='cc000000-0000-4000-8000-000000000003' or receiver_id='cc000000-0000-4000-8000-000000000003')
 or exists(select 1 from public.invites where user_id='cc000000-0000-4000-8000-000000000003') then raise exception 'Account deletion cascades regressed'; end if;
end $$;

rollback;
