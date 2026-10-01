-- Read-only checks after applying both migrations.
select 'root accounts' as check_name, count(*) as value from chat_private.root_account
union all select 'original channels',count(*) from public.channels
union all select 'new non-DM channels',count(*) from public.cb_channels where kind <> 'dm'
union all select 'original messages',count(*) from public.messages
union all select 'new messages',count(*) from public.cb_messages
union all select 'original announcements',count(*) from public.announcements
union all select 'new announcements',count(*) from public.cb_announcements;

select c.id as missing_channel from public.channels c
where not exists(select 1 from public.cb_channels n where n.id=c.id::text);
select m.id as missing_message from public.messages m
where not exists(select 1 from public.cb_messages n where n.id=m.id::text);
select c.id as altered_channel from public.channels c join public.cb_channels n on n.id=c.id::text
where c.name is distinct from n.name or c.sort_order is distinct from n.sort_order
or c.is_private is distinct from n.is_private or c.is_locked is distinct from n.is_locked;
select id,public,file_size_limit from storage.buckets where id='chatbox-private';
select proname,proconfig from pg_proc where proname in ('chat_action','chat_bot');
