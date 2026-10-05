begin;
alter table public.cb_messages add column components jsonb not null default '[]';
alter table public.cb_bots drop constraint cb_bots_scopes_check;
alter table public.cb_bots add constraint cb_bots_scopes_check check(scopes <@ array['moderate','manage_messages','automod','manage_channels','manage_members']::text[]);
create table chat_private.bot_commands(bot_id uuid references public.cb_bots(id),name text,description text not null,primary key(bot_id,name));
create table chat_private.bot_interactions(
 id uuid primary key default gen_random_uuid(),bot_id uuid not null references public.cb_bots(id),user_id uuid not null references public.cb_profiles(id),
 channel_id text not null references public.cb_channels(id),message_id text references public.cb_messages(id),kind text not null,custom_id text not null,
 fields jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 response jsonb,responded_at timestamptz,delivered_at timestamptz,parent_id uuid unique references chat_private.bot_interactions(id)
);
revoke all on chat_private.bot_commands,chat_private.bot_interactions from public,anon,authenticated;
alter table chat_private.bot_jobs alter column message_id drop not null;
alter table chat_private.bot_jobs add column interaction_id uuid unique references chat_private.bot_interactions(id);
alter table chat_private.bot_jobs add constraint bot_job_event_check check(num_nonnulls(message_id,interaction_id)=1);

create function chat_private.validate_modal(m jsonb) returns void language plpgsql set search_path='' as $$
declare f jsonb;ids text[]:='{}';begin
 if jsonb_typeof(m) is distinct from 'object' or length(trim(coalesce(m->>'title',''))) not between 1 and 100 or length(coalesce(m->>'custom_id','')) not between 1 and 100 or jsonb_typeof(m->'fields') is distinct from 'array' then raise exception 'Invalid modal';end if;
 if jsonb_array_length(m->'fields') not between 1 and 5 then raise exception 'Use 1–5 form fields';end if;
 for f in select value from jsonb_array_elements(m->'fields') loop
  if jsonb_typeof(f) is distinct from 'object' or coalesce(f->>'custom_id','')!~'^[a-zA-Z0-9_-]{1,100}$' or f->>'custom_id'=any(ids) or length(trim(coalesce(f->>'label',''))) not between 1 and 100 or length(coalesce(f->>'placeholder',''))>200 or coalesce(f->>'style','1') not in ('1','2') or coalesce((f->>'max_length')::int,1000) not between 1 and 4000 then raise exception 'Invalid or duplicate form field';end if;
  ids:=array_append(ids,f->>'custom_id');
 end loop;
end $$;
create function chat_private.validate_components(items jsonb) returns text language plpgsql set search_path='' as $$
declare row jsonb;b jsonb;ids text[]:='{}';body text:='';begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>5 then raise exception 'Use up to 5 component rows';end if;
 for row in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(row->'components') is distinct from 'array' or jsonb_array_length(row->'components') not between 1 and 5 then raise exception 'Use 1–5 buttons per row';end if;
  for b in select value from jsonb_array_elements(row->'components') loop
   if coalesce(b->>'type','2')<>'2' or length(trim(coalesce(b->>'label',''))) not between 1 and 80 or coalesce(b->>'style','1') not in ('1','2','3','4','5') then raise exception 'Invalid button';end if;
   if b->>'style'='5' then
    if coalesce(b->>'url','')!~'^https://[^[:space:]]+$' or length(b->>'url')>2048 then raise exception 'Link buttons require HTTPS';end if;
   elsif length(coalesce(b->>'custom_id','')) not between 1 and 100 or b->>'custom_id'=any(ids) then raise exception 'Use a unique button custom ID';end if;
   ids:=array_append(ids,b->>'custom_id');body:=body||E'\n'||(b->>'label');
  end loop;
 end loop;return body;
end $$;
revoke all on function chat_private.validate_modal(jsonb),chat_private.validate_components(jsonb) from public,anon,authenticated;

