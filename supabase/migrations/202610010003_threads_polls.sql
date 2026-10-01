-- Additive upgrade. Existing channels and messages retain their identities.
begin;
alter table public.cb_channels add column if not exists parent_id text references public.cb_channels;
alter table public.cb_channels add column if not exists starter_message_id text references public.cb_messages;
alter table public.cb_channels drop constraint if exists cb_channels_kind_check;
alter table public.cb_channels add constraint cb_channels_kind_check check(kind in ('text','announcement','dm','thread'));
alter table public.cb_channels add constraint cb_thread_parent_check check((kind='thread')=(parent_id is not null));
alter table public.cb_messages add column if not exists thread_id text references public.cb_channels;
alter table public.cb_messages add column if not exists poll_id text;
create index if not exists cb_channels_parent on public.cb_channels(parent_id);
create table public.cb_polls (
 id text primary key default gen_random_uuid()::text,
 message_id text unique not null references public.cb_messages,
 room text not null references public.cb_channels,
 created_by uuid not null references public.cb_profiles,
 question text not null check(length(question) between 1 and 300),
 options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 10),
 multiple boolean not null default false,
 ends_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table public.cb_messages add constraint cb_message_poll_fk foreign key(poll_id) references public.cb_polls;
create table public.cb_poll_votes (
 poll_id text references public.cb_polls on delete cascade,
 user_id uuid references public.cb_profiles,
 choices text[] not null,
 primary key(poll_id,user_id)
);

