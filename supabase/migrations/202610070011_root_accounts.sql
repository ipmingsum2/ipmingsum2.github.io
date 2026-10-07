begin;
create table chat_private.account_wipes (
 target uuid primary key, username text not null, actor uuid not null,
 identities uuid[] not null, assets jsonb not null, purged boolean not null default false,
 created_at timestamptz not null default now()
);
alter table chat_private.account_wipes enable row level security;
revoke all on chat_private.account_wipes from public,anon,authenticated;

-- A deletion in progress must not recreate a profile or submit new content.
alter function chat_private.dispatch(uuid,text,jsonb) rename to dispatch_before_root_accounts;
create function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from chat_private.account_wipes where a=any(identities)) then raise exception 'Account deletion is in progress';end if;
 return chat_private.dispatch_before_root_accounts(a,op,p);
end $$;
revoke all on function chat_private.dispatch(uuid,text,jsonb),chat_private.dispatch_before_root_accounts(uuid,text,jsonb) from public,anon,authenticated;

create function public.chat_root_account(actor uuid,target uuid,operation text,confirmation text default '') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare p public.cb_profiles; j chat_private.account_wipes; ids uuid[]; mids text[]; iids uuid[]; t text; k text; wipe_assets jsonb;begin
 if not chat_private.is_root(actor) or chat_private.restricted(actor,array['ban','warning','timeout']) then raise exception 'Root permission required';end if;
 if target=actor or chat_private.is_root(target) then raise exception 'Root accounts cannot be reset or deleted here';end if;
 select * into p from public.cb_profiles where id=target and not is_bot;
 select * into j from chat_private.account_wipes w where w.target=chat_root_account.target for update;
 if p.id is null and j.target is null then raise exception 'Member not found';end if;
 if operation='check' then
  if j.target is not null then raise exception 'Account deletion is in progress';end if;
  return jsonb_build_object('id',p.id,'username',p.username);
 end if;
 if confirmation is distinct from 'DELETE '||coalesce(j.username,p.username) then raise exception 'Type the exact deletion confirmation';end if;
 if operation='prepare' then
  if j.target is not null then
   select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name)),'[]') into wipe_assets
    from storage.objects o where split_part(o.name,'/',1)=any(j.identities::text[])
     or coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=any(j.identities::text[]);
   update chat_private.account_wipes w set assets=wipe_assets||j.assets where w.target=chat_root_account.target returning * into j;
   return to_jsonb(j);
  end if;
  select array_prepend(target,coalesce(array_agg(id),'{}'::uuid[])) into ids from public.cb_bots where owner_id=target;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name)),'[]') into wipe_assets
   from storage.objects o where split_part(o.name,'/',1)=any(ids::text[])
     or coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=any(ids::text[]);
  insert into chat_private.account_wipes values(target,p.username,actor,ids,wipe_assets,false,now()) returning * into j;
  insert into public.cb_moderation(user_id,action,reason,created_by)
   select unnest(ids),'ban','Account deletion is in progress',actor;
  update public.cb_bots set enabled=false where id=any(ids);
  update chat_private.bot_programs set enabled=false where bot_id=any(ids);
  return to_jsonb(j);
 elsif operation='purge' then
  if j.target is null then raise exception 'Prepare deletion first';end if;
  if j.purged then return to_jsonb(j);end if;
  ids:=j.identities;
  if exists(select 1 from storage.objects o where split_part(o.name,'/',1)=any(ids::text[])
    or coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=any(ids::text[])) then raise exception 'Uploads remain. Retry deletion to remove them first';end if;
  select coalesce(array_agg(id),'{}') into mids from public.cb_messages where user_id=any(ids) or automod_event->>'user_id'=any(ids::text[]);
  with recursive tree as (
   select id from chat_private.bot_interactions where user_id=any(ids) or bot_id=any(ids) or message_id=any(mids)
   union select x.id from chat_private.bot_interactions x join tree parent_row on x.parent_id=parent_row.id
  ) select coalesce(array_agg(id),'{}') into iids from tree;
  delete from chat_private.bot_jobs where bot_id=any(ids) or message_id=any(mids) or interaction_id=any(iids);
  update chat_private.bot_interactions set parent_id=null where id=any(iids);
  delete from chat_private.bot_interactions where id=any(iids);
  delete from chat_private.bot_commands where bot_id=any(ids);
  delete from chat_private.bot_programs where bot_id=any(ids);
  delete from public.cb_poll_votes where user_id=any(ids);
  update public.cb_messages set poll_id=null where poll_id in(select id from public.cb_polls where created_by=any(ids) or message_id=any(mids));
  delete from public.cb_polls where created_by=any(ids) or message_id=any(mids);
  update public.cb_channels set starter_message_id=null where starter_message_id=any(mids);
  delete from public.cb_messages where id=any(mids);
  delete from public.cb_automod_events where user_id=any(ids);
  delete from public.cb_moderation where user_id=any(ids);
  update public.cb_moderation set created_by=null where created_by=any(ids);
  delete from public.cb_reads where user_id=any(ids);
  delete from public.cb_overwrites where subject=any(select 'user:'||unnest(ids)::text);
  delete from public.cb_bots where id=any(ids);
  delete from public.cb_announcements where created_by=any(ids);
  update public.cb_channels set created_by=null where created_by=any(ids);
  update public.cb_automod set created_by=null where created_by=any(ids);
  delete from chat_private.rate_limits where rate_limits.actor=any(ids);
  delete from chat_private.slowmode where slowmode.actor=any(ids);
  delete from chat_private.human_sessions where human_sessions.actor=any(ids);
  delete from public.cb_profiles where id=any(ids);
  -- Remove archived originals as well, without touching other members' rows.
  foreach t in array array['messages','channel_members','channel_lock_bypass','user_bans','user_mutes','ip_bans','ip_mutes','audit_logs','announcements','profiles'] loop
   if to_regclass('public.'||t) is not null then
    k:=case when t='profiles' then 'id' when t='announcements' then 'created_by' when t='audit_logs' then 'actor_user_id' else 'user_id' end;
    execute format('delete from public.%I r where to_jsonb(r)->>%L=any($1)',t,k) using ids::text[];
   end if;
  end loop;
  update chat_private.account_wipes w set purged=true where w.target=chat_root_account.target returning * into j;
  return to_jsonb(j);
 elsif operation='finish' then
  if j.target is null or not j.purged then raise exception 'Purge chat data first';end if;
  if exists(select 1 from auth.users where id=target) then raise exception 'Delete the login account first';end if;
  delete from chat_private.account_wipes w where w.target=chat_root_account.target;
  return jsonb_build_object('deleted',true);
 end if;
 raise exception 'Unknown account operation';
end $$;
revoke all on function public.chat_root_account(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.chat_root_account(uuid,uuid,text,text) to service_role;
commit;