-- Keep ordinary member behavior, while extending the root-only bot scope editor.
alter function chat_private.dispatch(uuid,text,jsonb) rename to dispatch_before_interactions;
create function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope_list text[];r jsonb;begin
 if op='bot_scopes' then
  if a is null or not chat_private.is_root(a) or chat_private.restricted(a,array['ban','warning','timeout']) then raise exception 'Only root can grant bot permissions';end if;
  scope_list:=array(select distinct jsonb_array_elements_text(coalesce(p->'scopes','[]')));
  if not scope_list <@ array['moderate','manage_messages','automod','manage_channels','manage_members']::text[] then raise exception 'Invalid bot permission';end if;
  update public.cb_bots set scopes=scope_list where id=(p->>'id')::uuid;return '{}';
 end if;
 r:=chat_private.dispatch_before_interactions(a,op,p);
 if op='delete_message' then update public.cb_messages set components='[]' where id=p->>'id' and deleted;end if;
 return r;
end $$;
revoke all on function chat_private.dispatch(uuid,text,jsonb),chat_private.dispatch_before_interactions(uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.chat_action(action text,payload jsonb default '{}') returns jsonb language sql security definer set search_path='' set statement_timeout='8s' as $$select chat_private.dispatch(auth.uid(),action,payload)$$;

-- A separate social dispatcher preserves all channel, AutoMod and slowmode checks for bots.
do $$declare src text;begin
 src:=pg_get_functiondef('chat_private.social(uuid,text,jsonb)'::regprocedure);
 if strpos(src,'and not is_bot')=0 then raise exception 'Social version mismatch';end if;
 src:=replace(src,'FUNCTION chat_private.social(','FUNCTION chat_private.bot_social(');
 src:=replace(src,'and not is_bot','');execute src;
end $$;
revoke all on function chat_private.bot_social(uuid,text,jsonb) from public,anon,authenticated;

alter function chat_private.bot_dispatch(uuid,text,jsonb) rename to bot_dispatch_before_interactions;
create function chat_private.bot_dispatch(actor uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.cb_bots;c text:=payload->>'channel_id';r jsonb;items jsonb;body text; original text; i chat_private.bot_interactions;d jsonb;f jsonb;ch public.cb_channels;begin
 select * into b from public.cb_bots where id=actor and enabled;
 if b.id is null or chat_private.restricted(actor,array['ban','warning']) or chat_private.restricted(b.owner_id,array['ban','warning','timeout']) then raise exception 'Bot is restricted or revoked';end if;
 if action in ('send','edit') then
  items:=coalesce(payload->'components',case when action='edit' then (select components from public.cb_messages where id=payload->>'id' and user_id=actor) end,'[]');
  original:=coalesce(payload->>'text',case when action='edit' then (select text from public.cb_messages where id=payload->>'id' and user_id=actor) end,'');
  body:=chat_private.validate_components(items);
  r:=chat_private.bot_dispatch_before_interactions(actor,action,payload||jsonb_build_object('text',original||body));
  if r ? 'id' then update public.cb_messages set text=original,components=items where id=r->>'id';return(select to_jsonb(m) from public.cb_messages m where id=r->>'id');end if;return r;
 elsif action='delete_message' then
  r:=chat_private.bot_dispatch_before_interactions(actor,action,payload);update public.cb_messages set components='[]' where id=payload->>'id' and deleted;return r;
 elsif action not in ('commands_set','commands','interactions','interaction_reply','profile','members','roles','categories','category','delete_category','channel','archive_channel','permission','nickname','standing','threads','create_thread','archive_thread','create_poll','vote','close_poll','poll_data','announcement') then
  return chat_private.bot_dispatch_before_interactions(actor,action,payload);
 end if;
 perform chat_private.rate(actor,'api',60,60);
 if action in ('commands','commands_set') then
  if action='commands_set' then
   if chat_private.restricted(actor,array['timeout']) then raise exception 'Bot is timed out';end if;
   items:=payload->'commands';if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>100 then raise exception 'Use up to 100 commands';end if;
   for d in select value from jsonb_array_elements(items) loop
    if coalesce(d->>'name','')!~'^[a-z0-9_-]{1,32}$' or length(trim(coalesce(d->>'description',''))) not between 1 and 100 then raise exception 'Commands need a name and description';end if;
   end loop;
   delete from chat_private.bot_commands where bot_id=actor;
   insert into chat_private.bot_commands select actor,value->>'name',value->>'description' from jsonb_array_elements(items);
  end if;
  return coalesce((select jsonb_agg(x) from chat_private.bot_commands x where bot_id=actor),'[]');
 elsif action='interactions' then
  if exists(select 1 from chat_private.bot_programs where bot_id=actor and enabled) then return '[]';end if;
  with picked as (select id from chat_private.bot_interactions where bot_id=actor and delivered_at is null and expires_at>now() and public.cb_can(actor,channel_id,'view') and public.cb_can(user_id,channel_id,'view') and not chat_private.restricted(user_id,array['ban','warning','timeout']) order by created_at for update skip locked limit 25), claimed as(update chat_private.bot_interactions x set delivered_at=now() from picked where x.id=picked.id returning x.*)
  select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('user',(select to_jsonb(p) from public.cb_profiles p where p.id=x.user_id))),'[]') into r from claimed x;return r;
 elsif action='interaction_reply' then
  select * into i from chat_private.bot_interactions where id=(payload->>'id')::uuid and bot_id=actor and expires_at>now() for update;
  if i.id is null or i.responded_at is not null then raise exception 'Interaction unavailable or already answered';end if;
  if not public.cb_can(actor,i.channel_id,'send') or not public.cb_can(i.user_id,i.channel_id,'view') or chat_private.restricted(actor,array['timeout']) then raise exception 'Interaction permission denied';end if;
  if payload ? 'modal' then
   perform chat_private.validate_modal(payload->'modal');r:=jsonb_build_object('type','modal','modal',payload->'modal');
  elsif coalesce((payload->>'ephemeral')::boolean,false) then
   if length(coalesce(payload->>'text',''))>20000 then raise exception 'Reply too long';end if;
   perform chat_private.validate_embeds(coalesce(payload->'embeds','[]'));
   r:=jsonb_build_object('type','message','text',coalesce(payload->>'text',''),'embeds',coalesce(payload->'embeds','[]'),'ephemeral',true);
  else
   r:=chat_private.bot_dispatch(actor,'send',(payload-'id')||jsonb_build_object('channel_id',i.channel_id));
   if r ? 'blocked' or r ? 'slowmode' then return r;end if;
   r:=jsonb_build_object('type','sent','message_id',r->>'id');
  end if;
  update chat_private.bot_interactions set response=r,responded_at=now() where id=i.id;return r;
 elsif action in ('threads','create_thread','archive_thread','create_poll','vote','close_poll','poll_data') then return chat_private.bot_social(actor,action,payload);
 elsif action='members' then return coalesce((select jsonb_agg(p) from public.cb_profiles p),'[]');
 elsif action='roles' then return '["Owner","Super Administrator","Administrator","Moderator"]';
 elsif action='categories' then return coalesce((select jsonb_agg(x) from public.cb_categories x where deleted_at is null),'[]');
 elsif action='profile' then
  if chat_private.restricted(actor,array['timeout']) then raise exception 'Bot is timed out';end if;
  if length(coalesce(payload->>'display_name',''))>64 or length(coalesce(payload->>'bio',''))>2000 or length(coalesce(payload->>'status',''))>160 or (payload ? 'avatar_url' and coalesce(payload->>'avatar_url','')<>'' and payload->>'avatar_url'!~'^https://') then raise exception 'Invalid profile';end if;
  update public.cb_profiles set display_name=coalesce(nullif(trim(payload->>'display_name'),''),display_name),bio=coalesce(payload->>'bio',bio),status=coalesce(payload->>'status',status),avatar_url=case when payload ? 'avatar_url' then nullif(payload->>'avatar_url','') else avatar_url end,banner_color=case when payload->>'banner_color'~'^#[a-fA-F0-9]{6}$' then payload->>'banner_color' else banner_color end where id=actor;
  return(select to_jsonb(p) from public.cb_profiles p where id=actor);
 elsif action in ('nickname','standing') then
  if not (case when action='nickname' then 'manage_members' else 'moderate' end)=any(b.scopes) or coalesce(chat_private.rank(b.owner_id),0)<20 or chat_private.restricted(actor,array['timeout']) then raise exception 'Bot member management permission required';end if;
  if action='standing' then return coalesce((select jsonb_agg(h) from public.cb_moderation h where user_id=(payload->>'user_id')::uuid),'[]');end if;
  return chat_private.dispatch(b.owner_id,action,payload);
 else
  if not 'manage_channels'=any(b.scopes) or coalesce(chat_private.rank(b.owner_id),0)<40 or chat_private.restricted(actor,array['timeout']) then raise exception 'Bot channel management permission required';end if;
  if c is not null and (not public.cb_can(actor,c,'view') or not public.cb_can(actor,c,'manage')) then raise exception 'Manage channel permission required';end if;
  if action='channel' and c is not null then
   select * into ch from public.cb_channels where id=c;
   payload:=to_jsonb(ch)||payload;
  end if;
  r:=chat_private.dispatch(b.owner_id,action,payload);
  if action='channel' and c is null and r ? 'id' then
   update public.cb_channels set created_by=actor where id=r->>'id';insert into public.cb_channel_members(channel_id,user_id) values(r->>'id',actor) on conflict do nothing;
  end if;return r;
 end if;
