-- Referidos del Mundial 2026 — Parte 2: RPCs (codigo + descuento) y trigger del bono $3.

-- ── 1) wc_create_pending_enrollment: acepta codigo de referido (3er param opcional) ──
--     Cambia la firma (uuid,text) -> (uuid,text,text) => hay que DROP + CREATE + re-grant.
drop function if exists public.wc_create_pending_enrollment(uuid, text);

create or replace function public.wc_create_pending_enrollment(p_user_id uuid, p_mode text, p_referral_code text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_enrollment_id uuid;
  v_price         numeric;
  v_pool          public.wc_pools%rowtype;
  v_code          text := nullif(upper(btrim(coalesce(p_referral_code,''))), '');
  v_ref_id        uuid;
  v_discount      numeric := 0;
  v_already_ref   boolean;
  v_existing      public.wc_enrollments%rowtype;
begin
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  if p_mode not in ('survivor','polla') then raise exception 'modo inválido: %', p_mode; end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if not found then raise exception 'Pool del Mundial 2026 no configurado'; end if;
  if v_pool.enrollment_deadline <= now() then
    raise exception 'Inscripciones cerradas (deadline: %)', v_pool.enrollment_deadline;
  end if;
  if (p_mode = 'survivor' and not v_pool.survivor_open)
     or (p_mode = 'polla' and not v_pool.polla_open) then
    raise exception 'Modo % no está abierto a inscripciones', p_mode;
  end if;

  v_price := case when p_mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end;

  -- ¿El usuario ya uso un codigo en alguna inscripcion? (descuento 1 vez por amigo)
  select exists(
    select 1 from public.wc_enrollments where user_id = p_user_id and referred_by is not null
  ) into v_already_ref;

  -- Validar y resolver el codigo de referido (solo si llega y aun no uso ninguno)
  if v_code is not null and not v_already_ref then
    select id into v_ref_id from public.users where referral_code = v_code;
    if v_ref_id is null then raise exception 'Código de invitación inválido'; end if;
    if v_ref_id = p_user_id then raise exception 'No puedes usar tu propio código'; end if;
    if not exists (select 1 from public.wc_enrollments where user_id = v_ref_id and payment_status = 'paid') then
      raise exception 'Ese código aún no está activo (quien te invitó no está inscrito en el Mundial)';
    end if;
    v_discount := 2;
  end if;

  -- Idempotencia: inscripcion existente (user, mode)
  select * into v_existing from public.wc_enrollments where user_id = p_user_id and mode = p_mode;
  if found then
    -- Si esta pendiente, sin referido aun, y ahora llega un codigo valido -> aplicarlo
    if v_existing.payment_status <> 'paid' and v_existing.referred_by is null and v_ref_id is not null then
      update public.wc_enrollments
        set referred_by = v_ref_id, referral_discount = v_discount,
            paid_amount = greatest(v_price - v_discount, 0)
        where id = v_existing.id;
    end if;
    return v_existing.id;
  end if;

  insert into public.wc_enrollments
    (user_id, mode, paid_amount, payment_method, payment_status, lives_remaining, referred_by, referral_discount)
    values (p_user_id, p_mode, greatest(v_price - v_discount, 0), 'wallet', 'pending',
            case when p_mode = 'survivor' then 3 else 0 end, v_ref_id, v_discount)
    returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$function$;
revoke execute on function public.wc_create_pending_enrollment(uuid, text, text) from public, anon;
grant execute on function public.wc_create_pending_enrollment(uuid, text, text) to authenticated, service_role;

-- ── 2) wc_pay_enrollment_wallet: cobra (precio - descuento) ──
create or replace function public.wc_pay_enrollment_wallet(p_user_id uuid, p_enrollment_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_price      numeric;
  v_charge     numeric;
  v_wallet_id  uuid;
  v_balance    numeric;
begin
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  select * into v_enrollment from public.wc_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada'; end if;
  if v_enrollment.user_id <> p_user_id then raise exception 'Inscripción pertenece a otro usuario'; end if;
  if v_enrollment.payment_status = 'paid' then return; end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if v_pool.enrollment_deadline <= now() then
    raise exception 'Inscripciones cerradas (deadline: %)', v_pool.enrollment_deadline;
  end if;

  v_price  := case when v_enrollment.mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end;
  v_charge := greatest(v_price - coalesce(v_enrollment.referral_discount, 0), 0);

  select id, balance into v_wallet_id, v_balance from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'Wallet no encontrado'; end if;
  if v_balance < v_charge then
    raise exception 'Saldo insuficiente (balance: %, monto: %)', v_balance, v_charge;
  end if;

  update public.wallets set balance = v_balance - v_charge where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
    values (v_wallet_id, 'inscripcion', -v_charge,
            'Inscripción Mundial 2026 - ' || initcap(v_enrollment.mode)
            || case when coalesce(v_enrollment.referral_discount,0) > 0
                    then ' (−$' || v_enrollment.referral_discount || ' código de invitación)' else '' end);

  -- paid_amount = lo realmente cobrado. La bolsa cuenta count*precio (no paid_amount),
  -- asi que el pozo crece el monto completo igual.
  update public.wc_enrollments
    set payment_status='paid', payment_method='wallet', paid_amount=v_charge, paid_at=now()
    where id = p_enrollment_id;
end;
$function$;

-- ── 3) wc_pay_enrollment_yappy: valida contra (precio - descuento) ──
create or replace function public.wc_pay_enrollment_yappy(p_user_id uuid, p_enrollment_id uuid, p_amount numeric, p_yappy_order_id text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_min        numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'unauthorized: only service_role'; end if;

  select * into v_enrollment from public.wc_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada'; end if;
  if v_enrollment.user_id <> p_user_id then raise exception 'user_id mismatch'; end if;
  if v_enrollment.payment_status = 'paid' then return; end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  v_min := greatest(
    (case when v_enrollment.mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end)
    - coalesce(v_enrollment.referral_discount, 0), 0);

  if p_amount < v_min then
    raise exception 'Monto Yappy menor al precio (% < %)', p_amount, v_min;
  end if;

  update public.wc_enrollments
    set payment_status='paid', payment_method='yappy', payment_ref=p_yappy_order_id,
        paid_amount=p_amount, paid_at=now()
    where id = p_enrollment_id;
end;
$function$;

-- ── 4) wc_pay_enrollment_card: valida contra (precio - descuento) ──
create or replace function public.wc_pay_enrollment_card(p_user_id uuid, p_enrollment_id uuid, p_amount numeric, p_pf_order_id text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_min        numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'unauthorized: only service_role'; end if;
  select * into v_enrollment from public.wc_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripcion no encontrada'; end if;
  if v_enrollment.user_id <> p_user_id then raise exception 'user_id mismatch'; end if;
  if v_enrollment.payment_status = 'paid' then return; end if;
  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  v_min := greatest(
    (case when v_enrollment.mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end)
    - coalesce(v_enrollment.referral_discount, 0), 0);
  -- p_amount = cargo a la tarjeta (precio neto + comision $1.50). Debe cubrir al menos el precio neto.
  if p_amount < v_min then raise exception 'Monto tarjeta menor al precio (% < %)', p_amount, v_min; end if;
  update public.wc_enrollments
    set payment_status='paid', payment_method='card', payment_ref=p_pf_order_id,
        paid_amount=p_amount, paid_at=now()
    where id = p_enrollment_id;
end; $function$;

-- ── 5) wc_validate_referral_code: feedback en vivo en la UI ──
create or replace function public.wc_validate_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_me      uuid;
  v_code    text := nullif(upper(btrim(coalesce(p_code,''))), '');
  v_ref_id  uuid;
  v_ref_nom text;
  v_already boolean;
