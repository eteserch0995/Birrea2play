-- ─────────────────────────────────────────────────────────────────────────────
-- pending_recargas: Yappy wallet recharges awaiting admin approval
-- Amount tiers are hardcoded in the app; amounts sent directly (no portal links needed).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pending_recargas (
  id              bigserial     primary key,
  user_id         uuid          not null references public.users(id) on delete cascade,
  tier_label      text,                                  -- display label, e.g. "Promo $20 → $25"
  amount_paid     numeric(10,2) not null check (amount_paid > 0),
  amount_credito  numeric(10,2) not null check (amount_credito > 0),
  status          text          not null default 'pending'
                                check (status in ('pending', 'approved', 'rejected')),
  notas           text,
  approved_by     uuid          references public.users(id),
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists pending_recargas_user_id_idx on public.pending_recargas (user_id);
create index if not exists pending_recargas_status_idx  on public.pending_recargas (status);
create index if not exists pending_recargas_created_idx on public.pending_recargas (created_at);

alter table public.pending_recargas enable row level security;

create policy "Users read own pending recargas"
  on public.pending_recargas for select
  using (
    user_id = (select id from public.users where auth_id = auth.uid() limit 1)
  );

create policy "Admin all pending recargas"
  on public.pending_recargas for all
  using (
    exists (
      select 1 from public.users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- cash_payment_requests: 4-hour window for event cash payments
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.cash_payment_requests (
  id             bigserial     primary key,
  user_id        uuid          not null references public.users(id) on delete cascade,
  event_id       uuid          not null,
  amount         numeric(10,2) not null check (amount > 0),
  status         text          not null default 'pending'
                               check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at     timestamptz   not null default (now() + interval '4 hours'),
  gestor_id      uuid          references public.users(id),
  notas          text,
  created_at     timestamptz   not null default now()
);

create index if not exists cash_req_event_status_idx on public.cash_payment_requests (event_id, status);
create index if not exists cash_req_user_idx         on public.cash_payment_requests (user_id);
create index if not exists cash_req_expires_idx      on public.cash_payment_requests (status, expires_at);

alter table public.cash_payment_requests enable row level security;

create policy "Users read own cash requests"
  on public.cash_payment_requests for select
  using (
    user_id = (select id from public.users where auth_id = auth.uid() limit 1)
  );

create policy "Gestors manage cash requests for their events"
  on public.cash_payment_requests for all
  using (
    exists (
      select 1 from public.users u
      join public.events e on e.id = cash_payment_requests.event_id
      where u.auth_id = auth.uid()
        and u.role in ('admin', 'gestor')
        and (e.created_by = u.id or u.role = 'admin')
    )
  );

-- Expire stale cash payment requests — call via Edge Function cron
create or replace function public.expire_cash_payments()
returns int
language plpgsql security definer as $$
declare
  expired_count int;
begin
  update public.cash_payment_requests
  set status = 'expired'
  where status = 'pending' and expires_at < now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;
