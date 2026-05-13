-- Channel-aware chat RLS policies for external/chat.html.
-- Run this file in the Supabase SQL editor after creating the chat tables.
--
-- Why this exists:
--   A policy on channel_members that queries channel_members directly can recurse
--   when messages/channels policies check private-channel membership, producing:
--   "infinite recursion detected in policy for relation \"channel_members\"".
--   These helpers are SECURITY DEFINER functions, so policy checks can answer
--   membership/role questions without recursively invoking channel_members RLS.

begin;

create or replace function public.chat_is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = check_user_id
      and p.role = 'admin'
  );
$$;

create or replace function public.chat_channel_creator(check_channel_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.created_by
  from public.channels c
  where c.id = check_channel_id
$$;

create or replace function public.chat_is_channel_member(check_channel_id text, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channel_members cm
    where cm.channel_id = check_channel_id
      and cm.user_id = check_user_id
  );
$$;

create or replace function public.chat_can_manage_channel(check_channel_id text, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_is_admin(check_user_id)
      or public.chat_channel_creator(check_channel_id) = check_user_id
$$;

create or replace function public.chat_can_enter_channel(check_channel_id text, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    where c.id = check_channel_id
      and (
        coalesce(c.is_private, false) = false
        or public.chat_is_admin(check_user_id)
        or c.created_by = check_user_id
        or public.chat_is_channel_member(c.id, check_user_id)
      )
  );
$$;

create or replace function public.chat_can_talk_in_channel(check_channel_id text, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    where c.id = check_channel_id
      and public.chat_can_enter_channel(c.id, check_user_id)
      and (
        coalesce(c.is_locked, false) = false
        or public.chat_is_admin(check_user_id)
        or c.created_by = check_user_id
        or exists (
          select 1
          from public.channel_lock_bypass clb
          where clb.channel_id = c.id
            and clb.user_id = check_user_id
        )
      )
  );
$$;

-- Keep helper execution available to browser sessions; SECURITY DEFINER keeps the
-- underlying reads from re-entering the table policies.
grant execute on function public.chat_is_admin(uuid) to authenticated;
grant execute on function public.chat_channel_creator(text) to authenticated;
grant execute on function public.chat_is_channel_member(text, uuid) to authenticated;
grant execute on function public.chat_can_manage_channel(text, uuid) to authenticated;
grant execute on function public.chat_can_enter_channel(text, uuid) to authenticated;
grant execute on function public.chat_can_talk_in_channel(text, uuid) to authenticated;

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.channel_lock_bypass enable row level security;
alter table public.messages enable row level security;

-- Replace old recursive policies. If you keep custom policy names, rerun this
-- block to clear them before recreating the non-recursive set below.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('channels', 'channel_members', 'channel_lock_bypass', 'messages')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

create policy "channels_select_visible"
on public.channels
for select
to authenticated
using (public.chat_can_enter_channel(id, auth.uid()));

create policy "channels_insert_own"
on public.channels
for insert
to authenticated
with check (created_by = auth.uid());

create policy "channels_update_manager"
on public.channels
for update
to authenticated
using (public.chat_can_manage_channel(id, auth.uid()))
with check (public.chat_can_manage_channel(id, auth.uid()));

create policy "channels_delete_manager"
on public.channels
for delete
to authenticated
using (public.chat_can_manage_channel(id, auth.uid()));

create policy "channel_members_select_relevant"
on public.channel_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.chat_can_manage_channel(channel_id, auth.uid())
);

create policy "channel_members_insert_manager"
on public.channel_members
for insert
to authenticated
with check (public.chat_can_manage_channel(channel_id, auth.uid()));

create policy "channel_members_delete_manager_or_self"
on public.channel_members
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.chat_can_manage_channel(channel_id, auth.uid())
);

create policy "channel_lock_bypass_select_relevant"
on public.channel_lock_bypass
for select
to authenticated
using (
  user_id = auth.uid()
  or public.chat_can_manage_channel(channel_id, auth.uid())
);

create policy "channel_lock_bypass_insert_manager"
on public.channel_lock_bypass
for insert
to authenticated
with check (public.chat_can_manage_channel(channel_id, auth.uid()));

create policy "channel_lock_bypass_delete_manager_or_self"
on public.channel_lock_bypass
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.chat_can_manage_channel(channel_id, auth.uid())
);

create policy "messages_select_channel_visible"
on public.messages
for select
to authenticated
using (public.chat_can_enter_channel(room, auth.uid()));

create policy "messages_insert_channel_talkable"
on public.messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.chat_can_talk_in_channel(room, auth.uid())
);

create policy "messages_update_owner_or_admin"
on public.messages
for update
to authenticated
using (user_id = auth.uid() or public.chat_is_admin(auth.uid()))
with check (user_id = auth.uid() or public.chat_is_admin(auth.uid()));

create policy "messages_delete_owner_or_admin"
on public.messages
for delete
to authenticated
using (user_id = auth.uid() or public.chat_is_admin(auth.uid()));

commit;