-- Thread permissions follow the parent dynamically, including later revocations.
-- Archived threads remain readable; sending requires reopening the thread.
create or replace function public.cb_can(a uuid,c text,perm text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare ch public.cb_channels; r text[]; v boolean; begin
 if a is null or chat_private.restricted(a,array['ban','warning']) then return false; end if;
 select * into ch from public.cb_channels where id=c; if not found then return false; end if;
 select roles into r from public.cb_profiles where id=a; if not found then return false; end if;
 if ch.kind='thread' then
  if perm in ('send','attach') and ch.archived then return false;end if;
  return public.cb_can(a,ch.parent_id,perm);
 end if;
 if ch.archived then return false;end if;
 if ch.kind='dm' then return perm in ('view','send','attach') and exists(select 1 from public.cb_channel_members where channel_id=c and user_id=a); end if;
 if chat_private.is_root(a) then return true; end if;
 v:=case perm when 'view' then not ch.is_private or chat_private.rank(a)>=40 or ch.created_by=a or exists(select 1 from public.cb_channel_members where channel_id=c and user_id=a) when 'send' then (not ch.is_locked and ch.kind<>'announcement') or chat_private.rank(a)>=20 when 'attach' then true when 'manage' then ch.created_by=a or chat_private.rank(a)>=40 when 'mention_everyone' then chat_private.rank(a)>=20 else false end;
 select coalesce((select value from public.cb_overwrites where channel_id=c and subject='everyone' and permission=perm),v) into v;
 select coalesce((select bool_or(value) from public.cb_overwrites where channel_id=c and subject in(select 'role:'||unnest(r)) and permission=perm),v) into v;
 select coalesce((select value from public.cb_overwrites where channel_id=c and subject='user:'||a::text and permission=perm),v) into v;
 return v;
end $$;

create or replace function chat_private.social(a uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c text:=p->>'channel_id'; ch public.cb_channels; t public.cb_channels; poll public.cb_polls;
 result jsonb; opts jsonb:='[]'; item jsonb; title text; txt text; mid text; tid text; pid text;
 ids text[]; selected text[]; duration numeric; idx int; total int;
begin
 if a is null or not exists(select 1 from public.cb_profiles where id=a and not is_bot) then raise exception 'Sign in with a member account';end if;
 if chat_private.restricted(a,array['ban','warning']) then raise exception 'Your account has an active moderation notice';end if;
 if op='threads' then
  if not public.cb_can(a,c,'view') then raise exception 'Channel unavailable';end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
   select threadrow.*, (select count(*) from public.cb_messages where room=threadrow.id and not deleted) as message_count,
   (select max(created_at) from public.cb_messages where room=threadrow.id and not deleted) as last_message_at
   from public.cb_channels threadrow where threadrow.parent_id=c and public.cb_can(a,threadrow.id,'view')
  ) x),'[]'::jsonb);
 elsif op='create_thread' then
  select * into ch from public.cb_channels where id=c and kind in ('text','announcement') and not archived;
  if not found or not public.cb_can(a,c,'view') or not public.cb_can(a,c,'send') then raise exception 'You cannot create a thread here';end if;
  title:=trim(coalesce(p->>'name',''));
  if length(title) not between 1 and 100 then raise exception 'Thread name must be 1–100 characters';end if;
  if p->>'reply_to' is not null and not exists(select 1 from public.cb_messages where id=p->>'reply_to' and room=c and not deleted) then raise exception 'Thread source is unavailable';end if;
  result:=chat_private.dispatch(a,'send',jsonb_build_object('channel_id',c,'text',title,'reply_to',p->>'reply_to'));
  if result ? 'blocked' or result ? 'slowmode' then return result;end if;
  mid:=result->>'id';tid:=gen_random_uuid()::text;
  insert into public.cb_channels(id,name,kind,parent_id,starter_message_id,created_by,slowmode_seconds)
   values(tid,title,'thread',c,mid,a,ch.slowmode_seconds);
  update public.cb_messages set thread_id=tid where id=mid;
  return jsonb_build_object('id',tid,'parent_id',c);
 elsif op='archive_thread' then
  select * into t from public.cb_channels where id=p->>'id' and kind='thread' for update;
  if not found or not public.cb_can(a,t.id,'view') or (t.created_by<>a and not public.cb_can(a,t.id,'manage')) then raise exception 'You cannot manage this thread';end if;
  if chat_private.restricted(a,array['timeout']) then raise exception 'Your account is timed out';end if;
  update public.cb_channels set archived=coalesce((p->>'archived')::boolean,true) where id=t.id;
  return '{}'::jsonb;
 elsif op='create_poll' then
  if not public.cb_can(a,c,'view') or not public.cb_can(a,c,'send') then raise exception 'You cannot create a poll here';end if;
  title:=trim(coalesce(p->>'question',''));
  if length(title) not between 1 and 300 then raise exception 'Question must be 1–300 characters';end if;
  if jsonb_typeof(p->'answers') is distinct from 'array' then raise exception 'Add at least two answers';end if;
  if jsonb_array_length(p->'answers') not between 2 and 10 then raise exception 'Use 2–10 answers';end if;
  txt:=title;
  for item in select * from jsonb_array_elements(p->'answers') loop
   if length(trim(coalesce(item->>'text',''))) not between 1 and 100 then raise exception 'Answers must be 1–100 characters';end if;
   opts:=opts||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'text',trim(item->>'text'),'emoji',left(coalesce(item->>'emoji',''),12)));
   txt:=txt||E'\n'||coalesce(item->>'emoji','')||' '||trim(item->>'text');
  end loop;
  duration:=coalesce((p->>'duration_hours')::numeric,24);
  if duration not between 0.5 and 168 then raise exception 'Duration must be 30 minutes to 7 days';end if;
  result:=chat_private.dispatch(a,'send',jsonb_build_object('channel_id',c,'text',txt));
  if result ? 'blocked' or result ? 'slowmode' then return result;end if;
  mid:=result->>'id';pid:=gen_random_uuid()::text;
  insert into public.cb_polls(id,message_id,room,created_by,question,options,multiple,ends_at)
   values(pid,mid,c,a,title,opts,coalesce((p->>'multiple')::boolean,false),clock_timestamp()+make_interval(secs=>(duration*3600)::int));
  update public.cb_messages set poll_id=pid where id=mid;
  return jsonb_build_object('id',pid,'message_id',mid);
 elsif op in ('vote','close_poll') then
  select * into poll from public.cb_polls where id=p->>'id' for update;
  if not found or not public.cb_can(a,poll.room,'view') or not exists(select 1 from public.cb_messages where id=poll.message_id and not deleted) then raise exception 'Poll unavailable';end if;
  if op='close_poll' then
   if poll.created_by<>a and not public.cb_can(a,poll.room,'manage') then raise exception 'You cannot close this poll';end if;
   if chat_private.restricted(a,array['timeout']) then raise exception 'Your account is timed out';end if;
   update public.cb_polls set ends_at=least(ends_at,clock_timestamp()),updated_at=clock_timestamp() where id=poll.id;
   return '{}'::jsonb;
  end if;
  if not public.cb_can(a,poll.room,'send') or chat_private.restricted(a,array['timeout']) then raise exception 'You cannot vote here';end if;
  if poll.ends_at<=clock_timestamp() then raise exception 'This poll has ended';end if;
  perform chat_private.rate(a,'poll-vote',60,60);
  if jsonb_typeof(p->'choices') is distinct from 'array' then raise exception 'Choose an answer';end if;
  selected:=array(select distinct jsonb_array_elements_text(p->'choices'));
  ids:=array(select value->>'id' from jsonb_array_elements(poll.options));
  if not selected<@ids or (not poll.multiple and cardinality(selected)>1) then raise exception 'Invalid answer selection';end if;
  if cardinality(selected)=0 then delete from public.cb_poll_votes where poll_id=poll.id and user_id=a;
  else insert into public.cb_poll_votes values(poll.id,a,selected) on conflict(poll_id,user_id) do update set choices=excluded.choices;end if;
  update public.cb_polls set updated_at=clock_timestamp() where id=poll.id;
  return '{}'::jsonb;
 elsif op='poll_data' then
  if not public.cb_can(a,c,'view') then raise exception 'Channel unavailable';end if;
  result:='[]'::jsonb;
  for poll in select q.* from public.cb_polls q join public.cb_messages m on m.id=q.message_id
   where q.room=c and not m.deleted and q.id in(select jsonb_array_elements_text(coalesce(p->'ids','[]'))) loop
   select count(*) into total from public.cb_poll_votes where poll_id=poll.id;
   opts:='[]';
   for item in select * from jsonb_array_elements(poll.options) loop
    opts:=opts||jsonb_build_array(item||jsonb_build_object('votes',(select count(*) from public.cb_poll_votes where poll_id=poll.id and choices@>array[item->>'id'])));
   end loop;
   result:=result||jsonb_build_array(jsonb_build_object('id',poll.id,'question',poll.question,'options',opts,'multiple',poll.multiple,'ends_at',poll.ends_at,'ended',poll.ends_at<=clock_timestamp(),'created_by',poll.created_by,'total',total,'mine',coalesce((select to_jsonb(choices) from public.cb_poll_votes where poll_id=poll.id and user_id=a),'[]'::jsonb)));
  end loop;
  return result;
 end if;
 raise exception 'Unknown action';
end $$;
create or replace function public.chat_social(action text,payload jsonb default '{}') returns jsonb language sql security definer set search_path='' set statement_timeout='8s' as $$select chat_private.social(auth.uid(),action,payload)$$;
revoke all on function chat_private.social(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.chat_social(text,jsonb) from public,anon,authenticated;
grant execute on function public.chat_social(text,jsonb) to authenticated;
alter table public.cb_polls enable row level security;
alter table public.cb_poll_votes enable row level security;
revoke all on public.cb_polls,public.cb_poll_votes from public,anon,authenticated;
grant select on public.cb_polls,public.cb_poll_votes to authenticated;
create policy cb_polls_read on public.cb_polls for select to authenticated using(public.cb_can(auth.uid(),room,'view') and exists(select 1 from public.cb_messages where id=message_id and not deleted));
create policy cb_votes_read on public.cb_poll_votes for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.cb_polls where id=poll_id));
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.cb_polls;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
