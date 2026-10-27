// Supabase Edge Function: delete-account
// The sole supported account deletion mechanism for AziCe?.
// Securely deletes user files from Storage using the official Storage API,
// and only after storage cleanup succeeds completely, deletes the Auth user identity.
// Authorization is strictly verified via caller's Bearer JWT. Never exposes service_role key to browser.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: 'Server configuration missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Authenticate the caller strictly using their own JWT
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Initialize privileged server-side client (service_role never exposed to browser)
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 3–4. Delete every owned image/avatar, with pagination and small API batches.
    // Enumerate before deleting: OFFSET pagination while mutating the same folder
    // would skip files. Fail closed: never delete Auth if listing/removal fails.
    const PAGE_SIZE = 100;
    const REMOVE_BATCH_SIZE = 100;

    async function listAll(bucket: 'post-images' | 'avatars', prefix: string) {
      const entries: Array<{ name: string; id: string | null }> = [];
      let offset = 0;
      while (true) {
        const { data, error } = await adminClient.storage.from(bucket)
          .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new Error(`Failed to list ${bucket}: ${error.message}`);
        if (!data) throw new Error(`Failed to list ${bucket}: missing response data`);
        entries.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += data.length;
      }
      return entries;
    }

    async function removeAll(bucket: 'post-images' | 'avatars', paths: string[]) {
      for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
        const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
        const { error } = await adminClient.storage.from(bucket).remove(batch);
        if (error) throw new Error(`Failed to remove ${bucket}: ${error.message}`);
      }
    }

    // Paths are restricted to the authenticated user's namespace. No direct SQL
    // deletion of storage.objects; using the official API deletes underlying files.
    const postPathsToDelete: string[] = [];
    for (const entry of await listAll('post-images', user.id)) {
      if (entry.id === null) {
        const folder = `${user.id}/${entry.name}`;
        for (const file of await listAll('post-images', folder)) {
          if (file.id === null) {
            // The app only creates user/postId/file.jpg; fail rather than silently
            // leave unexpected nested data while claiming complete deletion.
            throw new Error('Unexpected nested post-images directory');
          }
          postPathsToDelete.push(`${folder}/${file.name}`);
        }
      } else {
        postPathsToDelete.push(`${user.id}/${entry.name}`);
      }
    }
    await removeAll('post-images', postPathsToDelete);

    const avatarPathsToDelete: string[] = [];
    for (const entry of await listAll('avatars', user.id)) {
      if (entry.id === null) throw new Error('Unexpected nested avatars directory');
      avatarPathsToDelete.push(`${user.id}/${entry.name}`);
    }
    await removeAll('avatars', avatarPathsToDelete);

    // Verify no owned objects remain before deleting the account identity.
    // A failed cleanup may already have removed some files; retries are safe.
    const remainingPostFolders = await listAll('post-images', user.id);
    const remainingAvatars = await listAll('avatars', user.id);
    if (remainingPostFolders.length > 0 || remainingAvatars.length > 0) {
      throw new Error('Storage cleanup incomplete: account was not deleted');
    }

    // 5. Delete Auth user ONLY AFTER storage cleanup succeeded completely
    // Deleting the user in auth.users automatically triggers ON DELETE CASCADE in PostgreSQL
    // for public.profiles and all dependent tables (posts, comments, friendships, etc.)
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      throw new Error(`Failed to delete auth user identity: ${deleteUserError.message}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Account, storage files, and database records permanently deleted' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Account deletion failed' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
