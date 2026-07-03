-- ============================================================
-- 2026-06-22 — Rifa de aniversario Birrea2Play
-- ============================================================

create table if not exists public.raffle_entries (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.users(id) on delete cascade not null,
  raffle_code text not null,
  created_at  timestamptz default now(),
  unique (user_id, raffle_code)
);

alter table public.raffle_entries enable row level security;

create policy "select own raffle"
  on public.raffle_entries for select
  using (user_id = (select id from public.users where auth_id = auth.uid()));

-- RPC: debita $1 y registra participación (idempotente)
create or replace function public.enter_anniversary_raffle()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_balance  numeric;
begin
  select id, wallet_balance into v_user_id, v_balance
  from public.users
  where auth_id = auth.uid();

  if v_user_id is null then
    return '{"error":"unauthorized"}'::jsonb;
  end if;

  if exists (
    select 1 from public.raffle_entries
    where user_id = v_user_id and raffle_code = 'aniversario_2026'
  ) then
    return '{"already_entered":true}'::jsonb;
  end if;

  if coalesce(v_balance, 0) < 1 then
    return '{"error":"insufficient_funds"}'::jsonb;
  end if;

  update public.users
    set wallet_balance = wallet_balance - 1
  where id = v_user_id;

  insert into public.raffle_entries (user_id, raffle_code)
  values (v_user_id, 'aniversario_2026');

  return '{"entered":true}'::jsonb;
end;
$$;

revoke execute on function public.enter_anniversary_raffle() from public;
grant  execute on function public.enter_anniversary_raffle() to authenticated;

-- Vista para admin: ver todos los participantes
create or replace view public.v_raffle_aniversario as
  select
    re.id,
    re.created_at,
    u.nombre,
    u.correo,
    u.telefono
  from public.raffle_entries re
  join public.users u on u.id = re.user_id
  where re.raffle_code = 'aniversario_2026'
  order by re.created_at;
