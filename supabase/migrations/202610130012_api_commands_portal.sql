-- API message management, typed commands and owner-managed bot identity.
-- No existing messages, accounts, commands or channels are removed by this migration.
begin;
alter table public.cb_profiles add column banner_url text;
alter table chat_private.bot_commands add column options jsonb not null default '[]';
alter table chat_private.bot_commands add column required_role text check(required_role in ('Moderator','Administrator','Super Administrator','Owner'));
create function chat_private.role_rank(role_name text) returns int language sql immutable as $$select case role_name when 'Moderator' then 20 when 'Administrator' then 40 when 'Super Administrator' then 60 when 'Owner' then 80 else 0 end$$;
revoke all on function chat_private.role_rank(text) from public,anon,authenticated;
create table chat_private.message_pins (
 message_id text primary key references public.cb_messages(id) on delete cascade,
 actor uuid references public.cb_profiles(id) on delete cascade, created_at timestamptz not null default now()
);
create table chat_private.message_reactions (
 message_id text references public.cb_messages(id) on delete cascade,
 actor uuid references public.cb_profiles(id) on delete cascade,
 emoji text not null check(length(emoji) between 1 and 64), primary key(message_id,actor,emoji)
);
alter table chat_private.message_pins enable row level security;
alter table chat_private.message_reactions enable row level security;
revoke all on chat_private.message_pins,chat_private.message_reactions from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('chat-media','chat-media',true,12582912) on conflict do nothing;
create function public.cb_bot_image_access(bot_id text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.chat_human_ready() and exists(select 1 from public.cb_bots b where b.id::text=bot_id and (b.owner_id=auth.uid() or chat_private.is_root(auth.uid())));
$$;
revoke all on function public.cb_bot_image_access(text) from public,anon;
grant execute on function public.cb_bot_image_access(text) to authenticated;
create policy cb_bot_image_upload on storage.objects for insert to authenticated with check(
 bucket_id='chat-media' and (storage.foldername(name))[1]=auth.uid()::text
 and public.cb_bot_image_access((storage.foldername(name))[2])
 and lower(name)~'\.(png|jpg|jpeg|webp|gif|avif)$' and public.chat_human_ready()
);

create or replace function chat_private.captcha_action(action text) returns boolean language sql immutable as $$
 select action=any(array['moderate','role','nickname','automod','delete_rule','permission','bot_scopes','delete_message','create_bot','rotate_bot','revoke_bot']);
$$;

create function chat_private.validate_command_options(items jsonb,depth int default 0) returns void language plpgsql set search_path='' as $$
declare o jsonb;choice jsonb;t int;names text[]:='{}';choice_values jsonb:='[]';branches boolean;optional_seen boolean:=false;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>25 or depth>2 then raise exception 'Use up to 25 command options per level';end if;
 for o in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(o) is distinct from 'object' or coalesce(o->>'name','')!~'^[a-z0-9_-]{1,32}$' or o->>'name'=any(names) or length(trim(coalesce(o->>'description',''))) not between 1 and 100 or jsonb_typeof(o->'type') is distinct from 'number' then raise exception 'Invalid or duplicate command option';end if;
  names:=array_append(names,o->>'name');t:=(o->>'type')::int;
  if t not between 1 and 11 or (o->>'type')::numeric<>t then raise exception 'Invalid argument type';end if;
  if branches is not null and branches<>(t in (1,2)) then raise exception 'Do not mix subcommands and ordinary options';end if;branches:=t in (1,2);
  if o ? 'required' and jsonb_typeof(o->'required')<>'boolean' then raise exception 'Required must be a boolean';end if;
  if t in (1,2) then
   if depth=2 or (t=2 and depth<>0) or o ? 'required' or not o ? 'options' then raise exception 'Invalid subcommand nesting';end if;
   if t=2 and (jsonb_array_length(o->'options')=0 or exists(select 1 from jsonb_array_elements(o->'options') x where x->>'type'<>'1')) then raise exception 'Groups contain subcommands';end if;
   perform chat_private.validate_command_options(o->'options',depth+1);
  else
   if o ? 'options' then raise exception 'Only subcommands can contain options';end if;
   if optional_seen and coalesce((o->>'required')::boolean,false) then raise exception 'Required options must come first';end if;
   if not coalesce((o->>'required')::boolean,false) then optional_seen:=true;end if;
  end if;
  if o ? 'autocomplete' and (jsonb_typeof(o->'autocomplete')<>'boolean' or t not in (3,4,10)) then raise exception 'Autocomplete requires string, integer or number';end if;
  if o ? 'choices' then
   if t not in (3,4,10) or coalesce((o->>'autocomplete')::boolean,false) or jsonb_typeof(o->'choices')<>'array' or jsonb_array_length(o->'choices')>25 then raise exception 'Invalid command choices';end if;
   choice_values:='[]';
   for choice in select value from jsonb_array_elements(o->'choices') loop
    if length(trim(coalesce(choice->>'name',''))) not between 1 and 100 or not choice ? 'value' or choice_values @> jsonb_build_array(choice->'value') then raise exception 'Invalid or duplicate choice';end if;
    if (t=3 and (jsonb_typeof(choice->'value')<>'string' or length(choice->>'value')>100)) or (t in (4,10) and (jsonb_typeof(choice->'value')<>'number' or abs((choice->>'value')::numeric)>9007199254740991 or (t=4 and trunc((choice->>'value')::numeric)<>(choice->>'value')::numeric))) then raise exception 'Choice type mismatch';end if;
    choice_values:=choice_values||jsonb_build_array(choice->'value');
   end loop;
  end if;
  if (o ? 'min_value' or o ? 'max_value') and (t not in (4,10) or (o ? 'min_value' and jsonb_typeof(o->'min_value')<>'number') or (o ? 'max_value' and jsonb_typeof(o->'max_value')<>'number') or (o->>'min_value')::numeric>(o->>'max_value')::numeric) then raise exception 'Invalid numeric limits';end if;
  if (o ? 'min_length' or o ? 'max_length') and (t<>3 or coalesce((o->>'min_length')::int,0) not between 0 and 6000 or coalesce((o->>'max_length')::int,6000) not between 1 and 6000 or coalesce((o->>'min_length')::int,0)>coalesce((o->>'max_length')::int,6000)) then raise exception 'Invalid string limits';end if;
  if o ? 'format' and (t<>3 or o->>'format' not in ('duration','date','color','multiline','url')) then raise exception 'Unknown custom argument format';end if;
  if o ? 'channel_types' and (t<>7 or jsonb_typeof(o->'channel_types')<>'array' or exists(select 1 from jsonb_array_elements_text(o->'channel_types') x where x not in ('0','4','5','11','1','text','announcement','thread','dm','category'))) then raise exception 'Unsupported CHATBOX channel type';end if;
  if o ? 'file_types' and (t<>11 or jsonb_typeof(o->'file_types')<>'array' or jsonb_array_length(o->'file_types')>10 or exists(select 1 from jsonb_array_elements_text(o->'file_types') x where x not in ('image','video','audio') and x!~'^\.[a-zA-Z0-9]{1,16}$')) then raise exception 'Invalid attachment file types';end if;
 end loop;
end $$;

create function chat_private.command_values(defs jsonb,items jsonb,a uuid,b uuid,c text,partial boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jsonb;v jsonb;x jsonb;n int;t int;result jsonb:='[]';resolved jsonb:='{"users":{},"channels":{},"roles":{},"attachments":{}}';child jsonb;key text;ref text;ch public.cb_channels;attachment jsonb;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>25 then raise exception 'Arguments must be an option array';end if;
 if exists(select 1 from jsonb_array_elements(items) i where not exists(select 1 from jsonb_array_elements(defs) d where d->>'name'=i->>'name')) or (select count(*) from jsonb_array_elements(items))<>(select count(distinct value->>'name') from jsonb_array_elements(items)) then raise exception 'Unknown or duplicate argument';end if;
 if exists(select 1 from jsonb_array_elements(defs) d where d->>'type' in ('1','2')) and (jsonb_array_length(items)<>1 and not partial) then raise exception 'Choose one subcommand';end if;
 for o in select value from jsonb_array_elements(defs) loop
  select value into x from jsonb_array_elements(items) where value->>'name'=o->>'name';t:=(o->>'type')::int;
  if x is null then if not partial and coalesce((o->>'required')::boolean,false) then raise exception 'Missing required argument: %',o->>'name';end if;continue;end if;
  if x ? 'type' and x->'type'<>o->'type' then raise exception 'Argument type mismatch';end if;
  if t in (1,2) then
   child:=chat_private.command_values(o->'options',x->'options',a,b,c,partial);
   result:=result||jsonb_build_array(jsonb_build_object('name',o->>'name','type',t,'options',child->'options'));
   foreach key in array array['users','channels','roles','attachments'] loop resolved:=jsonb_set(resolved,array[key],(resolved->key)||(child#>array['resolved',key]));end loop;
   continue;
  end if;
  v:=x->'value';ref:=x->>'value';
  if v is null or v='null'::jsonb then raise exception 'An argument value is required';end if;
  if t=3 then
   if jsonb_typeof(v)<>'string' or length(ref)<coalesce((o->>'min_length')::int,0) or length(ref)>coalesce((o->>'max_length')::int,6000) then raise exception 'String argument is outside its limits';end if;
   if o->>'format'='duration' and ref!~'^[0-9]+(\.[0-9]+)?[smhdw]$' then raise exception 'Use a duration such as 30s, 5m, 2h, 3d or 1w';end if;
   if o->>'format'='color' and ref!~'^#[a-fA-F0-9]{6}$' then raise exception 'Use a hex color such as #5865f2';end if;
   if o->>'format'='date' then if ref!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Use YYYY-MM-DD';end if;perform ref::date;end if;
   if o->>'format'='url' and ref!~'^https://[^[:space:]]+$' then raise exception 'Use an HTTPS URL';end if;
  elsif t in (4,10) then
   if jsonb_typeof(v)<>'number' or abs(ref::numeric)>9007199254740991 or (t=4 and trunc(ref::numeric)<>ref::numeric) or (o ? 'min_value' and ref::numeric<(o->>'min_value')::numeric) or (o ? 'max_value' and ref::numeric>(o->>'max_value')::numeric) then raise exception 'Numeric argument is outside its limits';end if;
  elsif t=5 then if jsonb_typeof(v)<>'boolean' then raise exception 'Boolean argument required';end if;
  elsif t in (6,7,8,9) then
   if jsonb_typeof(v)<>'string' then raise exception 'Select a valid reference';end if;
   if t=6 or (t=9 and ref not like 'role:%') then
    if not exists(select 1 from public.cb_profiles where id::text=ref) then raise exception 'User unavailable';end if;
    resolved:=jsonb_set(resolved,array['users',ref],(select to_jsonb(p) from public.cb_profiles p where id::text=ref));
   elsif t=7 then
    select * into ch from public.cb_channels where id=ref and public.cb_can(a,id,'view') and public.cb_can(b,id,'view');
    if ch.id is not null then
     if o ? 'channel_types' and not (o->'channel_types' @> jsonb_build_array(ch.kind) or o->'channel_types' @> jsonb_build_array(case ch.kind when 'text' then 0 when 'dm' then 1 when 'announcement' then 5 else 11 end)) then raise exception 'Channel type not allowed';end if;
     resolved:=jsonb_set(resolved,array['channels',ref],to_jsonb(ch));
    elsif exists(select 1 from public.cb_categories where id=ref and deleted_at is null) and (not o ? 'channel_types' or o->'channel_types' @> '[4]' or o->'channel_types' @> '["category"]') then
     resolved:=jsonb_set(resolved,array['channels',ref],(select to_jsonb(cat)||'{"kind":"category"}' from public.cb_categories cat where id=ref));
    else raise exception 'Channel unavailable';end if;
   else
    key:=case when t=9 then substr(ref,6) else ref end;
    if key<>all(array['Owner','Super Administrator','Administrator','Moderator']) then raise exception 'Role unavailable';end if;
    resolved:=jsonb_set(resolved,array['roles',ref],jsonb_build_object('id',ref,'name',key));
   end if;
  elsif t=11 then
   if jsonb_typeof(v)<>'object' or left(coalesce(v->>'url',''),9)<>'cb-media:' or split_part(substr(v->>'url',10),'/',1)<>a::text or split_part(substr(v->>'url',10),'/',2)<>c or not public.cb_can(a,c,'attach') or not exists(select 1 from storage.objects where bucket_id='chatbox-private' and name=substr(v->>'url',10)) then raise exception 'Upload a channel attachment first';end if;
   if length(coalesce(v->>'name','')) not between 1 and 200 or coalesce((v->>'size')::bigint,-1) not between 0 and 12582912 then raise exception 'Invalid attachment metadata';end if;
   if o ? 'file_types' and jsonb_array_length(o->'file_types')>0 and not exists(select 1 from jsonb_array_elements_text(o->'file_types') f where (f='image' and lower(v->>'name')~'\.(png|jpe?g|gif|webp|avif)$') or (f='video' and lower(v->>'name')~'\.(mp4|webm|mov)$') or (f='audio' and lower(v->>'name')~'\.(mp3|ogg|wav|m4a|flac)$') or (f like '.%' and right(lower(v->>'name'),length(f))=lower(f))) then raise exception 'Attachment file type not allowed';end if;
   ref:=v->>'url';resolved:=jsonb_set(resolved,array['attachments',ref],v);v:=to_jsonb(ref);
  end if;
  if o ? 'choices' and jsonb_array_length(o->'choices')>0 and not exists(select 1 from jsonb_array_elements(o->'choices') q where q->'value'=v) then raise exception 'Choose a declared value';end if;
  result:=result||jsonb_build_array(jsonb_build_object('name',o->>'name','type',t,'value',v));
 end loop;
 return jsonb_build_object('options',result,'resolved',resolved);
end $$;
revoke all on function chat_private.validate_command_options(jsonb,int),chat_private.command_values(jsonb,jsonb,uuid,uuid,text,boolean) from public,anon,authenticated;

alter function chat_private.dispatch(uuid,text,jsonb) rename to dispatch_before_portal;
create function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;b public.cb_bots;v text;begin
 if op not in ('bot_profile','developer_bots') then return chat_private.dispatch_before_portal(a,op,p);end if;
 if a is null or chat_private.restricted(a,array['ban','warning','timeout']) then raise exception 'Sign in with an unrestricted account';end if;
 if op='developer_bots' then return coalesce((select jsonb_agg((to_jsonb(x)-'token_hash')||jsonb_build_object('profile',to_jsonb(pr))) from public.cb_bots x join public.cb_profiles pr on pr.id=x.id where x.owner_id=a or chat_private.is_root(a)),'[]');end if;
 target:=(p->>'id')::uuid;select * into b from public.cb_bots where id=target and (owner_id=a or chat_private.is_root(a));
 if b.id is null then raise exception 'You do not own this bot';end if;
 perform chat_private.rate(a,'bot_profile',20,60);
 if p ? 'username' and (coalesce(p->>'username','')!~'^[a-z0-9_.]{2,40}$' or lower(p->>'username')='root') then raise exception 'Use a unique 2–40 character bot username';end if;
 if p ? 'display_name' and length(trim(coalesce(p->>'display_name',''))) not between 1 and 64 then raise exception 'Display name must be 1–64 characters';end if;
 if length(coalesce(p->>'bio',''))>2000 or length(coalesce(p->>'status',''))>160 then raise exception 'Description or status too long';end if;
 foreach v in array array[p->>'avatar_url',p->>'banner_url'] loop if v is not null and v<>'' and (length(v)>2048 or v!~'^https://[^[:space:]]+$') then raise exception 'Images must use HTTPS';end if;end loop;
 if p ? 'banner_color' and coalesce(p->>'banner_color','')!~'^#[a-fA-F0-9]{6}$' then raise exception 'Invalid banner color';end if;
 update public.cb_profiles set username=coalesce(p->>'username',username),display_name=coalesce(trim(p->>'display_name'),display_name),bio=coalesce(p->>'bio',bio),status=coalesce(p->>'status',status),avatar_url=case when p ? 'avatar_url' then nullif(p->>'avatar_url','') else avatar_url end,banner_url=case when p ? 'banner_url' then nullif(p->>'banner_url','') else banner_url end,banner_color=coalesce(p->>'banner_color',banner_color) where id=target;
 return (select to_jsonb(pr) from public.cb_profiles pr where id=target);
end $$;
revoke all on function chat_private.dispatch(uuid,text,jsonb),chat_private.dispatch_before_portal(uuid,text,jsonb) from public,anon,authenticated;

alter function chat_private.bot_dispatch(uuid,text,jsonb) rename to bot_dispatch_before_api;
create function chat_private.bot_dispatch(actor uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.cb_bots;c text:=payload->>'channel_id';m public.cb_messages;r jsonb;d jsonb;items jsonb;ids text[];mid text;count_limit int:=100;cut public.cb_messages;begin
 if action not in ('commands_set','command_create','command_edit','command_delete','commands','messages','message','bulk_delete','pins','pin','unpin','react','unreact','reactions','clear_reactions','automod_rules','permissions','attachment','profile') then return chat_private.bot_dispatch_before_api(actor,action,payload);end if;
 select * into b from public.cb_bots where id=actor and enabled;
 if b.id is null or chat_private.restricted(actor,array['ban','warning']) or chat_private.restricted(b.owner_id,array['ban','warning','timeout']) then raise exception 'Bot is restricted or revoked';end if;
 perform chat_private.rate(actor,'api',60,60);
 if action in ('commands_set','command_create','command_edit','command_delete','commands') then
  if action<>'commands' then
   if chat_private.restricted(actor,array['timeout']) then raise exception 'Bot is timed out';end if;
   items:=case when action='commands_set' then payload->'commands' when action='command_delete' then '[]'::jsonb else jsonb_build_array(payload->'command') end;
   if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>100 then raise exception 'Use up to 100 commands';end if;
   if (select count(distinct x->>'name') from jsonb_array_elements(items) x)<>jsonb_array_length(items) then raise exception 'Duplicate command name';end if;
   for d in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'name','')!~'^[a-z0-9_-]{1,32}$' or length(trim(coalesce(d->>'description',''))) not between 1 and 100 then raise exception 'Commands need a name and description';end if;
    perform chat_private.validate_command_options(coalesce(d->'options','[]'));
    if d ? 'required_role' and d->>'required_role'<>all(array['Moderator','Administrator','Super Administrator','Owner']) then raise exception 'Invalid command role';end if;
   end loop;
   if action='commands_set' then delete from chat_private.bot_commands where bot_id=actor and name not in(select x->>'name' from jsonb_array_elements(items) x);
   elsif action in ('command_edit','command_delete') then
    if not exists(select 1 from chat_private.bot_commands where bot_id=actor and name=payload->>'name') then raise exception 'Command unavailable';end if;
    if action='command_edit' and items->0->>'name'<>payload->>'name' and exists(select 1 from chat_private.bot_commands where bot_id=actor and name=items->0->>'name') then raise exception 'Command name already exists';end if;
    delete from chat_private.bot_commands where bot_id=actor and name=payload->>'name';
   end if;
   insert into chat_private.bot_commands(bot_id,name,description,options,required_role) select actor,x->>'name',x->>'description',coalesce(x->'options','[]'),x->>'required_role' from jsonb_array_elements(items) x on conflict(bot_id,name) do update set description=excluded.description,options=excluded.options,required_role=excluded.required_role where bot_commands.description is distinct from excluded.description or bot_commands.options is distinct from excluded.options or bot_commands.required_role is distinct from excluded.required_role;
   if (select count(*) from chat_private.bot_commands where bot_id=actor)>100 then raise exception 'Use up to 100 commands';end if;
  end if;
  return coalesce((select jsonb_agg(x order by name) from chat_private.bot_commands x where bot_id=actor),'[]');
 elsif action='profile' then return chat_private.dispatch(b.owner_id,'bot_profile',payload||jsonb_build_object('id',actor));
 elsif action='automod_rules' then
  if not 'automod'=any(b.scopes) or coalesce(chat_private.rank(b.owner_id),0)<40 then raise exception 'Bot AutoMod permission required';end if;
  return coalesce((select jsonb_agg(x) from public.cb_automod x),'[]');
 elsif action='permissions' then
  if not 'manage_channels'=any(b.scopes) or coalesce(chat_private.rank(b.owner_id),0)<40 or not public.cb_can(actor,c,'view') or not public.cb_can(actor,c,'manage') then raise exception 'Manage channel permission required';end if;
  return coalesce((select jsonb_agg(x) from public.cb_overwrites x where channel_id=c),'[]');
 elsif action='attachment' then
  mid:=payload->>'url';
  if mid not like 'cb-media:%' or not exists(select 1 from storage.objects o where bucket_id='chatbox-private' and name=substr(mid,10) and public.cb_can(actor,split_part(o.name,'/',2),'view')) then raise exception 'Attachment unavailable';end if;
  return jsonb_build_object('bucket','chatbox-private','path',substr(mid,10));
 elsif action='messages' then
  if not public.cb_can(actor,c,'view') then raise exception 'Channel unavailable';end if;
  count_limit:=coalesce((payload->>'limit')::int,100);if count_limit not between 1 and 100 then raise exception 'Limit must be 1–100';end if;
  if (payload ? 'before' and payload->>'before' is not null) and ((payload ? 'after' and payload->>'after' is not null) or (payload ? 'after_id' and nullif(payload->>'after_id','') is not null)) then raise exception 'Use before or after, not both';end if;
  if payload->>'before' is not null then
   select * into cut from public.cb_messages where id=payload->>'before' and room=c and not deleted;
   if cut.id is null then raise exception 'Cursor unavailable';end if;
   select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('author',(select to_jsonb(pr) from public.cb_profiles pr where id=x.user_id)) order by x.created_at desc,x.id desc),'[]') into r from(select * from public.cb_messages where room=c and not deleted and automod_event is null and (created_at,id)<(cut.created_at,cut.id) order by created_at desc,id desc limit count_limit)x;
  elsif payload->>'after' is not null or nullif(payload->>'after_id','') is not null then
   if payload->>'after' is null then select * into cut from public.cb_messages where id=payload->>'after_id' and room=c and not deleted;if cut.id is null then raise exception 'Cursor unavailable';end if;end if;
   select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('author',(select to_jsonb(pr) from public.cb_profiles pr where id=x.user_id)) order by x.created_at,x.id),'[]') into r from(select * from public.cb_messages where room=c and not deleted and automod_event is null and (created_at,id)>(coalesce((payload->>'after')::timestamptz,cut.created_at),coalesce(payload->>'after_id','')) order by created_at,id limit count_limit)x;
  else
   select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('author',(select to_jsonb(pr) from public.cb_profiles pr where id=x.user_id)) order by x.created_at desc,x.id desc),'[]') into r from(select * from public.cb_messages where room=c and not deleted and automod_event is null order by created_at desc,id desc limit count_limit)x;
  end if;return r;
 elsif action='bulk_delete' then
  if chat_private.restricted(actor,array['timeout']) or not public.cb_can(actor,c,'view') then raise exception 'Message management permission denied';end if;
  if payload ? 'count' then
   count_limit:=(payload->>'count')::int;if count_limit not between 1 and 100 then raise exception 'Bulk delete count must be 1–100';end if;
   select coalesce(array_agg(id),'{}') into ids from(select id from public.cb_messages where room=c and not deleted and automod_event is null order by created_at desc,id desc limit count_limit)x;
  else
   if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids') not between 1 and 100 then raise exception 'Select 1–100 message IDs';end if;
   ids:=array(select distinct jsonb_array_elements_text(payload->'ids'));
  end if;
  -- Lock the full selection before validating or changing any row. Cross-channel IDs fail atomically.
  perform id from public.cb_messages where id=any(ids) order by id for update;
  if exists(select 1 from unnest(ids) i where not exists(select 1 from public.cb_messages where id=i and room=c and automod_event is null)) then raise exception 'Message unavailable in this channel';end if;
  if exists(select 1 from public.cb_messages where id=any(ids) and user_id<>actor and not deleted) and (not 'manage_messages'=any(b.scopes) or coalesce(chat_private.rank(b.owner_id),0)<20) then raise exception 'Bot message management permission required';end if;
  with changed as(update public.cb_messages set deleted=true,text='',image_url=null,attachment_name=null,attachment_bytes=null,embeds='[]',components='[]' where id=any(ids) and not deleted returning id) select coalesce(jsonb_agg(id),'[]') into r from changed;
  delete from chat_private.message_pins where message_id=any(ids);delete from chat_private.message_reactions where message_id=any(ids);
  return jsonb_build_object('ids',r,'count',jsonb_array_length(r));
 elsif action='pins' then
  if not public.cb_can(actor,c,'view') then raise exception 'Channel unavailable';end if;
  return coalesce((select jsonb_agg(to_jsonb(msg)||jsonb_build_object('pinned_at',p.created_at) order by p.created_at desc) from chat_private.message_pins p join public.cb_messages msg on msg.id=p.message_id where msg.room=c and not msg.deleted),'[]');
 end if;
 select * into m from public.cb_messages where id=payload->>'id' and not deleted and automod_event is null for update;
 if m.id is null or not public.cb_can(actor,m.room,'view') then raise exception 'Message unavailable';end if;
 if action='message' then return to_jsonb(m)||jsonb_build_object('author',(select to_jsonb(pr) from public.cb_profiles pr where id=m.user_id));end if;
 if action='reactions' then return coalesce((select jsonb_agg(x) from(select emoji,count(*)::int count,bool_or(r.actor=$1) me from chat_private.message_reactions r where message_id=m.id group by emoji)x),'[]');end if;
 if chat_private.restricted(actor,array['timeout']) then raise exception 'Bot is timed out';end if;
 if action in ('pin','unpin','clear_reactions') and (not 'manage_messages'=any(b.scopes) or coalesce(chat_private.rank(b.owner_id),0)<20) then raise exception 'Bot message management permission required';end if;
 if action='pin' then insert into chat_private.message_pins(message_id,actor) values(m.id,actor) on conflict do nothing;
 elsif action='unpin' then delete from chat_private.message_pins where message_id=m.id;
 elsif action='clear_reactions' then delete from chat_private.message_reactions where message_id=m.id;
 elsif action in ('react','unreact') then
  if not public.cb_can(actor,m.room,'send') or length(trim(coalesce(payload->>'emoji',''))) not between 1 and 64 then raise exception 'Reaction permission denied or invalid emoji';end if;
  if action='react' then insert into chat_private.message_reactions values(m.id,actor,payload->>'emoji') on conflict do nothing;
  else delete from chat_private.message_reactions r where message_id=m.id and r.actor=$1 and emoji=payload->>'emoji';end if;
 end if;return '{}';
