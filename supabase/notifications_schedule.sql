-- OPTIONAL OPERATOR STEP, AFTER reviewing the migration, deploying both Edge Functions,
-- configuring VAPID/secrets and enabling pg_cron, pg_net and Vault. DO NOT auto-run.
-- Create these two Vault secrets in the dashboard first:
--   azice_push_dispatch_url = https://PROJECT.supabase.co/functions/v1/push-dispatch
--   azice_push_dispatch_secret = the same random PUSH_DISPATCH_SECRET as the Edge Function
begin;
do $$begin
 if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net')
  or to_regclass('vault.decrypted_secrets') is null then raise exception 'Enable pg_cron, pg_net and Vault first'; end if;
 if exists(select 1 from cron.job where jobname='azice-push-dispatch') then raise exception 'Schedule exists; review instead of duplicating it'; end if;
end $$;
create function azice_push.tick() returns void
language plpgsql security definer set search_path='' as $$
declare url text; secret text;
begin
 -- One set-based opt-in query every five minutes, never per-user Edge invocations.
 if extract(minute from now())::integer%5=0 then perform azice_push.reminders(); end if;
 -- Bounded retention even when no device has pending work.
 if extract(minute from now())::integer=0 then
  delete from azice_push.batches where created_at<now()-interval '30 days';
  delete from azice_push.jobs where created_at<now()-interval '2 days' and batch_id is null;
  delete from azice_push.subscriptions where expires_at<now();
 end if;
 if not exists(select 1 from azice_push.jobs where batch_id is null and due_at<=now())
  and not exists(select 1 from azice_push.batches where not done and due_at<=now() and (leased_until is null or leased_until<now())) then return; end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='azice_push_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='azice_push_dispatch_secret';
 if url is null or secret is null then raise exception 'Push dispatcher Vault settings missing'; end if;
 perform net.http_post(url:=url,headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=135000);
end $$;
revoke all on function azice_push.tick() from public,anon,authenticated,service_role;
select cron.schedule('azice-push-dispatch','* * * * *','select azice_push.tick();');
commit;
