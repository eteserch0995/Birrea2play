-- ============================================================
-- 2026-06-18 — Referidos: disparar al confirmar inscripción
-- ============================================================
-- Cambia el punto de crédito: ya no esperamos que el evento
-- termine. Los $1 se acreditan cuando el invitado se inscribe
-- y paga en su primer evento (status → 'confirmed').
-- ============================================================

-- ── 1) Eliminar trigger anterior (basado en events.status) ──
drop trigger if exists trg_referral_credits_on_event_finish on public.events;
drop function if exists public._trfn_referral_credits_on_event_finish();

-- ── 2) Nueva función de trigger ─────────────────────────────
create or replace function public._trfn_referral_credits_on_reg_confirm()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_referrer_id     uuid;
  v_referrer_wallet uuid;
  v_referred_wallet uuid;
  v_monthly_count   int;
  v_rows            int;
  v_referred_nom    text;
  v_referrer_nom    text;
begin
  -- Solo cuando la inscripción pasa a 'confirmed' (insert directo o update)
  if not (coalesce(old.status, '') <> 'confirmed' and new.status = 'confirmed') then
    return new;
  end if;

  -- Solo eventos pagados cuentan
  if coalesce(new.metodo_pago, '') = 'gratis' then
    return new;
  end if;

  -- ¿Este usuario fue invitado por alguien?
  select u.referred_by into v_referrer_id
    from public.users u where u.id = new.user_id;
  if v_referrer_id is null then return new; end if;

  -- Cap mensual del referidor (máx 5 créditos/mes)
  select count(*) into v_monthly_count
    from public.referral_credits
    where referrer_id = v_referrer_id
      and created_at >= date_trunc('month', now());
  if v_monthly_count >= 5 then return new; end if;

  -- Insertar registro (UNIQUE garantiza idempotencia: 1 bono por par ever)
  insert into public.referral_credits
    (referrer_id, referred_id, event_registration_id, event_id, amount)
  values
    (v_referrer_id, new.user_id, new.id, new.event_id, 1.00)
  on conflict (referrer_id, referred_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return new; end if;  -- ya se acreditó en una inscripción anterior

  -- ── Acreditar $1 al referidor ──
  select w.id into v_referrer_wallet from public.wallets w where w.user_id = v_referrer_id;
  if v_referrer_wallet is not null then
    select nombre into v_referred_nom from public.users where id = new.user_id;
    update public.wallets set balance = balance + 1.00 where id = v_referrer_wallet;
    insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
      values (v_referrer_wallet, 'bono_referido', 1.00,
              'Bono referido: ' || coalesce(split_part(v_referred_nom, ' ', 1), 'tu amigo/a')
              || ' se inscribió en su primer evento');
  end if;

  -- ── Acreditar $1 al referido ──
  update public.referral_credits
    set referred_wallet_credited = true
    where referrer_id = v_referrer_id and referred_id = new.user_id;

  select w.id into v_referred_wallet from public.wallets w where w.user_id = new.user_id;
  if v_referred_wallet is not null then
    select nombre into v_referrer_nom from public.users where id = v_referrer_id;
    update public.wallets set balance = balance + 1.00 where id = v_referred_wallet;
    insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
      values (v_referred_wallet, 'bono_referido', 1.00,
              '¡Bienvenido/a! Primer evento inscripto con código de '
              || coalesce(split_part(v_referrer_nom, ' ', 1), 'tu amigo/a') || ' 🎉');
  end if;

  return new;
end; $$;

revoke execute on function public._trfn_referral_credits_on_reg_confirm()
  from public, anon, authenticated;

-- ── 3) Registrar trigger en event_registrations ─────────────
drop trigger if exists trg_referral_credits_on_reg_confirm on public.event_registrations;
create trigger trg_referral_credits_on_reg_confirm
  after insert or update on public.event_registrations
  for each row execute function public._trfn_referral_credits_on_reg_confirm();