end $$;
revoke all on function chat_private.bot_dispatch(uuid,text,jsonb),chat_private.bot_dispatch_before_api(uuid,text,jsonb) from public,anon,authenticated;

alter function chat_private.chat_interact(text,jsonb) rename to interact_before_options;
create function chat_private.chat_interact(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();b uuid:=(payload->>'bot_id')::uuid;c text:=payload->>'channel_id';cmd chat_private.bot_commands;r jsonb;values_json jsonb;focus jsonb;defs jsonb;o jsonb;begin
 if action='commands' then
  r:=chat_private.interact_before_options(action,payload);
  return coalesce((select jsonb_agg(x) from jsonb_array_elements(r) x where coalesce(chat_private.rank(a),0)>=chat_private.role_rank(x->>'required_role')),'[]');
 end if;
 if action not in ('command','autocomplete') then return chat_private.interact_before_options(action,payload);end if;
 select * into cmd from chat_private.bot_commands where bot_id=b and name=payload->>'name';
 if cmd.name is null then raise exception 'Command unavailable';end if;
 if coalesce(chat_private.rank(a),0)<chat_private.role_rank(cmd.required_role) then raise exception 'Command role permission required';end if;
 values_json:=chat_private.command_values(cmd.options,coalesce(payload->'options','[]'),a,b,c,action='autocomplete');
 if action='autocomplete' then
  focus:=payload->'focused';defs:=cmd.options;
  for o in select value from jsonb_array_elements(coalesce(payload->'path','[]')) loop
   select d->'options' into defs from jsonb_array_elements(defs) d where d->>'name'=o#>>'{}' and d->>'type' in ('1','2');
  end loop;
  select d into o from jsonb_array_elements(defs) d where d->>'name'=focus->>'name' and coalesce((d->>'autocomplete')::boolean,false);
  if o is null or length(coalesce(focus->>'value',''))>100 then raise exception 'Autocomplete option unavailable';end if;
  values_json:=values_json||jsonb_build_object('focused',focus||jsonb_build_object('type',(o->>'type')::int));
 end if;
 r:=chat_private.interact_before_options('command',payload);
 update chat_private.bot_interactions set fields=fields||values_json,kind=case when action='autocomplete' then 'autocomplete' else 'command' end,expires_at=case when action='autocomplete' then now()+interval '1 minute' else expires_at end where id=(r->>'id')::uuid;
 return r;
end $$;
revoke all on function chat_private.chat_interact(text,jsonb),chat_private.interact_before_options(text,jsonb) from public,anon,authenticated;

-- Autocomplete replies are private and cannot be confused with public command replies.
alter function chat_private.bot_dispatch(uuid,text,jsonb) rename to bot_dispatch_with_options;
create function chat_private.bot_dispatch(actor uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare i chat_private.bot_interactions;b public.cb_bots;x jsonb;items jsonb:=payload->'choices';t int;begin
 if action<>'autocomplete_reply' then
  if action='interaction_reply' and exists(select 1 from chat_private.bot_interactions where id=(payload->>'id')::uuid and kind='autocomplete') then raise exception 'Use respond for autocomplete';end if;
  return chat_private.bot_dispatch_with_options(actor,action,payload);
 end if;
 select * into b from public.cb_bots where id=actor and enabled;
 if b.id is null or chat_private.restricted(actor,array['ban','warning','timeout']) or chat_private.restricted(b.owner_id,array['ban','warning','timeout']) then raise exception 'Bot is restricted or revoked';end if;
 perform chat_private.rate(actor,'api',60,60);
 select * into i from chat_private.bot_interactions where id=(payload->>'id')::uuid and bot_id=actor and kind='autocomplete' and expires_at>now() and responded_at is null for update;
 if i.id is null or not public.cb_can(actor,i.channel_id,'view') or not public.cb_can(i.user_id,i.channel_id,'view') then raise exception 'Autocomplete unavailable';end if;
 t:=(i.fields#>>'{focused,type}')::int;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>25 then raise exception 'Use up to 25 autocomplete choices';end if;
 for x in select value from jsonb_array_elements(items) loop
  if length(trim(coalesce(x->>'name',''))) not between 1 and 100 or (t=3 and (jsonb_typeof(x->'value') is distinct from 'string' or length(x->>'value')>100)) or (t in (4,10) and (jsonb_typeof(x->'value') is distinct from 'number' or abs((x->>'value')::numeric)>9007199254740991 or (t=4 and trunc((x->>'value')::numeric)<>(x->>'value')::numeric))) then raise exception 'Invalid autocomplete choice';end if;
 end loop;
 update chat_private.bot_interactions set response=jsonb_build_object('type','choices','choices',items),responded_at=now() where id=i.id;return '{}';
end $$;
revoke all on function chat_private.bot_dispatch(uuid,text,jsonb),chat_private.bot_dispatch_with_options(uuid,text,jsonb) from public,anon,authenticated;

-- Run a startup event on publish, so API command registration needs no dashboard menu or chat message.
alter table chat_private.bot_jobs add column startup boolean not null default false;
alter table chat_private.bot_jobs drop constraint bot_job_event_check;
alter table chat_private.bot_jobs add constraint bot_job_event_check check(num_nonnulls(message_id,interaction_id)+startup::int=1);
create unique index cb_bot_startup_revision on chat_private.bot_jobs(bot_id,revision) where startup;
alter function chat_private.chat_hosted(text,jsonb) rename to hosted_before_startup;
create function chat_private.chat_hosted(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 r:=chat_private.hosted_before_startup(action,payload);
 -- Queue after the existing publish operation cancels jobs from the previous revision.
 if action='save' and coalesce((r->>'enabled')::boolean,false) then
  insert into chat_private.bot_jobs(bot_id,revision,startup) values((r->>'bot_id')::uuid,(r->>'revision')::bigint,true) on conflict do nothing;
 end if;return r;
end $$;
revoke all on function chat_private.chat_hosted(text,jsonb),chat_private.hosted_before_startup(text,jsonb) from public,anon,authenticated;
do $$declare src text;begin
 src:=pg_get_functiondef('public.chat_hosted_claim(text)'::regprocedure);
 if strpos(src,'if j.interaction_id is not null then')=0 then raise exception 'Hosted claim version mismatch';end if;
 src:=replace(src,'if j.interaction_id is not null then','if j.startup then event:=jsonb_build_object(''startup'',true); elsif j.interaction_id is not null then');execute src;
end $$;
notify pgrst,'reload schema';
commit;
