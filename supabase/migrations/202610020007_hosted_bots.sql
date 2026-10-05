begin;
-- Reuse the same checked bot dispatcher for self-hosted and managed execution.
do $$ declare src text;begin
 src:=pg_get_functiondef('public.chat_bot(text,text,jsonb)'::regprocedure);
 src:=replace(src,'CREATE OR REPLACE FUNCTION public.chat_bot(action text, token text, payload jsonb DEFAULT ''{}''::jsonb)','CREATE OR REPLACE FUNCTION chat_private.bot_dispatch(actor uuid, action text, payload jsonb DEFAULT ''{}''::jsonb)');
 src:=replace(src,'select * into b from public.cb_bots where enabled and token_hash=encode(sha256(convert_to(token,''UTF8'')),''hex'');a:=b.id;','select * into b from public.cb_bots where enabled and id=actor;a:=b.id;');
 if strpos(src,'token_hash=')>0 or strpos(src,'chat_private.bot_dispatch')=0 then raise exception 'Bot dispatcher version mismatch';end if;
 execute src;
end $$;
revoke all on function chat_private.bot_dispatch(uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.chat_bot(action text,token text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare actor uuid;begin
 select id into actor from public.cb_bots where enabled and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 if actor is null then raise exception 'Invalid bot token';end if;
 return chat_private.bot_dispatch(actor,action,payload);
end $$;

create table chat_private.bot_programs(bot_id uuid primary key references public.cb_bots(id),source text not null default '',draft_source text,enabled boolean not null default false,revision bigint not null default 1,updated_at timestamptz not null default now(),last_run_at timestamptz,last_error text);
create table chat_private.bot_jobs(id bigint generated always as identity primary key,bot_id uuid not null references public.cb_bots(id),message_id text not null references public.cb_messages(id),revision bigint not null,status text not null default 'pending',lease uuid,started_at timestamptz,finished_at timestamptz,api_calls integer not null default 0,logs jsonb not null default '[]',error text,unique(bot_id,message_id));
create index bot_jobs_pending on chat_private.bot_jobs(status,id);
create table chat_private.bot_runner_config(singleton boolean primary key default true check(singleton),secret text not null default gen_random_uuid()::text||gen_random_uuid()::text,last_wake_at timestamptz not null default 'epoch');
insert into chat_private.bot_runner_config(singleton) values(true);
revoke all on all tables in schema chat_private from public,anon,authenticated;

create function public.chat_hosted(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare a uuid:=auth.uid();b public.cb_bots;program chat_private.bot_programs;src text;begin
 select * into b from public.cb_bots where id=(payload->>'bot_id')::uuid;
 if a is null or b.id is null or (b.owner_id<>a and not chat_private.is_root(a)) or chat_private.restricted(a,array['ban','warning','timeout']) then raise exception 'Bot owner permission required';end if;
 if action='save' then
  if not b.enabled then raise exception 'This bot token has been revoked';end if;
  src:=coalesce(payload->>'source','');if length(src)>80000 then raise exception 'Script must be 80,000 characters or fewer';end if;
  if coalesce((payload->>'enabled')::boolean,false) and trim(src)='' then raise exception 'Add a script first';end if;
  insert into chat_private.bot_programs(bot_id,source,enabled) values(b.id,src,coalesce((payload->>'enabled')::boolean,false)) on conflict(bot_id) do update set source=excluded.source,draft_source=null,enabled=excluded.enabled,revision=chat_private.bot_programs.revision+1,updated_at=now(),last_error=null;
  update chat_private.bot_jobs set status='cancelled',finished_at=now() where bot_id=b.id and status='pending';
 elsif action='draft' then
  src:=coalesce(payload->>'source','');if length(src)>80000 then raise exception 'Script must be 80,000 characters or fewer';end if;
  insert into chat_private.bot_programs(bot_id,draft_source) values(b.id,src) on conflict(bot_id) do update set draft_source=excluded.draft_source,updated_at=now();
 elsif action='stop' then
  update chat_private.bot_programs set enabled=false,updated_at=now() where bot_id=b.id;
  update chat_private.bot_jobs set status='cancelled',finished_at=now() where bot_id=b.id and status='pending';
 elsif action not in ('get','logs') then raise exception 'Unknown hosted bot action';end if;
 if action='logs' then return coalesce((select jsonb_agg(x) from(select id,status,started_at,finished_at,logs,error from chat_private.bot_jobs where bot_id=b.id order by id desc limit 20)x),'[]');end if;
 select * into program from chat_private.bot_programs where bot_id=b.id;
 return coalesce(to_jsonb(program),jsonb_build_object('bot_id',b.id,'source','','enabled',false,'revision',0));
end $$;
revoke all on function public.chat_hosted(text,jsonb) from public,anon;
grant execute on function public.chat_hosted(text,jsonb) to authenticated;

create function chat_private.enqueue_bots() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.deleted or new.automod_event is not null or new.poll_id is not null or new.thread_id is not null or exists(select 1 from public.cb_profiles where id=new.user_id and is_bot) then return new;end if;
 insert into chat_private.bot_jobs(bot_id,message_id,revision)
 select p.bot_id,new.id,p.revision from chat_private.bot_programs p join public.cb_bots b on b.id=p.bot_id
 where p.enabled and b.enabled and public.cb_can(b.id,new.room,'view') and not chat_private.restricted(b.owner_id,array['ban','warning','timeout']) on conflict do nothing;
 return new;
end $$;
create trigger cb_hosted_message after insert on public.cb_messages for each row execute function chat_private.enqueue_bots();
revoke all on function chat_private.enqueue_bots() from public,anon,authenticated;

create function public.chat_hosted_claim(runner_secret text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare j chat_private.bot_jobs; result jsonb:='[]';begin
 if not exists(select 1 from chat_private.bot_runner_config where secret=runner_secret) then raise exception 'Invalid runner authorization';end if;
 -- A crashed job is not replayed after side effects; retries could duplicate moderation or replies.
 update chat_private.bot_jobs set status='failed',error='Execution interrupted; not replayed to avoid duplicate actions',finished_at=now() where status='running' and started_at<now()-interval '2 minutes';
 for j in select * from chat_private.bot_jobs where status='pending' order by id for update skip locked limit 3 loop
  if not exists(select 1 from chat_private.bot_programs p join public.cb_bots b on p.bot_id=b.id join public.cb_messages m on m.id=j.message_id where p.bot_id=j.bot_id and p.enabled and b.enabled and p.revision=j.revision and not m.deleted and public.cb_can(b.id,m.room,'view') and not chat_private.restricted(b.owner_id,array['ban','warning','timeout'])) then
   update chat_private.bot_jobs set status='cancelled',finished_at=now() where id=j.id;continue;
  end if;
  update chat_private.bot_jobs set status='running',lease=gen_random_uuid(),started_at=now() where id=j.id returning * into j;
  result:=result||jsonb_build_array(jsonb_build_object('id',j.id,'lease',j.lease,'source',(select source from chat_private.bot_programs where bot_id=j.bot_id),'event',jsonb_build_object('bot',(select to_jsonb(p) from public.cb_profiles p where p.id=j.bot_id),'message',(select to_jsonb(m)||jsonb_build_object('author',(select to_jsonb(p) from public.cb_profiles p where p.id=m.user_id)) from public.cb_messages m where m.id=j.message_id))));
 end loop;
 return result;
end $$;
create function public.chat_hosted_action(job_id bigint,job_lease uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare j chat_private.bot_jobs;begin
 select * into j from chat_private.bot_jobs where id=job_id and lease=job_lease and status='running' and started_at>now()-interval '30 seconds' for update;
 if j.id is null or j.api_calls>=8 then raise exception 'Hosted execution expired or API budget exceeded';end if;
 if not exists(select 1 from chat_private.bot_programs p join public.cb_bots b on b.id=p.bot_id where p.bot_id=j.bot_id and p.enabled and b.enabled and p.revision=j.revision and not chat_private.restricted(b.owner_id,array['ban','warning','timeout'])) then raise exception 'Hosted bot stopped';end if;
 update chat_private.bot_jobs set api_calls=api_calls+1 where id=j.id;
 return chat_private.bot_dispatch(j.bot_id,action,payload);
end $$;
create function public.chat_hosted_finish(job_id bigint,job_lease uuid,outcome jsonb) returns void language plpgsql security definer set search_path='' as $$
declare b uuid;begin
 update chat_private.bot_jobs set status=case when outcome ? 'error' then 'failed' else 'done' end,finished_at=now(),logs=coalesce(outcome->'logs','[]'),error=left(outcome->>'error',1000) where id=job_id and lease=job_lease and status='running' returning bot_id into b;
 update chat_private.bot_programs set last_run_at=now(),last_error=left(outcome->>'error',1000) where bot_id=b;
end $$;
revoke all on function public.chat_hosted_claim(text),public.chat_hosted_action(bigint,uuid,text,jsonb),public.chat_hosted_finish(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.chat_hosted_claim(text),public.chat_hosted_action(bigint,uuid,text,jsonb),public.chat_hosted_finish(bigint,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
