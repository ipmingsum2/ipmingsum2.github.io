-- Emergency access rollback only. Do not run as a normal migration.
-- Stop v2 writes and review/reconcile any new cb_* data before returning to the
-- legacy frontend. This restores saved grants without deleting either dataset.
begin;
do $$ declare r record;target text;begin
 for r in select * from chat_private.legacy_acl loop
  target:=case when r.grantee='PUBLIC' then 'PUBLIC' else quote_ident(r.grantee) end;
  execute format('grant %s on public.%I to %s%s',r.privilege_type,r.table_name,target,case when r.is_grantable='YES' then ' with grant option' else '' end);
 end loop;
end $$;
commit;
