-- CHATBOX v2. Run once, transactionally. Existing tables are retained for rollback.
-- The import uses JSON to tolerate optional legacy columns. Test against a schema copy first.
begin;
create schema if not exists chat_private;
revoke all on schema chat_private from public, anon, authenticated;
create table if not exists chat_private.legacy_acl (table_name text, grantee text, privilege_type text, is_grantable text, primary key(table_name,grantee,privilege_type));
-- Cutover barrier: wait for in-flight legacy writes, then retain the original
-- tables as an archive. Old clients cannot bypass v2 moderation or permissions.
-- The lock/revokes and import roll back together if any validation fails.
do $$ declare t text;begin
 foreach t in array array['profiles','channels','messages','channel_members','channel_lock_bypass','announcements','message_filters','user_bans','user_mutes','ip_bans','ip_mutes','audit_logs'] loop
  if to_regclass('public.'||t) is not null then
   execute format('lock table public.%I in share row exclusive mode',t);
   insert into chat_private.legacy_acl select table_name,grantee,privilege_type,is_grantable from information_schema.table_privileges where table_schema='public' and table_name=t and grantee in ('PUBLIC','anon','authenticated') on conflict do nothing;
   execute format('revoke all on public.%I from public,anon,authenticated',t);
  end if;
 end loop;
