begin;
alter table public.cb_profiles add column nickname text check(length(nickname) between 1 and 64);
alter table public.cb_categories add column deleted_at timestamptz;
create function chat_private.keyword_pattern(keyword text) returns text language plpgsql immutable set search_path='' as $$
declare result text:=''; ch text; i integer;
begin
 for i in 1..length(keyword) loop
  ch:=substr(keyword,i,1);
  if ch='*' then result:=result||'[^[:space:]]*';
  elsif strpos(E'\\.^$+?()[]{}|',ch)>0 then result:=result||E'\\'||ch;
  else result:=result||ch;end if;
 end loop;
 return case when left(keyword,1)='*' then '' else '(^|[^[:alnum:]_])' end||result||case when right(keyword,1)='*' then '' else '($|[^[:alnum:]_])' end;
end $$;
revoke all on function chat_private.keyword_pattern(text) from public,anon,authenticated;
do $$
declare source text; old_match text:='strpos(cleaned,lower(item))>0'; old_allow text:='replace(cleaned,lower(item),'''')';
begin
 source:=pg_get_functiondef('chat_private.dispatch_core(uuid,text,jsonb)'::regprocedure);
 if strpos(source,old_match)=0 or strpos(source,old_allow)=0 then raise exception 'Keyword matcher version mismatch';end if;
 source:=replace(source,old_match,'cleaned~*chat_private.keyword_pattern(item)');
 source:=replace(source,old_allow,'regexp_replace(cleaned,chat_private.keyword_pattern(item),'' '',''gi'')');
 execute source;
end $$;
alter function chat_private.dispatch(uuid,text,jsonb) rename to dispatch_sdk;
create function chat_private.dispatch(a uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; value text; key text;
begin
 if a is null then raise exception 'Sign in to continue';end if;
 if op in ('nickname','delete_category') then
  if chat_private.restricted(a,array['ban','warning','timeout']) or exists(select 1 from public.cb_profiles where id=a and is_bot) then raise exception 'Permission denied';end if;
  if op='nickname' then
   target:=(p->>'user_id')::uuid;value:=nullif(trim(p->>'nickname'),'');
   if chat_private.rank(a)<20 or (target<>a and coalesce(chat_private.rank(target),100)>=chat_private.rank(a)) then raise exception 'You cannot change this member nickname';end if;
   if length(value)>64 then raise exception 'Nickname must be 64 characters or fewer';end if;
   update public.cb_profiles set nickname=value where id=target;
   if not found then raise exception 'Member unavailable';end if;
  else
   if chat_private.rank(a)<40 then raise exception 'Administrator permission required';end if;
   update public.cb_categories set deleted_at=now() where id=p->>'id';
   update public.cb_channels set category_id=null where category_id=p->>'id';
  end if;return '{}'::jsonb;
 elsif op='automod' then
  -- Split plain phrases at commas/newlines; leave regex patterns untouched.
  foreach key in array array['words','allowed_words'] loop
   if p ? key then p:=jsonb_set(p,array[key],coalesce((select jsonb_agg(phrase) from (select distinct trim(part) phrase from jsonb_array_elements_text(p->key) entry cross join lateral regexp_split_to_table(entry,E'[,\n\r]+') part where trim(part)<>'') x),'[]'::jsonb));end if;
  end loop;
 end if;
 return chat_private.dispatch_sdk(a,op,p);
end $$;
revoke all on function chat_private.dispatch(uuid,text,jsonb),chat_private.dispatch_sdk(uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.chat_action(action text,payload jsonb default '{}') returns jsonb language sql security definer set search_path='' set statement_timeout='8s' as $$select chat_private.dispatch(auth.uid(),action,payload)$$;
notify pgrst,'reload schema';
commit;
