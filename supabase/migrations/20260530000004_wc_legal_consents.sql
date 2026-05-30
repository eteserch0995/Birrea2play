-- ============================================================
-- 2026-05-30 — Modulo Mundial 2026: auditoria de consentimiento legal
-- ============================================================
-- Registro defendible de la aceptacion de los Terminos del Mundial ANTES de
-- inscribirse. Tabla append-only + RPC SECURITY DEFINER con caller validation
-- ([[feedback-rls-security-definer-caller-check]]).
--
-- El cliente NO inserta directo: llama al RPC wc_record_consent, que valida
-- caller = p_user_id y sella accepted_at server-side. RLS deja SELECT a
-- (propio user | admin) y NO expone INSERT/UPDATE/DELETE a authenticated, asi
-- que las filas son inmutables desde la app (valor probatorio).
-- Aplicada a prod via apply_migration (name=wc_legal_consents).
-- ------------------------------------------------------------

create table if not exists public.wc_legal_consents (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.users(id) on delete cascade,
  doc           text not null default 'mundial_tyc',
  version       text not null,
  mode          text check (mode is null or mode in ('survivor','polla')),
  enrollment_id uuid references public.wc_enrollments(id) on delete set null,
  accepted_at   timestamptz not null default now(),
  user_agent    text,
  source        text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_wc_legal_consents_user on public.wc_legal_consents(user_id);
create index if not exists idx_wc_legal_consents_doc  on public.wc_legal_consents(doc, version);
create index if not exists idx_wc_legal_consents_user_doc_time
  on public.wc_legal_consents(user_id, doc, accepted_at desc);

alter table public.wc_legal_consents enable row level security;
drop policy if exists "WC legal_consents: select own or admin" on public.wc_legal_consents;
create policy "WC legal_consents: select own or admin" on public.wc_legal_consents for select
  to authenticated
  using (
    user_id = (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

create or replace function public.wc_record_consent(
  p_user_id uuid, p_doc text, p_version text, p_mode text default null,
  p_enrollment_id uuid default null, p_user_agent text default null, p_source text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_consent_id uuid;
begin
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id'; end if;
  end if;
  if coalesce(p_doc,'') = '' then raise exception 'doc requerido'; end if;
  if coalesce(p_version,'') = '' then raise exception 'version requerida'; end if;
  if p_mode is not null and p_mode not in ('survivor','polla') then raise exception 'modo invalido: %', p_mode; end if;
  if p_enrollment_id is not null and not exists (
       select 1 from public.wc_enrollments where id = p_enrollment_id and user_id = p_user_id) then
    raise exception 'enrollment no pertenece a p_user_id'; end if;
  insert into public.wc_legal_consents (user_id, doc, version, mode, enrollment_id, user_agent, source)
  values (p_user_id, p_doc, p_version, p_mode, p_enrollment_id, nullif(p_user_agent,''), nullif(p_source,''))
  returning id into v_consent_id;
  return v_consent_id;
end; $$;

revoke execute on function public.wc_record_consent(uuid, text, text, text, uuid, text, text) from public, anon;
grant execute on function public.wc_record_consent(uuid, text, text, text, uuid, text, text) to authenticated, service_role;
