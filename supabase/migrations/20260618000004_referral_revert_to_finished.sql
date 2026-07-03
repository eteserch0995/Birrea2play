-- ============================================================
-- 2026-06-18 — Referidos: volver a acreditar al finalizar evento
-- ============================================================
-- El crédito se otorga cuando el evento pasa a status='finished',
-- no al inscribirse. Esto evita que alguien se inscriba, cobre
-- los $1 y luego se retire antes del evento.
-- ============================================================

-- ── 1) Eliminar trigger en event_registrations ───────────────
drop trigger if exists trg_referral_credits_on_reg_confirm on public.event_registrations;
drop function if exists public._trfn_referral_credits_on_reg_confirm();

-- ── 2) Restaurar trigger en events ──────────────────────────
create or replace function public._trfn_referral_credits_on_event_finish()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_reg             record;
  v_referrer_id     uuid;
  v_referrer_wallet uuid;
  v_referred_wallet uuid;
  v_monthly_count   int;
  v_rows            int;
  v_referred_nom    text;
  v_referrer_nom    text;
begin
  -- Solo en la transición NOT finished → finished
  if not (coalesce(old.status, '') <> 'finished' and new.status = 'finished') then
    return new;
  end if;

  -- Para cada inscripción confirmada y pagada en este evento
  for v_reg in
    select er.user_id, er.id as reg_id
    from public.event_registrations er
    where er.event_id   = new.id
      and er.status     = 'confirmed'
      and er.metodo_pago <> 'gratis'
  loop
    -- ¿Este usuario fue invitado?
    select u.referred_by into v_referrer_id
      from public.users u where u.id = v_reg.user_id;
    continue when v_referrer_id is null;

    -- Cap mensual del referidor (máx 5/mes)
    select count(*) into v_monthly_count
      from public.referral_credits
      where referrer_id = v_referrer_id
        and created_at >= date_trunc('month', now());
    continue when v_monthly_count >= 5;

    -- Insertar (UNIQUE garantiza 1 bono por par ever)
    insert into public.referral_credits
      (referrer_id, referred_id, event_registration_id, event_id, amount)
    values
      (v_referrer_id, v_reg.user_id, v_reg.reg_id, new.id, 1.00)
    on conflict (referrer_id, referred_id) do nothing;
    get diagnostics v_rows = row_count;
    continue when v_rows = 0;

    -- ── Acreditar $1 al referidor ──
    select w.id into v_referrer_wallet from public.wallets w where w.user_id = v_referrer_id;
    if v_referrer_wallet is not null then
      select nombre into v_referred_nom from public.users where id = v_reg.user_id;
      update public.wallets set balance = balance + 1.00 where id = v_referrer_wallet;
      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_referrer_wallet, 'bono_referido', 1.00,
                'Bono referido: ' || coalesce(split_part(v_referred_nom, ' ', 1), 'tu amigo/a')
                || ' completó un evento');
    end if;

    -- ── Acreditar $1 al referido (primera vez que completa un evento) ──
    update public.referral_credits
      set referred_wallet_credited = true
      where referrer_id = v_referrer_id and referred_id = v_reg.user_id;

    select w.id into v_referred_wallet from public.wallets w where w.user_id = v_reg.user_id;
    if v_referred_wallet is not null then
      select nombre into v_referrer_nom from public.users where id = v_referrer_id;
      update public.wallets set balance = balance + 1.00 where id = v_referred_wallet;
      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_referred_wallet, 'bono_referido', 1.00,
                '¡Completaste tu primer evento! Crédito de invitación de '
                || coalesce(split_part(v_referrer_nom, ' ', 1), 'tu amigo/a') || ' 🎉');
    end if;

  end loop;

  return new;
end; $$;

revoke execute on function public._trfn_referral_credits_on_event_finish()
  from public, anon, authenticated;

drop trigger if exists trg_referral_credits_on_event_finish on public.events;
create trigger trg_referral_credits_on_event_finish
  after update on public.events
  for each row execute function public._trfn_referral_credits_on_event_finish();
