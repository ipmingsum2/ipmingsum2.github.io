begin;
create table chat_private.human_sessions (
 actor uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,
 expires_at timestamptz not null,
 primary key(actor,session_id)
);
alter table chat_private.human_sessions enable row level security;
revoke all on chat_private.human_sessions from public,anon,authenticated;

create function chat_private.require_human(a uuid,at_time timestamptz default clock_timestamp()) returns void
language plpgsql security definer set search_path='' as $$
declare sid uuid;begin
 if at_time < '2026-10-20 00:00:00+08'::timestamptz then return;end if;
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 if not exists(select 1 from chat_private.human_sessions where actor=a and session_id=sid and expires_at>at_time) then
  raise exception 'CHATBOX_VERIFICATION_REQUIRED';
 end if;
end $$;
revoke all on function chat_private.require_human(uuid,timestamptz) from public,anon,authenticated;

create function public.chat_verify_session(actor uuid,auth_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare expiry timestamptz:=clock_timestamp()+interval '15 minutes';begin
 if actor is null or auth_session is null then raise exception 'Session required';end if;
 delete from chat_private.human_sessions where expires_at<clock_timestamp();
 insert into chat_private.human_sessions values(actor,auth_session,expiry)
 on conflict on constraint human_sessions_pkey do update set expires_at=excluded.expires_at;
 return jsonb_build_object('expires_at',expiry);
end $$;
revoke all on function public.chat_verify_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_verify_session(uuid,uuid) to service_role;

create function chat_private.captcha_action(action text) returns boolean language sql immutable as $$
 select action=any(array['moderate','role','nickname','automod','delete_rule','permission','bot_scopes','delete_message']);
$$;
revoke all on function chat_private.captcha_action(text) from public,anon,authenticated;

create function public.chat_verified_action(actor uuid,action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' as $$begin
 if not chat_private.captcha_action(action) then raise exception 'Unsupported verified action';end if;
 return chat_private.dispatch(actor,action,payload);
end $$;
revoke all on function public.chat_verified_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.chat_verified_action(uuid,text,jsonb) to service_role;

create or replace function public.chat_action(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare result jsonb;begin
 if chat_private.captcha_action(action) then raise exception 'CHATBOX_CAPTCHA_ACTION_REQUIRED';end if;
 if action not in ('bootstrap','channel_status','api_rate','invite_rate','read','acknowledge') then
  perform chat_private.require_human(auth.uid());
 end if;
 result:=chat_private.dispatch(auth.uid(),action,payload);
 if action='channel_status' then result:=result||jsonb_build_object('can_send',public.cb_can(auth.uid(),payload->>'channel_id','send'));end if;
 return result;
end $$;

-- Preserve existing authorization inside each function, then add the scheduled gate.
alter function public.chat_interact(text,jsonb) set schema chat_private;
revoke all on function chat_private.chat_interact(text,jsonb) from public,anon,authenticated;
create function public.chat_interact(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' as $$begin
 if action not in ('commands','status') then perform chat_private.require_human(auth.uid());end if;
 return chat_private.chat_interact(action,payload);
end $$;

alter function public.chat_hosted(text,jsonb) set schema chat_private;
revoke all on function chat_private.chat_hosted(text,jsonb) from public,anon,authenticated;
create function public.chat_hosted(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' as $$begin
 perform chat_private.require_human(auth.uid());
 return chat_private.chat_hosted(action,payload);
end $$;

create or replace function public.chat_social(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' as $$begin
 if action not in ('threads','poll_data') then perform chat_private.require_human(auth.uid());end if;
 return chat_private.social(auth.uid(),action,payload);
end $$;
revoke all on function public.chat_interact(text,jsonb),public.chat_hosted(text,jsonb) from public,anon;
grant execute on function public.chat_interact(text,jsonb),public.chat_hosted(text,jsonb) to authenticated;
create function public.chat_human_ready() returns boolean language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or chat_private.restricted(auth.uid(),array['ban','warning','timeout']) then return false;end if;
 perform chat_private.require_human(auth.uid());
 return true;
 exception when others then return false;
end $$;
revoke all on function public.chat_human_ready() from public,anon;
grant execute on function public.chat_human_ready() to authenticated;
create policy chatbox_human_upload on storage.objects as restrictive for insert to authenticated
 with check(bucket_id not in ('chat-media','chatbox-private') or public.chat_human_ready());
create policy chatbox_human_update on storage.objects as restrictive for update to authenticated
 using(bucket_id not in ('chat-media','chatbox-private') or public.chat_human_ready())
 with check(bucket_id not in ('chat-media','chatbox-private') or public.chat_human_ready());
commit;