begin
  if v_uid is null then return jsonb_build_object('valid', false, 'reason', 'No autenticado'); end if;
  select id into v_me from public.users where auth_id = v_uid;
  if v_code is null then return jsonb_build_object('valid', false, 'reason', 'Ingresá un código'); end if;
  select exists(select 1 from public.wc_enrollments where user_id = v_me and referred_by is not null) into v_already;
  if v_already then return jsonb_build_object('valid', false, 'reason', 'Ya usaste un código de invitación'); end if;
  select id, nombre into v_ref_id, v_ref_nom from public.users where referral_code = v_code;
  if v_ref_id is null then return jsonb_build_object('valid', false, 'reason', 'Código inválido'); end if;
  if v_ref_id = v_me then return jsonb_build_object('valid', false, 'reason', 'No puedes usar tu propio código'); end if;
  if not exists (select 1 from public.wc_enrollments where user_id = v_ref_id and payment_status = 'paid') then
    return jsonb_build_object('valid', false, 'reason', 'El código aún no está activo');
  end if;
  return jsonb_build_object('valid', true, 'discount', 2, 'referrer', split_part(coalesce(v_ref_nom,''), ' ', 1));
end; $function$;
revoke execute on function public.wc_validate_referral_code(text) from public, anon;
grant execute on function public.wc_validate_referral_code(text) to authenticated, service_role;

