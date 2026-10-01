-- New uploads are private. Original public chat-media files remain in place.
begin;
insert into storage.buckets(id,name,public,file_size_limit)
values('chatbox-private','chatbox-private',false,12582912) on conflict(id) do update set public=false,file_size_limit=12582912;
create policy cb_private_upload on storage.objects for insert to authenticated
with check(bucket_id='chatbox-private'
 and (storage.foldername(name))[1]=auth.uid()::text
 and public.cb_can(auth.uid(),(storage.foldername(name))[2],'view')
 and public.cb_can(auth.uid(),(storage.foldername(name))[2],'send')
 and public.cb_can(auth.uid(),(storage.foldername(name))[2],'attach')
 and not chat_private.restricted(auth.uid(),array['timeout']));
create policy cb_private_download on storage.objects for select to authenticated
using(bucket_id='chatbox-private' and public.cb_can(auth.uid(),(storage.foldername(name))[2],'view'));
-- A restrictive guard prevents future broad storage policies from exposing this bucket.
create policy cb_private_guard on storage.objects as restrictive for select to public
using(bucket_id<>'chatbox-private' or (auth.uid() is not null and public.cb_can(auth.uid(),(storage.foldername(name))[2],'view')));
commit;
