-- AutoMod actions are applied in the same transaction as the blocked attempt.
begin;
alter table public.cb_automod add column actions text[] not null default '{}',
 add column timeout_seconds integer not null default 600 check(timeout_seconds between 1 and 2419200),
 add column ban_seconds integer check(ban_seconds between 1 and 31536000),
 add column log_channel_id text references public.cb_channels on delete set null,
 add constraint cb_automod_actions_valid check(actions <@ array['warning','timeout','ban']::text[]);
alter table public.cb_automod_events add column content text, add column matched text,
 add column actions text[] not null default '{}', add column expires_at timestamptz;
alter table public.cb_messages add column automod_event jsonb;

create function chat_private.automod_hit(a uuid,c text,r public.cb_automod,body text,matched text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event_id text; act text; applied text[]:='{}'; expiry timestamptz; latest_expiry timestamptz; detail jsonb;
begin
 -- A rule cannot automatically punish root or a member above its creator.
 if chat_private.rank(a)<coalesce(chat_private.rank(r.created_by),0) then
  foreach act in array r.actions loop
   if act=any(applied) then continue;end if;
   expiry:=case when act='timeout' then now()+make_interval(secs=>r.timeout_seconds)
                when act='ban' and r.ban_seconds is not null then now()+make_interval(secs=>r.ban_seconds) end;
   insert into public.cb_moderation(user_id,action,reason,note,evidence,created_by,expires_at)
   values(a,act,'AutoMod: '||r.name,r.block_message,left(body,4000),r.created_by,expiry);
   applied:=array_append(applied,act);latest_expiry:=greatest(latest_expiry,expiry);
  end loop;
 end if;
 insert into public.cb_automod_events(user_id,room,rule_id,rule_name,content,matched,actions,expires_at)
 values(a,c,r.id,r.name,left(body,4000),matched,applied,latest_expiry) returning id into event_id;
 detail:=jsonb_build_object('id',event_id,'user_id',a,'channel_id',c,'rule',r.name,'content',left(body,4000),'matched',matched,'actions',applied,'expires_at',latest_expiry);
 -- Logs go only to a configured private, non-DM channel. If it is archived or
 -- made public later, retain the staff-only event without publishing a message.
 if exists(select 1 from public.cb_channels where id=r.log_channel_id and is_private and not archived and kind in ('text','announcement')) then
  insert into public.cb_messages(room,user_id,text,automod_event)
  values(r.log_channel_id,a,'AutoMod blocked a message · '||r.name,detail);
 end if;
 return jsonb_build_object('blocked',true,'message',r.block_message,'rule',r.name,'actions',applied);
end $$;
revoke all on function chat_private.automod_hit(uuid,text,public.cb_automod,text,text) from public,anon,authenticated;

-- Preserve the existing dispatch implementation and all its authorization,
-- rate, attachment, and slowmode checks. Replace the single matching branch.
do $$
declare source text; old_branch text:=$old$insert into public.cb_automod_events(user_id,room,rule_id,rule_name) values(a,c,r.id,r.name);
    return jsonb_build_object('blocked',true,'message',r.block_message,'rule',r.name);$old$;
begin
 source:=replace(pg_get_functiondef('chat_private.dispatch(uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(source,old_branch)=0 then raise exception 'AutoMod dispatch version mismatch';end if;
 source:=replace(source,old_branch,'return chat_private.automod_hit(a,c,r,body,item);');
 execute source;
end $$;

alter function chat_private.dispatch(uuid,text,jsonb) rename to dispatch_core;
create function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; rule_id text; rule_actions text[]; timeout_secs integer; ban_secs integer; log_id text;
begin
 if op='automod' then
  if a is null or chat_private.rank(a)<40 or exists(select 1 from public.cb_profiles where id=a and is_bot) then raise exception 'Administrator permission required';end if;
  rule_id:=coalesce(p->>'id',gen_random_uuid()::text);
  rule_actions:=array(select distinct jsonb_array_elements_text(coalesce(p->'actions','[]')));
  if not rule_actions <@ array['warning','timeout','ban']::text[] then raise exception 'Invalid AutoMod action';end if;
  timeout_secs:=coalesce((p->>'timeout_seconds')::integer,600);
  ban_secs:=nullif(p->>'ban_seconds','')::integer;
  if timeout_secs not between 1 and 2419200 or (ban_secs is not null and ban_secs not between 1 and 31536000) then raise exception 'Invalid action duration';end if;
  log_id:=nullif(p->>'log_channel_id','');
  if log_id is not null and not exists(select 1 from public.cb_channels where id=log_id and is_private and not archived and kind in ('text','announcement') and public.cb_can(a,id,'view') and public.cb_can(a,id,'manage')) then raise exception 'Choose a private log channel you can manage';end if;
  result:=chat_private.dispatch_core(a,op,p||jsonb_build_object('id',rule_id));
  update public.cb_automod set actions=rule_actions,timeout_seconds=timeout_secs,ban_seconds=ban_secs,log_channel_id=log_id,created_by=a where id=rule_id;
  return result;
 end if;
 -- System alerts cannot be forged or rewritten by the member whose content was blocked.
 if op in ('edit','delete_message') and exists(select 1 from public.cb_messages where id=p->>'id' and automod_event is not null) then
  if op='edit' or chat_private.rank(a)<20 then raise exception 'AutoMod alerts cannot be edited';end if;
 end if;
 return chat_private.dispatch_core(a,op,p);
end $$;
revoke all on function chat_private.dispatch(uuid,text,jsonb),chat_private.dispatch_core(uuid,text,jsonb) from public,anon,authenticated;
-- Refresh the public entry point after replacing the private function.
create or replace function public.chat_action(action text,payload jsonb default '{}') returns jsonb language sql security definer set search_path='' set statement_timeout='8s' as $$ select chat_private.dispatch(auth.uid(),action,payload) $$;
commit;