end $$;
create table if not exists chat_private.root_account (id uuid primary key);
create table if not exists public.cb_profiles (
 id uuid primary key, username text unique not null, display_name text not null,
 avatar_url text, banner_color text not null default '#5865f2', bio text not null default '',
 pronouns text not null default '', status text not null default '', roles text[] not null default '{}',
 is_bot boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.cb_categories (id text primary key default gen_random_uuid()::text, name text not null, sort_order bigint not null default 0);
create table if not exists public.cb_channels (
 id text primary key default gen_random_uuid()::text, name text not null, topic text not null default '',
 category_id text references public.cb_categories on delete set null,
 kind text not null default 'text' check(kind in ('text','announcement','dm')),
 is_private boolean not null default false, is_locked boolean not null default false,
 slowmode_seconds integer not null default 0 check(slowmode_seconds between 0 and 21600),
 created_by uuid, sort_order bigint default 0, archived boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.cb_announcements (id text primary key default gen_random_uuid()::text,title text not null,body text not null,created_by uuid,created_at timestamptz not null default now(),is_pinned boolean not null default false,pinned_at timestamptz);
create table if not exists public.cb_channel_members (channel_id text references public.cb_channels on delete cascade, user_id uuid references public.cb_profiles on delete cascade, primary key(channel_id,user_id));
create table if not exists public.cb_overwrites (
 channel_id text references public.cb_channels on delete cascade,
 subject text not null, permission text not null check(permission in ('view','send','attach','manage','mention_everyone')),
 value boolean not null, primary key(channel_id,subject,permission)
);
create table if not exists public.cb_messages (
 id text primary key default gen_random_uuid()::text, room text not null references public.cb_channels,
 user_id uuid not null references public.cb_profiles, text text not null default '', image_url text,
 attachment_name text, attachment_bytes bigint, reply_to text references public.cb_messages on delete set null,
 created_at timestamptz not null default now(), edited_at timestamptz, deleted boolean not null default false
);
create index if not exists cb_messages_room_time on public.cb_messages(room,created_at,id);
create table if not exists public.cb_reads (user_id uuid references public.cb_profiles, channel_id text references public.cb_channels, read_at timestamptz not null default now(), primary key(user_id,channel_id));
create table if not exists public.cb_moderation (
 id text primary key default gen_random_uuid()::text, user_id uuid not null references public.cb_profiles,
 action text not null check(action in ('warning','ban','timeout','unban','untimeout')),
 reason text not null, note text not null default '', evidence text not null default '',
 created_by uuid, created_at timestamptz not null default now(), expires_at timestamptz,
 acknowledged_at timestamptz, revoked_at timestamptz
);
create index if not exists cb_moderation_user on public.cb_moderation(user_id,created_at);
create table if not exists public.cb_automod (
 id text primary key default gen_random_uuid()::text, name text not null, enabled boolean not null default true,
 words text[] not null default '{}', patterns text[] not null default '{}', allowed_words text[] not null default '{}',
 block_message text not null default 'This content is blocked by this server.',
 exempt_channels text[] not null default '{}', exempt_roles text[] not null default '{}',
 created_by uuid, created_at timestamptz not null default now()
);
create table if not exists public.cb_automod_events (
 id text primary key default gen_random_uuid()::text, user_id uuid not null, room text not null,
 rule_id text, rule_name text, created_at timestamptz not null default now()
);
create table if not exists public.cb_bots (
 id uuid primary key references public.cb_profiles, owner_id uuid not null references public.cb_profiles,
 token_hash text not null, enabled boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists chat_private.rate_limits (actor uuid, bucket text, started timestamptz not null, hits int not null, primary key(actor,bucket));
create table if not exists chat_private.slowmode (actor uuid, channel_id text references public.cb_channels on delete cascade, last_sent timestamptz, primary key(actor,channel_id));
create table if not exists chat_private.migrations (name text primary key);

-- Import locally inside Supabase, preserving original ids, accounts, timestamps and tables.
do $$ declare j jsonb; ch text; begin
 if exists(select 1 from chat_private.migrations where name='legacy-import') then return; end if;
 if to_regclass('public.profiles') is not null then
  for j in execute 'select to_jsonb(p) from public.profiles p' loop
   insert into public.cb_profiles(id,username,display_name,avatar_url,created_at,roles)
   values((j->>'id')::uuid,j->>'username',coalesce(j->>'display_name',j->>'username'),j->>'avatar_url',coalesce((j->>'created_at')::timestamptz,now()),case when j->>'role'='admin' then array['Administrator'] else '{}'::text[] end) on conflict do nothing;
  end loop;
 end if;
 insert into chat_private.root_account select u.id from auth.users u join public.cb_profiles p on p.id=u.id where lower(u.email)='root@local.chat' and p.username='root' on conflict do nothing;
 if (select count(*) from chat_private.root_account)<>1 then raise exception 'Expected exactly one existing root account. No data was migrated.';end if;
 if to_regclass('public.channels') is not null then
  for j in execute 'select to_jsonb(c) from public.channels c' loop
   insert into public.cb_channels(id,name,created_by,is_private,is_locked,sort_order,created_at)
   values(j->>'id',coalesce(j->>'name',j->>'id'),(j->>'created_by')::uuid,coalesce((j->>'is_private')::boolean,false),coalesce((j->>'is_locked')::boolean,false),(j->>'sort_order')::bigint,coalesce((j->>'created_at')::timestamptz,now())) on conflict do nothing;
  end loop;
 end if;
 if to_regclass('public.channel_members') is not null then
  for j in execute 'select to_jsonb(m) from public.channel_members m' loop
   insert into public.cb_channel_members values(j->>'channel_id',(j->>'user_id')::uuid) on conflict do nothing;
  end loop;
 end if;
 if to_regclass('public.channel_lock_bypass') is not null then
  for j in execute 'select to_jsonb(m) from public.channel_lock_bypass m' loop
   insert into public.cb_overwrites values(j->>'channel_id','user:'||(j->>'user_id'),'send',true) on conflict do nothing;
  end loop;
 end if;
 if to_regclass('public.messages') is not null then
  for j in execute 'select to_jsonb(m) from public.messages m order by created_at' loop
   ch:=j->>'room';
   if not exists(select 1 from public.cb_channels where id=ch) then raise exception 'Legacy message room % has no channel. Resolve the mapping before importing; no default channels were created.',ch;end if;
   if not exists(select 1 from public.cb_profiles where id=(j->>'user_id')::uuid) then raise exception 'A legacy message author is missing. Resolve before importing.';else
    insert into public.cb_messages(id,room,user_id,text,image_url,created_at,edited_at,deleted)
    values(j->>'id',ch,(j->>'user_id')::uuid,coalesce(j->>'text',''),j->>'image_url',coalesce((j->>'created_at')::timestamptz,now()),(j->>'edited_at')::timestamptz,coalesce((j->>'deleted')::boolean,false)) on conflict do nothing;
   end if;
  end loop;
 end if;
 if to_regclass('public.user_bans') is not null then
  for j in execute 'select to_jsonb(b) from public.user_bans b' loop
   insert into public.cb_moderation(id,user_id,action,reason,created_by,created_at) values('legacy-ban-'||(j->>'user_id'),(j->>'user_id')::uuid,'ban',coalesce(j->>'reason','Legacy ban'),(j->>'created_by')::uuid,coalesce((j->>'created_at')::timestamptz,now())) on conflict do nothing;
  end loop;
 end if;
 if to_regclass('public.user_mutes') is not null then
  for j in execute 'select to_jsonb(b) from public.user_mutes b' loop
   insert into public.cb_moderation(id,user_id,action,reason,expires_at,created_at) values('legacy-mute-'||(j->>'user_id'),(j->>'user_id')::uuid,'timeout',coalesce(j->>'reason','Legacy timeout'),(j->>'muted_until')::timestamptz,coalesce((j->>'updated_at')::timestamptz,now())) on conflict do nothing;
  end loop;
 end if;
 if to_regclass('public.message_filters') is not null then
  for j in execute 'select to_jsonb(f) from public.message_filters f' loop
   insert into public.cb_automod(id,name,words,enabled) values('legacy-'||(j->>'id'),'Imported word filter',array[j->>'pattern'],coalesce((j->>'enabled')::boolean,true)) on conflict do nothing;
  end loop;
 end if;
 if to_regclass('public.announcements') is not null then
  for j in execute 'select to_jsonb(a) from public.announcements a' loop
   insert into public.cb_announcements(id,title,body,created_by,created_at,is_pinned,pinned_at) values(j->>'id',coalesce(j->>'title','Announcement'),coalesce(j->>'body',''),(j->>'created_by')::uuid,coalesce((j->>'created_at')::timestamptz,now()),coalesce((j->>'is_pinned')::boolean,false),(j->>'pinned_at')::timestamptz) on conflict do nothing;
  end loop;
 end if;
 insert into chat_private.migrations values('legacy-import');
end $$;

create or replace function chat_private.is_root(a uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from chat_private.root_account where id=a) $$;
create or replace function chat_private.rank(a uuid) returns int language sql stable security definer set search_path='' as $$
 select case when chat_private.is_root(a) then 100 when roles @> array['Owner'] then 80 when roles @> array['Super Administrator'] then 60 when roles @> array['Administrator'] then 40 when roles @> array['Moderator'] then 20 else 0 end from public.cb_profiles where id=a
$$;
create or replace function chat_private.restricted(a uuid, kinds text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cb_moderation where user_id=a and action=any(kinds) and revoked_at is null and (expires_at is null or expires_at>now()) and (action<>'warning' or acknowledged_at is null))
$$;
create or replace function public.cb_can(a uuid,c text,perm text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare ch public.cb_channels; r text[]; v boolean; begin
 if a is null or chat_private.restricted(a,array['ban','warning']) then return false; end if;
 select * into ch from public.cb_channels where id=c and not archived; if not found then return false; end if;
 select roles into r from public.cb_profiles where id=a; if not found then return false; end if;
 if ch.kind='dm' then return perm in ('view','send','attach') and exists(select 1 from public.cb_channel_members where channel_id=c and user_id=a); end if;
 if chat_private.is_root(a) then return true; end if;
 v:=case perm when 'view' then not ch.is_private or chat_private.rank(a)>=40 or ch.created_by=a or exists(select 1 from public.cb_channel_members where channel_id=c and user_id=a) when 'send' then (not ch.is_locked and ch.kind<>'announcement') or chat_private.rank(a)>=20 when 'attach' then true when 'manage' then ch.created_by=a or chat_private.rank(a)>=40 when 'mention_everyone' then chat_private.rank(a)>=20 else false end;
 select coalesce((select value from public.cb_overwrites where channel_id=c and subject='everyone' and permission=perm),v) into v;
 -- Roles combine allow over deny, then an individual override takes precedence.
 select coalesce((select bool_or(value) from public.cb_overwrites where channel_id=c and subject in(select 'role:'||unnest(r)) and permission=perm),v) into v;
 select coalesce((select value from public.cb_overwrites where channel_id=c and subject='user:'||a::text and permission=perm),v) into v;
 return v;
end $$;

create or replace function chat_private.rate(a uuid,b text,max_hits int,seconds int) returns void language plpgsql security definer set search_path='' as $$
declare n int; begin
 insert into chat_private.rate_limits values(a,b,now(),1) on conflict(actor,bucket) do update set
 hits=case when chat_private.rate_limits.started<now()-make_interval(secs=>seconds) then 1 else chat_private.rate_limits.hits+1 end,
 started=case when chat_private.rate_limits.started<now()-make_interval(secs=>seconds) then now() else chat_private.rate_limits.started end returning hits into n;
 if n>max_hits then raise exception 'Slow down and try again shortly.'; end if;
end $$;

create or replace function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c text:=p->>'channel_id'; target uuid; mid text; ch public.cb_channels; m public.cb_messages; r public.cb_automod;
 value text; body text; cleaned text; item text; hit boolean; token text; result jsonb; bot boolean; expires timestamptz; last_sent_at timestamptz; wait_seconds integer;
begin
 if a is null then raise exception 'Sign in to continue'; end if;
 select is_bot into bot from public.cb_profiles where id=a;
 if op='bootstrap' and not coalesce(bot,false) then
  insert into public.cb_profiles(id,username,display_name) select a,'user_'||replace(a::text,'-',''),coalesce(nullif(raw_user_meta_data->>'display_name',''),'New member') from auth.users where id=a on conflict(id) do nothing;
  return jsonb_build_object('profile',(select to_jsonb(x) from public.cb_profiles x where id=a),'root',chat_private.is_root(a));
 end if;
 if bot is null then raise exception 'Profile missing'; end if;
 if op='acknowledge' then
  update public.cb_moderation set acknowledged_at=now() where id=p->>'id' and user_id=a and action='warning';return '{}'::jsonb;
 end if;
 if chat_private.restricted(a,array['ban','warning']) then raise exception 'Your account has an active moderation notice'; end if;
 if op='channel_status' then
  if not public.cb_can(a,c,'view') then raise exception 'Channel unavailable';end if;
  select * into ch from public.cb_channels where id=c;
  select last_sent into last_sent_at from chat_private.slowmode where actor=a and channel_id=c;
  return jsonb_build_object('seconds',ch.slowmode_seconds,'bypass',public.cb_can(a,c,'manage'),'retry_after',greatest(0,ceil(extract(epoch from last_sent_at+make_interval(secs=>ch.slowmode_seconds)-clock_timestamp()))::integer));
 elsif op='read' then
  if not public.cb_can(a,c,'view') then raise exception 'Channel unavailable'; end if;
  insert into public.cb_reads values(a,c,now()) on conflict(user_id,channel_id) do update set read_at=now();return '{}'::jsonb;
 elsif op='profile' and not bot then
  value:=lower(trim(p->>'username'));
  if value!~'^[a-z0-9_.-]{2,32}$' then raise exception 'Username must be 2–32 letters, numbers, dots, underscores or hyphens'; end if;
  if (value='root' and not chat_private.is_root(a)) or (chat_private.is_root(a) and value<>'root') then raise exception 'The root username is reserved'; end if;
  if length(p->>'bio')>2000 or length(p->>'display_name')>64 or length(p->>'status')>160 then raise exception 'Profile field is too long'; end if;
  if coalesce(p->>'avatar_url','')<>'' and (p->>'avatar_url')!~'^https://' then raise exception 'Avatar must use HTTPS'; end if;
  update public.cb_profiles set username=value,display_name=coalesce(nullif(trim(p->>'display_name'),''),value),bio=coalesce(p->>'bio',''),pronouns=left(coalesce(p->>'pronouns',''),60),status=coalesce(p->>'status',''),avatar_url=nullif(p->>'avatar_url',''),banner_color=case when p->>'banner_color'~'^#[a-fA-F0-9]{6}$' then p->>'banner_color' else '#5865f2' end where id=a;
  return '{}'::jsonb;
 elsif op='role' and not bot then
  if not chat_private.is_root(a) then raise exception 'Only root can assign or remove roles'; end if;
  target:=(p->>'user_id')::uuid; value:=p->>'role';
  if value<>all(array['Owner','Super Administrator','Administrator','Moderator']) then raise exception 'Invalid role'; end if;
  if (select is_bot from public.cb_profiles where id=target) then raise exception 'Bots cannot hold staff roles'; end if;
  update public.cb_profiles set roles=case when (p->>'remove')::boolean then array_remove(roles,value) else array(select distinct unnest(roles||value)) end where id=target;
  return '{}'::jsonb;
 elsif op='dm' and not bot then
  target:=(p->>'user_id')::uuid; if target=a or not exists(select 1 from public.cb_profiles where id=target and not is_bot) then raise exception 'Choose another member'; end if;
  c:='dm-'||least(a::text,target::text)||'-'||greatest(a::text,target::text);
  insert into public.cb_channels(id,name,kind,is_private,created_by) values(c,'Direct message','dm',true,a) on conflict do nothing;
  insert into public.cb_channel_members values(c,a),(c,target) on conflict do nothing;return jsonb_build_object('id',c);
 elsif op in ('send','edit') then
  perform chat_private.rate(a,'message',30,60);
  if op='edit' then
   select * into m from public.cb_messages where id=p->>'id' and user_id=a and not deleted;
   if not found then raise exception 'You can only edit your own messages'; end if; c:=m.room;
  end if;
  if not public.cb_can(a,c,'view') or not public.cb_can(a,c,'send') or chat_private.restricted(a,array['timeout']) then raise exception 'You cannot send messages in this channel'; end if;
  select * into ch from public.cb_channels where id=c;
  if op='send' and ch.slowmode_seconds>0 and not public.cb_can(a,c,'manage') then
   -- Lock a separate row so concurrent requests and deleted messages cannot bypass the cooldown.
   insert into chat_private.slowmode(actor,channel_id) values(a,c) on conflict do nothing;
   select last_sent into last_sent_at from chat_private.slowmode where actor=a and channel_id=c for update;
   wait_seconds:=greatest(0,ceil(extract(epoch from last_sent_at+make_interval(secs=>ch.slowmode_seconds)-clock_timestamp()))::integer);
   if wait_seconds>0 then return jsonb_build_object('slowmode',true,'retry_after',wait_seconds,'message','Slowmode is enabled. Please wait before sending another message.');end if;
  end if;
  body:=trim(coalesce(p->>'text',''));
  if length(body)>20000 then raise exception 'Message exceeds 20,000 characters'; end if;
  if body='' and coalesce(p->>'image_url','')='' then raise exception 'Write a message or attach a file'; end if;
  if coalesce(p->>'image_url','')<>'' then
   if not public.cb_can(a,c,'attach') then raise exception 'Attachments are disabled for you'; end if;
   if (p->>'image_url') like 'cb-media:%' then
    if split_part(substr(p->>'image_url',10),'/',1)<>a::text or split_part(substr(p->>'image_url',10),'/',2)<>c then raise exception 'Attachment belongs to another user or channel';end if;
   elsif (p->>'image_url')!~'^https://' then raise exception 'Attachment must use HTTPS'; end if;
  end if;
  if body~'(^|\s)@(everyone|here)(\s|$)' and not public.cb_can(a,c,'mention_everyone') then raise exception 'You cannot mention everyone here'; end if;
  if p->>'reply_to' is not null and not exists(select 1 from public.cb_messages where id=p->>'reply_to' and room=c and not deleted) then raise exception 'Reply target is unavailable'; end if;
  for r in select * from public.cb_automod where enabled order by created_at,id loop
   if c=any(r.exempt_channels) or exists(select 1 from public.cb_profiles where id=a and roles&&r.exempt_roles) then continue; end if;
   cleaned:=lower(body); foreach item in array r.allowed_words loop
    if item<>'' then cleaned:=replace(cleaned,lower(item),''); end if;
   end loop;
   hit:=false;
   foreach item in array r.words loop if item<>'' and strpos(cleaned,lower(item))>0 then hit:=true;exit;end if;end loop;
   if not hit then foreach item in array r.patterns loop if item<>'' and cleaned~*item then hit:=true;exit;end if;end loop;end if;
   if hit then
    insert into public.cb_automod_events(user_id,room,rule_id,rule_name) values(a,c,r.id,r.name);
    return jsonb_build_object('blocked',true,'message',r.block_message,'rule',r.name);
   end if;
  end loop;
  if op='edit' then update public.cb_messages set text=body,edited_at=now() where id=m.id returning id into mid;
  else insert into public.cb_messages(room,user_id,text,image_url,attachment_name,attachment_bytes,reply_to) values(c,a,body,nullif(p->>'image_url',''),left(p->>'attachment_name',200),(p->>'attachment_bytes')::bigint,p->>'reply_to') returning id into mid;end if;
  if op='send' then
   insert into chat_private.slowmode(actor,channel_id,last_sent) values(a,c,clock_timestamp()) on conflict(actor,channel_id) do update set last_sent=excluded.last_sent;
  end if;
  return (select to_jsonb(x) from public.cb_messages x where id=mid);
 elsif op='delete_message' then
  select * into m from public.cb_messages where id=p->>'id';
  if not public.cb_can(a,m.room,'view') or (m.user_id<>a and chat_private.rank(a)<20) then raise exception 'Permission denied';end if;
  update public.cb_messages set deleted=true,text='',image_url=null where id=m.id;return '{}'::jsonb;
 elsif op='announcement' and not bot then
  if chat_private.rank(a)<40 then raise exception 'Administrator permission required';end if;
  if trim(coalesce(p->>'title',''))='' or trim(coalesce(p->>'body',''))='' then raise exception 'Enter a title and announcement';end if;
  insert into public.cb_announcements(id,title,body,created_by,is_pinned,pinned_at) values(coalesce(p->>'id',gen_random_uuid()::text),left(p->>'title',200),left(p->>'body',20000),a,coalesce((p->>'is_pinned')::boolean,false),case when (p->>'is_pinned')::boolean then now() end) on conflict(id) do update set title=excluded.title,body=excluded.body,is_pinned=excluded.is_pinned,pinned_at=excluded.pinned_at;
  return '{}'::jsonb;
 elsif op='category' and not bot then
  if chat_private.rank(a)<40 then raise exception 'Administrator permission required'; end if;
  if trim(coalesce(p->>'name',''))='' then raise exception 'Enter a category name'; end if;
  insert into public.cb_categories(id,name,sort_order) values(coalesce(p->>'id',gen_random_uuid()::text),left(p->>'name',80),coalesce((p->>'sort_order')::bigint,0)) on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order;return '{}'::jsonb;
 elsif op='channel' and not bot then
  if c is null then
   if chat_private.rank(a)<40 then raise exception 'Administrator permission required';end if;
   c:=gen_random_uuid()::text;
   insert into public.cb_channels(id,name,created_by) values(c,left(p->>'name',80),a);
  elsif not public.cb_can(a,c,'manage') then raise exception 'Manage channel permission required';end if;
  if exists(select 1 from public.cb_channels where id=c and kind='dm') then raise exception 'Direct messages cannot be edited as channels';end if;
  if trim(coalesce(p->>'name',''))='' then raise exception 'Enter a channel name';end if;
  if coalesce((p->>'slowmode_seconds')::integer,0) not between 0 and 21600 then raise exception 'Slowmode must be 0–21600 seconds';end if;
  update public.cb_channels set slowmode_seconds=coalesce((p->>'slowmode_seconds')::integer,0),name=left(p->>'name',80),topic=left(coalesce(p->>'topic',''),1000),category_id=nullif(p->>'category_id',''),kind=case when p->>'kind'='announcement' then 'announcement' else 'text' end,is_private=coalesce((p->>'is_private')::boolean,false),is_locked=coalesce((p->>'is_locked')::boolean,false),sort_order=nullif(p->>'sort_order','')::bigint where id=c;
  return jsonb_build_object('id',c);
 elsif op='archive_channel' and not bot then
  if not public.cb_can(a,c,'manage') or exists(select 1 from public.cb_channels where id=c and kind='dm') then raise exception 'Permission denied';end if;
  update public.cb_channels set archived=true where id=c;return '{}'::jsonb;
 elsif op='permission' and not bot then
  if not public.cb_can(a,c,'manage') or exists(select 1 from public.cb_channels where id=c and kind='dm') then raise exception 'Permission denied';end if;
  value:=p->>'subject';
  if value<>'everyone' and value!~'^user:[a-f0-9-]{36}$' and value<>all(array['role:Owner','role:Super Administrator','role:Administrator','role:Moderator']) then raise exception 'Invalid permission subject';end if;
  if p->>'value' is null then delete from public.cb_overwrites where channel_id=c and subject=p->>'subject' and permission=p->>'permission';
  else insert into public.cb_overwrites values(c,value,p->>'permission',(p->>'value')::boolean) on conflict(channel_id,subject,permission) do update set value=excluded.value;end if;
  return '{}'::jsonb;
 elsif op='moderate' and not bot then
  target:=(p->>'user_id')::uuid; value:=p->>'action';
  if chat_private.rank(a)<20 or target=a or coalesce(chat_private.rank(target),0)>=chat_private.rank(a) then raise exception 'You cannot moderate this member';end if;
  if value<>all(array['warning','ban','timeout','unban','untimeout']) then raise exception 'Invalid moderation action';end if;
  if trim(coalesce(p->>'reason',''))='' then raise exception 'A reason is required';end if;
  expires:=(nullif(p->>'expires_at',''))::timestamptz;
  if value='timeout' and expires is null then raise exception 'Timeout requires an expiry';end if;
  if expires is not null and expires<=now() then raise exception 'Expiry must be in the future';end if;
  if value in ('unban','untimeout') then update public.cb_moderation set revoked_at=now() where user_id=target and action=case value when 'unban' then 'ban' else 'timeout' end and revoked_at is null;end if;
  insert into public.cb_moderation(user_id,action,reason,note,evidence,created_by,expires_at) values(target,value,left(p->>'reason',1000),left(coalesce(p->>'note',''),4000),left(coalesce(p->>'evidence',''),4000),a,expires);return '{}'::jsonb;
 elsif op='automod' and not bot then
  if chat_private.rank(a)<40 then raise exception 'Administrator permission required';end if;
  if trim(coalesce(p->>'name',''))='' then raise exception 'Enter a rule name';end if;
  for item in select jsonb_array_elements_text(coalesce(p->'patterns','[]')) loop perform ''~item;end loop;
  insert into public.cb_automod(id,name,enabled,words,patterns,allowed_words,block_message,exempt_channels,exempt_roles,created_by)
  values(coalesce(p->>'id',gen_random_uuid()::text),p->>'name',coalesce((p->>'enabled')::boolean,true),array(select jsonb_array_elements_text(coalesce(p->'words','[]'))),array(select jsonb_array_elements_text(coalesce(p->'patterns','[]'))),array(select jsonb_array_elements_text(coalesce(p->'allowed_words','[]'))),coalesce(nullif(p->>'block_message',''),'This content is blocked by this server.'),array(select jsonb_array_elements_text(coalesce(p->'exempt_channels','[]'))),array(select jsonb_array_elements_text(coalesce(p->'exempt_roles','[]'))),a)
  on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,words=excluded.words,patterns=excluded.patterns,allowed_words=excluded.allowed_words,block_message=excluded.block_message,exempt_channels=excluded.exempt_channels,exempt_roles=excluded.exempt_roles;return '{}'::jsonb;
 elsif op='delete_rule' and not bot then
  if chat_private.rank(a)<40 then raise exception 'Administrator permission required';end if;
  delete from public.cb_automod where id=p->>'id';return '{}'::jsonb;
 elsif op='create_bot' and not bot then
  if chat_private.rank(a)<40 then raise exception 'Administrator permission required';end if;
  target:=gen_random_uuid();token:='cb_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.cb_profiles(id,username,display_name,is_bot) values(target,'bot_'||replace(target::text,'-',''),left(coalesce(nullif(p->>'name',''),'My bot'),64),true);
  insert into public.cb_bots(id,owner_id,token_hash) values(target,a,encode(sha256(convert_to(token,'UTF8')),'hex'));
  return jsonb_build_object('id',target,'token',token);
 elsif op in ('revoke_bot','rotate_bot') and not bot then
  target:=(p->>'id')::uuid;
  if not exists(select 1 from public.cb_bots where id=target and (owner_id=a or chat_private.is_root(a))) then raise exception 'You do not own this bot';end if;
  if op='revoke_bot' then update public.cb_bots set enabled=false where id=target;return '{}'::jsonb;end if;
  token:='cb_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');update public.cb_bots set token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'),enabled=true where id=target;return jsonb_build_object('token',token);
 elsif op='invite_rate' and not bot then
  perform chat_private.rate(a,'invite',5,3600);return '{}'::jsonb;
 elsif op='api_rate' then
  perform chat_private.rate(a,'api',60,60);return '{}'::jsonb;
 end if;
 raise exception 'Unknown or unauthorized action';
end $$;

create or replace function public.chat_action(action text,payload jsonb default '{}') returns jsonb language sql security definer set search_path='' set statement_timeout='8s' as $$ select chat_private.dispatch(auth.uid(),action,payload) $$;
create or replace function public.chat_bot(action text,token text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare a uuid; result jsonb; begin
 select id into a from public.cb_bots where enabled and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 if a is null then raise exception 'Invalid bot token';end if;
 perform chat_private.rate(a,'api',60,60);
 if chat_private.restricted(a,array['ban','warning']) then raise exception 'Bot is restricted';end if;
 if action='me' then return (select to_jsonb(p) from public.cb_profiles p where id=a);
 elsif action='channels' then return coalesce((select jsonb_agg(c) from public.cb_channels c where public.cb_can(a,c.id,'view')),'[]');
 elsif action='messages' then
  if not public.cb_can(a,payload->>'channel_id','view') then raise exception 'Channel unavailable';end if;
  select coalesce(jsonb_agg(x),'[]') into result from (select * from public.cb_messages where room=payload->>'channel_id' and (created_at,id)>(coalesce((payload->>'after')::timestamptz,'epoch'::timestamptz),coalesce(payload->>'after_id','')) order by created_at,id limit 100) x;return result;
 elsif action in ('send','edit','delete_message') then return chat_private.dispatch(a,action,payload);
 end if;
 raise exception 'Unknown bot action';
end $$;

create or replace function public.chat_mentions() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(room,n),'{}') from (
 select m.room,count(*) n from public.cb_messages m left join public.cb_reads r on r.channel_id=m.room and r.user_id=auth.uid()
 where m.user_id<>auth.uid() and not m.deleted and m.created_at>coalesce(r.read_at,'epoch') and public.cb_can(auth.uid(),m.room,'view')
 and (strpos(m.text,'<@'||auth.uid()::text||'>')>0 or m.text~'(^|\s)@(everyone|here)(\s|$)' or exists(select 1 from public.cb_channels c where c.id=m.room and c.kind='dm')) group by m.room
 ) x
$$;

-- RLS covers every read. Clients never write tables directly; RPCs enforce permissions.
do $$ declare t text; begin
 foreach t in array array['cb_announcements','cb_profiles','cb_categories','cb_channels','cb_channel_members','cb_overwrites','cb_messages','cb_reads','cb_moderation','cb_automod','cb_automod_events','cb_bots'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
revoke select on public.cb_bots from authenticated;
grant select(id,owner_id,enabled,created_at) on public.cb_bots to authenticated;
create policy cb_announcements_read on public.cb_announcements for select to authenticated using (not chat_private.restricted(auth.uid(),array['ban','warning']));
create policy cb_profiles_read on public.cb_profiles for select to authenticated using (id=auth.uid() or not chat_private.restricted(auth.uid(),array['ban','warning']));
create policy cb_categories_read on public.cb_categories for select to authenticated using (not chat_private.restricted(auth.uid(),array['ban','warning']));
create policy cb_channels_read on public.cb_channels for select to authenticated using (public.cb_can(auth.uid(),id,'view'));
create policy cb_members_read on public.cb_channel_members for select to authenticated using (public.cb_can(auth.uid(),channel_id,'view'));
create policy cb_overwrites_read on public.cb_overwrites for select to authenticated using (public.cb_can(auth.uid(),channel_id,'manage'));
create policy cb_messages_read on public.cb_messages for select to authenticated using (public.cb_can(auth.uid(),room,'view'));
create policy cb_reads_read on public.cb_reads for select to authenticated using (user_id=auth.uid());
create policy cb_moderation_read on public.cb_moderation for select to authenticated using (user_id=auth.uid() or chat_private.rank(auth.uid())>=20);
create policy cb_automod_read on public.cb_automod for select to authenticated using (chat_private.rank(auth.uid())>=40);
create policy cb_events_read on public.cb_automod_events for select to authenticated using (chat_private.rank(auth.uid())>=20);
create policy cb_bots_read on public.cb_bots for select to authenticated using (owner_id=auth.uid() or chat_private.is_root(auth.uid()));
-- Helpers are callable only where needed for RLS, with no mutation privileges.
grant usage on schema chat_private to authenticated;
revoke all on all tables in schema chat_private from public,anon,authenticated;
revoke all on all functions in schema chat_private from public,anon,authenticated;
grant execute on function chat_private.restricted(uuid,text[]),chat_private.rank(uuid),chat_private.is_root(uuid) to authenticated;
revoke all on function public.chat_action(text,jsonb),public.chat_bot(text,text,jsonb),public.chat_mentions(),public.cb_can(uuid,text,text) from public,anon,authenticated;
grant execute on function public.chat_action(text,jsonb),public.chat_mentions(),public.cb_can(uuid,text,text) to authenticated;
grant execute on function public.chat_bot(text,text,jsonb) to service_role;

-- Events contain no message bodies; all subscribed data is still filtered by RLS.
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['cb_announcements','cb_messages','cb_profiles','cb_channels','cb_categories','cb_channel_members','cb_overwrites','cb_moderation','cb_automod','cb_reads'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
  end loop;
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