end $$;
revoke all on function chat_private.bot_dispatch(uuid,text,jsonb),chat_private.bot_dispatch_before_interactions(uuid,text,jsonb) from public,anon,authenticated;

create function public.chat_interact(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare a uuid:=auth.uid();m public.cb_messages;i chat_private.bot_interactions;parent chat_private.bot_interactions;btn jsonb;f jsonb;v text;bid uuid;c text;cid text;k text;values_json jsonb:='{}';begin
 if a is null or chat_private.restricted(a,array['ban','warning','timeout']) then raise exception 'You cannot interact while restricted';end if;
 if action='commands' then
  c:=payload->>'channel_id';if not public.cb_can(a,c,'view') then raise exception 'Channel unavailable';end if;
  return coalesce((select jsonb_agg(x) from (select cmd.* from chat_private.bot_commands cmd join public.cb_bots b on b.id=cmd.bot_id where b.enabled and public.cb_can(b.id,c,'view') and public.cb_can(b.id,c,'send'))x),'[]');
 elsif action='status' then
  select * into i from chat_private.bot_interactions where id=(payload->>'id')::uuid and user_id=a;
  if i.id is null or not public.cb_can(a,i.channel_id,'view') then raise exception 'Interaction unavailable';end if;
  return jsonb_build_object('id',i.id,'bot_id',i.bot_id,'response',i.response,'expired',i.expires_at<now());
 end if;
 perform chat_private.rate(a,'interaction',12,60);
 if action='button' then
  select * into m from public.cb_messages where id=payload->>'message_id' and not deleted;
  if m.id is null then raise exception 'Message unavailable';end if;
  select x into btn from jsonb_array_elements(m.components) r cross join lateral jsonb_array_elements(r->'components') x where x->>'custom_id'=payload->>'custom_id' and x->>'style'<>'5' and not coalesce((x->>'disabled')::boolean,false);
  if btn is null then raise exception 'Button unavailable';end if;bid:=m.user_id;c:=m.room;cid:=btn->>'custom_id';k:='button';
 elsif action='command' then
  bid:=(payload->>'bot_id')::uuid;c:=payload->>'channel_id';cid:=payload->>'name';k:='command';
  if not exists(select 1 from chat_private.bot_commands where bot_id=bid and name=cid) then raise exception 'Command unavailable';end if;
  values_json:=jsonb_build_object('input',left(coalesce(payload->>'input',''),2000));
 elsif action='submit' then
  select * into parent from chat_private.bot_interactions where id=(payload->>'id')::uuid and user_id=a and expires_at>now() and response->>'type'='modal' for update;
  if parent.id is null or exists(select 1 from chat_private.bot_interactions where parent_id=parent.id) then raise exception 'Form expired or already submitted';end if;
  for f in select value from jsonb_array_elements(parent.response#>'{modal,fields}') loop
   v:=coalesce(payload#>>array['fields',f->>'custom_id'],'');
   if (coalesce((f->>'required')::boolean,true) and trim(v)='') or length(v)>coalesce((f->>'max_length')::int,1000) then raise exception 'Please complete all required fields within their limits';end if;
   values_json:=values_json||jsonb_build_object(f->>'custom_id',v);
  end loop;bid:=parent.bot_id;c:=parent.channel_id;cid:=parent.response#>>'{modal,custom_id}';k:='modal';
 else raise exception 'Unknown interaction';end if;
 if not public.cb_can(a,c,'view') or not public.cb_can(a,c,'send') or not public.cb_can(bid,c,'view') or not exists(select 1 from public.cb_bots where id=bid and enabled) then raise exception 'Interaction permission denied';end if;
 insert into chat_private.bot_interactions(bot_id,user_id,channel_id,message_id,kind,custom_id,fields,parent_id) values(bid,a,c,m.id,k,cid,values_json,parent.id) returning * into i;
 return jsonb_build_object('id',i.id,'bot_id',i.bot_id);
end $$;
revoke all on function public.chat_interact(text,jsonb) from public,anon;
grant execute on function public.chat_interact(text,jsonb) to authenticated;

create function chat_private.enqueue_interaction() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into chat_private.bot_jobs(bot_id,interaction_id,revision) select p.bot_id,new.id,p.revision from chat_private.bot_programs p where p.bot_id=new.bot_id and p.enabled on conflict do nothing;return new;
end $$;
create trigger cb_hosted_interaction after insert on chat_private.bot_interactions for each row execute function chat_private.enqueue_interaction();
revoke all on function chat_private.enqueue_interaction() from public,anon,authenticated;
create or replace function public.chat_hosted_claim(runner_secret text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare j chat_private.bot_jobs;result jsonb:='[]';event jsonb;src text;begin
 if not exists(select 1 from chat_private.bot_runner_config where secret=runner_secret) then raise exception 'Invalid runner authorization';end if;
 update chat_private.bot_jobs set status='failed',error='Execution interrupted; not replayed to avoid duplicate actions',finished_at=now() where status='running' and started_at<now()-interval '2 minutes';
 for j in select * from chat_private.bot_jobs where status='pending' order by id for update skip locked limit 3 loop
  select p.source into src from chat_private.bot_programs p join public.cb_bots b on b.id=p.bot_id where p.bot_id=j.bot_id and p.enabled and b.enabled and p.revision=j.revision and not chat_private.restricted(b.owner_id,array['ban','warning','timeout']);
  event:=null;
  if src is not null then
   if j.interaction_id is not null then
    select jsonb_build_object('interaction',to_jsonb(i)||jsonb_build_object('user',(select to_jsonb(p) from public.cb_profiles p where p.id=i.user_id))) into event from chat_private.bot_interactions i where id=j.interaction_id and expires_at>now() and public.cb_can(j.bot_id,i.channel_id,'view') and public.cb_can(i.user_id,i.channel_id,'view') and not chat_private.restricted(i.user_id,array['ban','warning','timeout']);
   else select jsonb_build_object('message',to_jsonb(m)||jsonb_build_object('author',(select to_jsonb(p) from public.cb_profiles p where p.id=m.user_id))) into event from public.cb_messages m where id=j.message_id and not deleted and public.cb_can(j.bot_id,m.room,'view');end if;
  end if;
  if event is null then update chat_private.bot_jobs set status='cancelled',finished_at=now() where id=j.id;continue;end if;
  event:=event||jsonb_build_object('bot',(select to_jsonb(p) from public.cb_profiles p where p.id=j.bot_id));
  update chat_private.bot_jobs set status='running',lease=gen_random_uuid(),started_at=now() where id=j.id returning * into j;
  result:=result||jsonb_build_array(jsonb_build_object('id',j.id,'lease',j.lease,'source',src,'event',event));
 end loop;return result;
end $$;
-- Let owners register commands in Studio without exposing the bot token.
alter function public.chat_hosted(text,jsonb) rename to chat_hosted_before_interactions;
revoke all on function public.chat_hosted_before_interactions(text,jsonb) from public,anon,authenticated;
create function public.chat_hosted(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare a uuid:=auth.uid();b public.cb_bots;begin
 if action not in ('commands','commands_set') then return public.chat_hosted_before_interactions(action,payload);end if;
 select * into b from public.cb_bots where id=(payload->>'bot_id')::uuid;
 if a is null or b.id is null or (a<>b.owner_id and not chat_private.is_root(a)) or chat_private.restricted(a,array['ban','warning','timeout']) then raise exception 'Bot owner permission required';end if;
 return chat_private.bot_dispatch(b.id,action,payload);
end $$;
revoke all on function public.chat_hosted(text,jsonb) from public,anon;
grant execute on function public.chat_hosted(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
