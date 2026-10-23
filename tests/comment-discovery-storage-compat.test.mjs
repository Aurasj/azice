import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Supplemental source contract checks. These do NOT replace PostgreSQL integration
// tests or the existing comment-discovery suite.
const migration = readFileSync(
  resolve('supabase/migrations/20261023012201_comment_author_discovery.sql'), 'utf8'
);
const lower = migration.toLowerCase();
const profileFn = migration.match(
  /create or replace function public\.can_view_profile\(p_profile uuid\)[\s\S]*?(?=\n\s*-- An extra restrictive RLS guard)/i
)?.[0] || '';
const initialGuard = migration.split(/\ncreate schema azice_private;/i)[0];

test('migration is transactional and creates the non-exposed private schema', () => {
  assert.match(migration, /(?:^|\n)begin;/i);
  assert.match(migration, /create schema azice_private;/i);
  assert.match(migration, /commit;\s*$/i);
});

test('preflight verifies the three existing functions/table owners', () => {
  for (const name of [
    'public.send_friend_request(text)',
    'public.can_view_profile(uuid)',
    'public.profiles',
  ]) assert.ok(initialGuard.includes(name), `Missing prerequisite: ${name}`);
});

test('preflight verifies existing avatar and post-image Storage policies', () => {
  assert.match(initialGuard, /policyname='avatar_select'/);
  assert.match(initialGuard, /qual like '%can_view_profile%'/);
  assert.match(initialGuard, /policyname='post_image_select'/);
  assert.match(initialGuard, /competing|not in \('avatar_select','post_image_select'\)/i);
});

test('no Storage DDL or privileged Storage role grants introduced', () => {
  assert.doesNotMatch(lower, /create\s+policy\s+\w+\s+on\s+storage\.objects/);
  assert.doesNotMatch(lower, /alter\s+table\s+storage\.objects/);
  assert.doesNotMatch(lower, /grant\s+\w+[\s\S]*?\s+to\s+(?:postgres|supabase_storage_admin)\s*;/);
  assert.doesNotMatch(lower, /alter\s+(?:role|function|table)\s+\S+[\s\S]*?\s+owner\s+to/);
});

test('shared can_view_profile helper is narrowed to own profile or friendship', () => {
  assert.match(profileFn, /security definer/i);
  assert.match(profileFn, /auth\.uid\(\)/);
  assert.match(profileFn, /public\.are_friends\(p_profile,auth\.uid\(\)\)/);
  assert.doesNotMatch(profileFn, /friend_requests|pending/i);
});

test('defense-in-depth profile SELECT guard remains restrictive', () => {
  assert.match(migration, /create policy profiles_confirmed_read_guard on public\.profiles as restrictive\s+for select to authenticated using\s*\(id=auth\.uid\(\) or public\.are_friends\(id,auth\.uid\(\)\)\);/i);
});

test('pending list gets a minimal identity RPC without private fields', () => {
  const match = migration.match(/create function public\.pending_friend_request_profiles\(\)[\s\S]*?(?=\n-- Remove ALL non-owner default grants)/i)?.[0] || '';
  assert.match(match, /returns table\(id uuid,display_name text,username text,avatar_path text\)/i);
  assert.doesNotMatch(match, /\bbio\b|\bpost_photos\b|\binvites\b/i);
  assert.match(match, /r\.status='pending'/);
});

test('comment-based request is authorized from a readable comment, not UUID', () => {
  assert.match(migration, /create function public\.send_comment_friend_request\(p_comment_id uuid\)/i);
  assert.match(migration, /c\.id=p_comment_id and p\.status='published' and public\.can_view_post\(c\.post_id\)/);
  assert.match(migration, /return azice_private\.create_friend_request\(target,p_comment_id\)/);
});

test('helper takes row locks and retains shared quota', () => {
  assert.match(migration, /visible_comment from public\.comments c where c\.id=p_comment_id for share;/i);
  assert.match(migration, /visible_post from public\.posts p where p\.id=visible_comment\.post_id for share;/i);
  assert.match(migration, /public\.friendships f[\s\S]*?for share;/i);
  assert.match(migration, />=\s*30\s+then/);
});

test('private helper is not exposed to browser roles, public RPCs are', () => {
  assert.match(migration, /revoke all on schema azice_private from public, anon, authenticated;/i);
  assert.match(migration, /revoke all on function azice_private\.create_friend_request\(uuid,uuid\) from public, anon, authenticated;/i);
  for (const fn of [
    'comment_author_card\\(uuid\\)',
    'send_comment_friend_request\\(uuid\\)',
    'pending_friend_request_profiles\\(\\)',
  ]) {
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn} to authenticated;`, 'i'));
  }
});

test('invitation link RPC remains available and delegates through shared helper', () => {
  assert.match(migration, /create or replace function public\.send_friend_request\(p_token text\) returns uuid/i);
  assert.match(migration, /return azice_private\.create_friend_request\(recipient\)/);
  assert.match(migration, /grant execute on function public\.send_friend_request\(text\) to authenticated;/i);
});

test('migration uses only forward changes and reloads schema cache', () => {
  assert.match(migration, /notify pgrst, 'reload schema';/);
  assert.doesNotMatch(migration, /drop\s+table|drop\s+schema|drop\s+policy/i);
});
