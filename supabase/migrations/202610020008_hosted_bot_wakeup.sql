begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create function chat_private.wake_bots() returns void language plpgsql security definer set search_path='' as $$
declare s text;begin
 if not exists(select 1 from chat_private.bot_jobs where status='pending') then return;end if;
 update chat_private.bot_runner_config set last_wake_at=clock_timestamp() where singleton and last_wake_at<clock_timestamp()-interval '1 second' returning secret into s;
 if s is null then return;end if;
 perform net.http_post(url:='https://lflkpziiwnoamvtrbcil.supabase.co/functions/v1/chat-api/hosted/run',headers:=jsonb_build_object('Content-Type','application/json','X-Chatbox-Runner',s),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
create function chat_private.wake_bot_trigger() returns trigger language plpgsql security definer set search_path='' as $$begin perform chat_private.wake_bots();return null;end $$;
create trigger cb_hosted_wakeup after insert on chat_private.bot_jobs for each statement execute function chat_private.wake_bot_trigger();
create function chat_private.hosted_maintenance() returns void language plpgsql security definer set search_path='' as $$begin
 update chat_private.bot_jobs set status='failed',error='Execution interrupted; not replayed to avoid duplicate actions',finished_at=now() where status='running' and started_at<now()-interval '2 minutes';
 perform chat_private.wake_bots();
 delete from chat_private.bot_jobs where finished_at<now()-interval '7 days';
end $$;
revoke all on function chat_private.wake_bots(),chat_private.wake_bot_trigger(),chat_private.hosted_maintenance() from public,anon,authenticated;
select cron.schedule('chatbox-hosted-bots','* * * * *','select chat_private.hosted_maintenance()');
commit;