-- ── 6) wc_referral_status: estado para la tarjeta "Invita y gana" ──
create or replace function public.wc_referral_status()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_me      uuid;
  v_code    text;
  v_elig    boolean;
  v_count   int;
  v_earned  numeric;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id, referral_code into v_me, v_code from public.users where auth_id = v_uid;
  select exists(select 1 from public.wc_enrollments where user_id = v_me and payment_status = 'paid') into v_elig;
  select count(*), coalesce(sum(amount), 0) into v_count, v_earned
    from public.wc_referral_credits where referrer_id = v_me;
  return jsonb_build_object('code', v_code, 'eligible', v_elig,
                            'referred_count', v_count, 'earned_total', v_earned);
end; $function$;
revoke execute on function public.wc_referral_status() from public, anon;
grant execute on function public.wc_referral_status() to authenticated, service_role;

-- ── 7) Trigger del bono $3 al referidor cuando el pago del amigo se CONFIRMA ──
create or replace function public._trfn_wc_referral_reward()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_ref       uuid := new.referred_by;
  v_wallet_id uuid;
  v_name      text;
  v_rows      int;
begin
  -- Solo en la transicion a 'paid'
  if not (coalesce(old.payment_status,'') <> 'paid' and new.payment_status = 'paid') then
    return new;
  end if;
  -- admin_grant = inscripcion de regalo (no pago real) -> no genera bono
  if new.payment_method = 'admin_grant' then return new; end if;
  if v_ref is null or v_ref = new.user_id then return new; end if;

  -- Requisito: el referidor debe estar inscrito (pagado) en el Mundial
  if not exists (select 1 from public.wc_enrollments where user_id = v_ref and payment_status = 'paid') then
    return new;
  end if;

  -- Idempotencia: 1 bono por par (referidor, referido)
  insert into public.wc_referral_credits (referrer_id, referred_id, enrollment_id, amount)
    values (v_ref, new.user_id, new.id, 3)
    on conflict (referrer_id, referred_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return new; end if;  -- ya se habia acreditado

  -- Acreditar $3 directo (el trigger corre en el auth del amigo, no del referidor,
  -- por eso NO usamos credit_wallet que valida caller == dueño; esta funcion es
  -- SECURITY DEFINER y hace el credito de forma confiable).
  select id into v_wallet_id from public.wallets where user_id = v_ref;
  if v_wallet_id is null then return new; end if;
  select nombre into v_name from public.users where id = new.user_id;

  update public.wallets set balance = balance + 3 where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
    values (v_wallet_id, 'bono_referido', 3,
            'Bono por referido: ' || coalesce(v_name, 'un amigo') || ' se inscribió al Mundial');

  return new;
end; $function$;

drop trigger if exists trg_wc_referral_reward on public.wc_enrollments;
create trigger trg_wc_referral_reward
  after update on public.wc_enrollments
  for each row execute function public._trfn_wc_referral_reward();
