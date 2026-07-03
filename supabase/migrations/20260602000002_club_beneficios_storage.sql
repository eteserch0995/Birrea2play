-- Bucket publico para logos de empresas + fotos de productos del Club
insert into storage.buckets (id, name, public)
values ('partner-logos', 'partner-logos', true)
on conflict (id) do nothing;

drop policy if exists "partner_logos_read"   on storage.objects;
drop policy if exists "partner_logos_insert" on storage.objects;
drop policy if exists "partner_logos_update" on storage.objects;
drop policy if exists "partner_logos_delete" on storage.objects;

create policy "partner_logos_read" on storage.objects
  for select to public using (bucket_id = 'partner-logos');
create policy "partner_logos_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'partner-logos');
create policy "partner_logos_update" on storage.objects
  for update to authenticated using (bucket_id = 'partner-logos');
create policy "partner_logos_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'partner-logos');
