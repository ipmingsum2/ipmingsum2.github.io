begin;
alter table public.cb_messages add column embeds jsonb not null default '[]';
alter table public.cb_bots add column scopes text[] not null default '{}'
 check(scopes <@ array['moderate','manage_messages','automod']::text[]);
grant select(scopes) on public.cb_bots to authenticated;

create function chat_private.validate_embeds(items jsonb) returns text language plpgsql set search_path='' as $$
declare e jsonb; f jsonb; link text; body text:='';
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>10 then raise exception 'Use at most 10 embeds';end if;
 for e in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(e)<>'object' then raise exception 'Invalid embed';end if;
  if length(coalesce(e->>'title',''))>256 or length(coalesce(e->>'description',''))>4096 or length(coalesce(e#>>'{footer,text}',''))>2048 or length(coalesce(e#>>'{author,name}',''))>256 then raise exception 'Embed text is too long';end if;
  if e ? 'color' and ((e->>'color')::bigint not between 0 and 16777215) then raise exception 'Invalid embed color';end if;
  if e ? 'timestamp' then perform (e->>'timestamp')::timestamptz;end if;
  foreach link in array array[e->>'url',e#>>'{image,url}',e#>>'{thumbnail,url}',e#>>'{author,url}',e#>>'{author,icon_url}',e#>>'{footer,icon_url}'] loop
   if link is not null and (length(link)>2048 or link!~'^https://[^[:space:]]+$') then raise exception 'Embed links must use HTTPS';end if;
   body:=body||E'\n'||coalesce(link,'');
  end loop;
  body:=body||E'\n'||coalesce(e->>'title','')||E'\n'||coalesce(e->>'description','')||E'\n'||coalesce(e#>>'{footer,text}','')||E'\n'||coalesce(e#>>'{author,name}','');
  if e ? 'fields' then
   if jsonb_typeof(e->'fields')<>'array' or jsonb_array_length(e->'fields')>25 then raise exception 'Use at most 25 fields per embed';end if;
   for f in select value from jsonb_array_elements(e->'fields') loop
    if jsonb_typeof(f)<>'object' or length(coalesce(f->>'name','')) not between 1 and 256 or length(coalesce(f->>'value','')) not between 1 and 1024 then raise exception 'Invalid embed field';end if;
    body:=body||E'\n'||(f->>'name')||E'\n'||(f->>'value');
   end loop;
  end if;
 end loop;
 if length(body)>6000 then raise exception 'Embeds exceed 6000 characters';end if;
 return body;
end $$;
revoke all on function chat_private.validate_embeds(jsonb) from public,anon,authenticated;

alter function chat_private.dispatch(uuid,text,jsonb) rename to dispatch_moderation;
create function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; c text; result jsonb; items jsonb; original text; scope_list text[];
begin
 if a is null then raise exception 'Sign in to continue';end if;
 if op='bot_scopes' then
  if not chat_private.is_root(a) or chat_private.restricted(a,array['ban','warning']) then raise exception 'Only root can grant bot permissions';end if;
  scope_list:=array(select distinct jsonb_array_elements_text(coalesce(p->'scopes','[]')));
  if not scope_list <@ array['moderate','manage_messages','automod']::text[] then raise exception 'Invalid bot permission';end if;
  update public.cb_bots set scopes=scope_list where id=(p->>'id')::uuid;
  if not found then raise exception 'Bot unavailable';end if;return '{}'::jsonb;
 elsif op='dm' then
  if chat_private.restricted(a,array['ban','warning','timeout']) then raise exception 'Your account has an active moderation notice';end if;
  perform chat_private.rate(a,'dm',10,60);
  target:=(p->>'user_id')::uuid;
  if target=a or not exists(select 1 from public.cb_profiles where id=target) then raise exception 'Choose another member';end if;
  c:='dm-'||least(a::text,target::text)||'-'||greatest(a::text,target::text);
  insert into public.cb_channels(id,name,kind,is_private,created_by) values(c,'Direct message','dm',true,a) on conflict do nothing;
  insert into public.cb_channel_members values(c,a),(c,target) on conflict do nothing;
  return jsonb_build_object('id',c);
 elsif op in ('send','edit') then
  items:=coalesce(p->'embeds',case when op='edit' then (select embeds from public.cb_messages where id=p->>'id' and user_id=a) end,'[]'::jsonb);
  original:=coalesce(p->>'text',case when op='edit' then (select text from public.cb_messages where id=p->>'id' and user_id=a) end,'');
  -- All embed text passes through the same AutoMod and mention checks as content.
  result:=chat_private.dispatch_moderation(a,op,p||jsonb_build_object('text',original||chat_private.validate_embeds(items)));
  if result ? 'id' then
   update public.cb_messages set text=trim(original),embeds=items where id=result->>'id';
   return (select to_jsonb(m) from public.cb_messages m where id=result->>'id');
  end if;return result;
 elsif op='delete_message' then
  result:=chat_private.dispatch_moderation(a,op,p);
  update public.cb_messages set embeds='[]' where id=p->>'id' and deleted;
  return result;
 end if;
 return chat_private.dispatch_moderation(a,op,p);
end $$;
revoke all on function chat_private.dispatch(uuid,text,jsonb),chat_private.dispatch_moderation(uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.chat_action(action text,payload jsonb default '{}') returns jsonb language sql security definer set search_path='' set statement_timeout='8s' as $$select chat_private.dispatch(auth.uid(),action,payload)$$;

create or replace function public.chat_bot(action text,token text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare a uuid; b public.cb_bots; result jsonb; target uuid; act text; expires timestamptz; m public.cb_messages;
begin
 select * into b from public.cb_bots where enabled and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');a:=b.id;
 if a is null then raise exception 'Invalid bot token';end if;
 perform chat_private.rate(a,'api',60,60);
 if chat_private.restricted(a,array['ban','warning']) then raise exception 'Bot is restricted';end if;
 if action='me' then return (select to_jsonb(p)||jsonb_build_object('scopes',b.scopes,'server_time',clock_timestamp()) from public.cb_profiles p where id=a);
 elsif action='channels' then return coalesce((select jsonb_agg(c) from public.cb_channels c where public.cb_can(a,c.id,'view')),'[]');
 elsif action='user' then return (select to_jsonb(p) from public.cb_profiles p where id=(payload->>'user_id')::uuid);
 elsif action in ('messages','events') then
  if action='messages' and not public.cb_can(a,payload->>'channel_id','view') then raise exception 'Channel unavailable';end if;
  select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('author',(select to_jsonb(p) from public.cb_profiles p where p.id=x.user_id))),'[]') into result from
   (select * from public.cb_messages where (action='events' or room=payload->>'channel_id') and public.cb_can(a,room,'view')
    and (created_at,id)>(coalesce((payload->>'after')::timestamptz,'epoch'::timestamptz),coalesce(payload->>'after_id','')) order by created_at,id limit 100) x;
  return result;
 elsif action='moderate' then
  if not 'moderate'=any(b.scopes) or chat_private.restricted(a,array['timeout']) or chat_private.restricted(b.owner_id,array['ban','warning','timeout']) or coalesce(chat_private.rank(b.owner_id),0)<20 then raise exception 'Bot moderation permission required';end if;
  target:=(payload->>'user_id')::uuid;act:=payload->>'action';expires:=nullif(payload->>'expires_at','')::timestamptz;
  if target=a or coalesce(chat_private.rank(target),100)>=20 then raise exception 'Bots cannot moderate staff or root';end if;
  if act<>all(array['warning','timeout','ban','unban','untimeout']) or act is null then raise exception 'Invalid moderation action';end if;
  if trim(coalesce(payload->>'reason',''))='' then raise exception 'A reason is required';end if;
  if (act='timeout' and expires is null) or expires<=now() then raise exception 'Choose a future expiry';end if;
  perform chat_private.rate(a,'moderate',10,60);
  if act in ('unban','untimeout') then update public.cb_moderation h set revoked_at=now() where h.user_id=target and h.action=case act when 'unban' then 'ban' else 'timeout' end and h.revoked_at is null;end if;
  insert into public.cb_moderation(user_id,action,reason,note,evidence,created_by,expires_at) values(target,act,left(payload->>'reason',1000),'Bot moderation',left(coalesce(payload->>'evidence',''),4000),a,expires);
  return '{}'::jsonb;
 elsif action in ('automod','delete_rule') then
  if not 'automod'=any(b.scopes) or chat_private.restricted(a,array['timeout']) or chat_private.restricted(b.owner_id,array['ban','warning','timeout']) or coalesce(chat_private.rank(b.owner_id),0)<40 then raise exception 'Bot AutoMod permission required';end if;
  return chat_private.dispatch(b.owner_id,action,payload);
 elsif action='delete_message' then
  select * into m from public.cb_messages where id=payload->>'id';
  if m.user_id=a then return chat_private.dispatch(a,action,payload);end if;
  if not 'manage_messages'=any(b.scopes) or chat_private.restricted(a,array['timeout']) or chat_private.restricted(b.owner_id,array['ban','warning','timeout']) or coalesce(chat_private.rank(b.owner_id),0)<20 or not public.cb_can(a,m.room,'view') or m.automod_event is not null then raise exception 'Bot message management permission required';end if;
  update public.cb_messages set deleted=true,text='',image_url=null,embeds='[]' where id=m.id;return '{}'::jsonb;
 elsif action in ('send','edit','dm') then return chat_private.dispatch(a,action,payload);
 end if;
 raise exception 'Unknown bot action';
end $$;
notify pgrst,'reload schema';
commit;
