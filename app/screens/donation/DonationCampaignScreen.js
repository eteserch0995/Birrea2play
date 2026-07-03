import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Image, ActivityIndicator, Linking, Switch, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';
import { iniciarPagoTarjeta } from '../../../lib/paguelofacil';
import {
  RECAUDO, cardFee, cardTotal, getRecaudoStats, getRecaudoCompras, PRODUCTOS_SUGERIDOS,
  PICKUP, whatsappRecoleccionUrl, whatsappVoluntarioUrl,
} from '../../../lib/donaciones';

const hero = require('../../../assets/recaudo-hero.png');
const QUICK = [1, 5, 10, 20];
const CDSC = 'YO APOYO A VENEZUELA';

// Resuelve una ruta relativa (/assets/…) a URL absoluta para abrir en pestaña nueva.
function absUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin + u;
  return 'https://birrea2play.com' + u;
}
// Fecha corta es-PA: "2026-06-28" → "28 jun".
function fmtFecha(d) {
  try { return new Date(`${d}T12:00:00`).toLocaleDateString('es-PA', { day: '2-digit', month: 'short' }); }
  catch { return d; }
}

export default function DonationCampaignScreen({ navigation }) {
  const { user } = useAuthStore();
  const { width } = useWindowDimensions();
  const heroW = Math.min(width, 560);
  const heroH = Math.round(heroW * 0.5); // imagen horizontal ~2:1

  const [amount, setAmount]     = useState('');
  const [coverFee, setCoverFee] = useState(true);
  const [phone, setPhone]       = useState('');

  const [stats, setStats]   = useState(null);
  const [compras, setCompras] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | yappy_wait | success | error
  const [errMsg, setErrMsg] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [progress, setProgress] = useState(null);

  // Formulario de recolección de productos físicos.
  const [form, setForm] = useState({
    nombre: '', telefono: '', zona: '', provincia: 'Panamá', distrito: 'Panamá',
    corregimiento: '', barriada: '', calle: '', horario: '',
  });
  const [formErr, setFormErr] = useState(null);
  const [triedProd, setTriedProd] = useState(false);

  // Voluntarios para la recolección (opción 3).
  const [vol, setVol] = useState({ nombre: '', telefono: '', zona: '', disponibilidad: '' });
  const [volErr, setVolErr] = useState(null);
  const [triedVol, setTriedVol] = useState(false);

  const pollRef = useRef(null);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false); // guard síncrono anti doble-tap

  const loadStats = useCallback(async () => {
    try { setStats(await getRecaudoStats()); } catch { /* silencioso: el termómetro no bloquea */ }
    try { setCompras(await getRecaudoCompras()); } catch { /* silencioso: las compras no bloquean */ }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  // Marcar montado y cancelar polling al desmontar (cubre también el init en curso).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; try { pollRef.current?.cancel(); } catch {} };
  }, []);

  // Retorno del pago con tarjeta: pf-webhook redirige a la ruta 'creditos' (WalletScreen),
  // que muestra la confirmación de la donación (su rama donacion==='1'). NO registramos
  // aquí un listener de deep link: en web esta pantalla no está montada tras el retorno
  // (recarga completa a /creditos) y en nativo duplicaría la confirmación de WalletScreen.
  // El flujo Yappy confirma directo en donarYappy (no usa deep link).

  const baseRaw = parseFloat(String(amount).replace(',', '.'));
  // Normalizar a centavos exactos: el valor cobrado y la base registrada deben coincidir.
  const base = Number.isFinite(baseRaw) ? Math.round(baseRaw * 100) / 100 : baseRaw;
  const validBase = Number.isFinite(base) && base >= RECAUDO.min;
  const fee = validBase ? cardFee(base) : 0;
  const totalTarjeta = validBase ? cardTotal(base, coverFee) : 0;

  function onAmountChange(t) {
    // No permitir editar el monto mientras un cobro Yappy está en curso: cambiarlo
    // dispararía setStatus('idle') y rompería la máquina de estados (perdiendo el waitBox
    // y el botón Cancelar) con el poll aún activo en segundo plano.
    if (busy) return;
    // normalizar la coma decimal a punto ANTES de filtrar (teclados decimal-pad/locales
    // que usan coma): "1,50" => "1.50". Si no, la coma se borraría y "1,50" => "150" (100x).
    // permitir solo dígitos y un punto
    let clean = t.replace(/,/g, '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    // limitar a 2 decimales (centavos) para que el cobro y la base registrada coincidan
    const dot = clean.indexOf('.');
    if (dot !== -1) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1, dot + 3);
    setAmount(clean);
    setStatus('idle'); setErrMsg(null);
  }
  function pickChip(v) { if (busy) return; setAmount(String(v)); setStatus('idle'); setErrMsg(null); }

  function requireLogin() {
    if (user?.id) return true;
    setErrMsg('Necesitás iniciar sesión para donar.');
    setStatus('error');
    return false;
  }

  // Recaudo es un screen del root stack y la ruta /recaudo es pública/compartible: al entrar
  // por URL directa NO hay pantalla previa, así que goBack() sería un no-op (callejón sin salida).
  // Si no hay historial, navegamos al Home (tab Inicio) en vez de quedar atrapados.
  function goHome() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('MainTabs', { screen: 'Inicio' });
  }

  async function donarYappy() {
    if (submittingRef.current) return; // anti doble-tap síncrono
    if (!requireLogin()) return;
    if (!validBase) { setErrMsg(`Monto mínimo $${RECAUDO.min.toFixed(2)}.`); setStatus('error'); return; }
    if (base > RECAUDO.yappyMax) {
      setErrMsg(`Yappy permite hasta $${RECAUDO.yappyMax}. Para montos mayores usá tarjeta.`);
      setStatus('error'); return;
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) { setErrMsg('Ingresá tu número de Yappy.'); setStatus('error'); return; }

    submittingRef.current = true;
    setBusy(true); setErrMsg(null); setStatus('yappy_wait'); setProgress({ attempts: 0, maxAttempts: 60 });
    try {
      const { orderId } = await iniciarBotonYappy({ phone: digits, amount: base, tipo: 'donacion' });
      // Si la pantalla se desmontó durante el fetch de init, no crear el poll (evita intervalo huérfano).
      if (!mountedRef.current) return;
      const ctrl = pollBotonOrder({ orderId, onProgress: setProgress });
      pollRef.current = ctrl;
      await ctrl.promise;
      if (!mountedRef.current) return;
      setStatus('success');
      loadStats();
    } catch (e) {
      if (!mountedRef.current) return;
      if (e?.message !== 'cancelled') { setErrMsg(e?.message ?? 'No se pudo completar la donación.'); setStatus('error'); }
      else setStatus('idle');
    } finally {
      submittingRef.current = false;
      pollRef.current = null;
      if (mountedRef.current) { setBusy(false); setProgress(null); }
    }
  }

  function cancelYappy() {
    try { pollRef.current?.cancel(); } catch {}
    pollRef.current = null;
    setBusy(false); setStatus('idle'); setProgress(null);
  }

  async function donarTarjeta() {
    if (submittingRef.current) return; // anti doble-tap síncrono
    if (!requireLogin()) return;
    if (!validBase) { setErrMsg(`Monto mínimo $${RECAUDO.min.toFixed(2)}.`); setStatus('error'); return; }
    // El server (pf-create-link) valida el TOTAL a cobrar (base + comisión) contra el tope,
    // no la base. Validamos aquí el MISMO valor (totalTarjeta) para no iniciar un pago que el
    // server rechazaría con un error genérico cuando "cubrir comisión" empuja el total > cardMax.
    if (totalTarjeta > RECAUDO.cardMax) {
      setErrMsg(coverFee
        ? `El total con comisión ($${totalTarjeta.toFixed(2)}) supera el máximo de $${RECAUDO.cardMax}. Reducí el monto o desactivá "Cubrir la comisión".`
        : `Monto máximo $${RECAUDO.cardMax} por transacción.`);
      setStatus('error'); return;
    }

    submittingRef.current = true;
    setBusy(true); setErrMsg(null);
    try {
      await iniciarPagoTarjeta({
        userId: user.id,
        amount: totalTarjeta,        // total a cobrar (base + comisión si la cubre)
        descripcion: CDSC,           // aparece en la transacción de la tarjeta
        tipo: 'donacion',
        credito_monto: base,         // monto base de la donación (para el termómetro)
      });
      // El retorno lo maneja el deep link (?status=success&donacion=1). Refrescamos al volver.
    } catch (e) {
      if (mountedRef.current) { setErrMsg(e?.message ?? 'No se pudo abrir el pago con tarjeta.'); setStatus('error'); }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); setFormErr(null); }
  function setVolField(k, v) { setVol((s) => ({ ...s, [k]: v })); setVolErr(null); }

  // Campos obligatorios de cada formulario (se marcan con * y borde rojo si faltan).
  const REQ_PROD = ['nombre', 'telefono', 'zona', 'calle', 'horario'];
  const missingProd = (k) => !String(form[k] ?? '').trim();
  const REQ_VOL = ['nombre', 'telefono', 'disponibilidad'];
  const missingVol = (k) => !String(vol[k] ?? '').trim();

  function enviarRecoleccion() {
    setTriedProd(true);
    if (REQ_PROD.some(missingProd)) {
      setFormErr('Completá los campos marcados con *.');
      return;
    }
    Linking.openURL(whatsappRecoleccionUrl(form)).catch(() => setFormErr('No se pudo abrir WhatsApp.'));
  }

  function verUbicacion() {
    Linking.openURL(PICKUP.dropoffMaps).catch(() => {});
  }

  function ayudarRecolectar() {
    setTriedVol(true);
    if (REQ_VOL.some(missingVol)) {
      setVolErr('Completá los campos marcados con *.');
      return;
    }
    Linking.openURL(whatsappVoluntarioUrl(vol)).catch(() => setVolErr('No se pudo abrir WhatsApp.'));
  }

  // ── Pantalla de agradecimiento (Yappy confirmado) ──
  if (status === 'success') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.thanksWrap}>
          <Text style={styles.thanksHeart}>❤️</Text>
          <Text style={styles.thanksTitle}>¡GRACIAS POR TU APOYO!</Text>
          <Text style={styles.thanksSub}>
            Tu donación quedó registrada. El 100% se usa en compra de insumos y publicamos la factura en el grupo de WhatsApp.
          </Text>
          {stats && (
            <Text style={styles.thanksStat}>
              Llevamos ${stats.total.toFixed(2)} de {stats.donantes} {stats.donantes === 1 ? 'donante' : 'donantes'}
            </Text>
          )}
          <TouchableOpacity style={styles.btnPrimary} onPress={() => { setStatus('idle'); setAmount(''); }}>
            <Text style={styles.btnPrimaryText}>Hacer otra donación</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={goHome}>
            <Text style={styles.btnGhostText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={goHome} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.back}>‹ Volver</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Image source={hero} style={[styles.hero, { width: heroW, height: heroH }]} resizeMode="cover" />

        <Text style={styles.kicker}>RECAUDO SOLIDARIO</Text>
        <Text style={styles.title}>YO APOYO A VENEZUELA</Text>
        <Text style={styles.lead}>
          La mejor forma de ayudar es donar productos físicos — los recogemos en el centro de la ciudad, sábados y domingos. Si preferís, también podés aportar en dinero (con $1 ya ayudás).
        </Text>

        {/* Termómetro */}
        <View style={styles.meter}>
          <View style={styles.meterRow}>
            <View>
              <Text style={styles.meterValue}>${(stats?.total ?? 0).toFixed(2)}</Text>
              <Text style={styles.meterLabel}>recaudado</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.meterValue}>{stats?.donantes ?? 0}</Text>
              <Text style={styles.meterLabel}>{(stats?.donantes ?? 0) === 1 ? 'donante' : 'donantes'}</Text>
            </View>
          </View>
          {(stats?.gastado ?? 0) > 0 && (
            <View style={styles.meterSplit}>
              <View>
                <Text style={styles.meterSubValue}>${(stats?.gastado ?? 0).toFixed(2)}</Text>
                <Text style={styles.meterLabel}>invertido</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.meterSubValue, { color: COLORS.gold }]}>${(stats?.disponible ?? 0).toFixed(2)}</Text>
                <Text style={styles.meterLabel}>disponible</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Compras hechas con el fondo (transparencia) ── */}
        {compras.length > 0 && (
          <View style={styles.comprasBox}>
            <Text style={styles.comprasTitle}>🧾 Ya compramos con el fondo</Text>
            <Text style={styles.comprasIntro}>
              Cada compra rebaja el fondo y la mostramos con su factura y fotos. Podés seguir donando toda la semana.
            </Text>
            {compras.map((c) => (
              <View key={c.id} style={styles.compraCard}>
                <View style={styles.compraHead}>
                  <Text style={styles.compraComercio}>{c.comercio || 'Compra'}{c.fecha ? ` · ${fmtFecha(c.fecha)}` : ''}</Text>
                  <Text style={styles.compraMonto}>−${Number(c.monto).toFixed(2)}</Text>
                </View>
                {c.descripcion ? <Text style={styles.compraDesc}>{c.descripcion}</Text> : null}
                {Array.isArray(c.items) && c.items.length > 0 && (
                  <View style={styles.compraItems}>
                    {c.items.map((it, i) => (
                      <View key={i} style={styles.compraItemRow}>
                        <Text style={styles.compraItemName} numberOfLines={2}>• {it.cant ? `${it.cant}× ` : ''}{it.nombre}</Text>
                        {it.total != null && <Text style={styles.compraItemTotal}>${Number(it.total).toFixed(2)}</Text>}
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.compraBtns}>
                  {c.factura_url && (
                    <TouchableOpacity style={styles.compraBtn} onPress={() => { const u = absUrl(c.factura_url); if (u) Linking.openURL(u).catch(() => {}); }}>
                      <Text style={styles.compraBtnText}>🧾 Ver factura</Text>
                    </TouchableOpacity>
                  )}
                  {c.foto_url && (
                    <TouchableOpacity style={[styles.compraBtn, styles.compraBtnAlt]} onPress={() => { const u = absUrl(c.foto_url); if (u) Linking.openURL(u).catch(() => {}); }}>
                      <Text style={styles.compraBtnText}>📦 Ver fotos</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── 1 · PRINCIPAL: Donación de productos físicos ── */}
        <Text style={styles.section}>1 · Doná productos físicos</Text>
        <View style={styles.pickupBox}>
          <Text style={styles.pickupText}>
            📍 Recogemos <Text style={styles.pickupStrong}>solo en zonas cercanas a la capital</Text> (Tumba Muerto, Transístmica, Bethania, Bella Vista, Obarrio, Vía España…). No cubrimos Panamá Norte, Este ni Oeste.
          </Text>
        </View>

        <Text style={styles.prodIntro}>¿Qué podés donar?</Text>
        <View style={styles.prodList}>
          {PRODUCTOS_SUGERIDOS.map((p) => (
            <Text key={p} style={styles.prodItem}>• {p}</Text>
          ))}
        </View>

        {/* Formulario de recolección (se envía por WhatsApp con los datos cargados) */}
        <Text style={styles.prodIntro}>Datos para la recolección</Text>

        <Text style={styles.fieldLabel}>Nombre y apellido <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedProd && missingProd('nombre') && styles.inputErr]} value={form.nombre} onChangeText={(t) => setField('nombre', t)} placeholder="Nombre y apellido" placeholderTextColor={COLORS.gray} />

        <Text style={styles.fieldLabel}>Número de contacto / WhatsApp <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedProd && missingProd('telefono') && styles.inputErr]} value={form.telefono} onChangeText={(t) => setField('telefono', t)} placeholder="6000-0000" placeholderTextColor={COLORS.gray} keyboardType="phone-pad" inputMode="tel" />

        <Text style={styles.fieldLabel}>Zona de recolección (solo cercanas a la capital) <Text style={styles.req}>*</Text></Text>
        <View style={styles.chips}>
          {PICKUP.zones.map((z) => {
            const active = form.zona === z;
            return (
              <TouchableOpacity key={z} style={[styles.zoneChip, active && styles.zoneChipActive]} onPress={() => setField('zona', z)}>
                <Text style={[styles.zoneChipText, active && styles.zoneChipTextActive]}>{z}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {triedProd && missingProd('zona') && <Text style={styles.error}>* Seleccioná una zona.</Text>}

        <Text style={styles.fieldLabel}>Provincia</Text>
        <TextInput style={styles.formInput} value={form.provincia} onChangeText={(t) => setField('provincia', t)} placeholder="Provincia" placeholderTextColor={COLORS.gray} />
        <Text style={styles.fieldLabel}>Distrito</Text>
        <TextInput style={styles.formInput} value={form.distrito} onChangeText={(t) => setField('distrito', t)} placeholder="Distrito" placeholderTextColor={COLORS.gray} />
        <Text style={styles.fieldLabel}>Corregimiento</Text>
        <TextInput style={styles.formInput} value={form.corregimiento} onChangeText={(t) => setField('corregimiento', t)} placeholder="Corregimiento" placeholderTextColor={COLORS.gray} />
        <Text style={styles.fieldLabel}>Barriada</Text>
        <TextInput style={styles.formInput} value={form.barriada} onChangeText={(t) => setField('barriada', t)} placeholder="Barriada" placeholderTextColor={COLORS.gray} />
        <Text style={styles.fieldLabel}>Calle o apartamento <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedProd && missingProd('calle') && styles.inputErr]} value={form.calle} onChangeText={(t) => setField('calle', t)} placeholder="Calle o apartamento" placeholderTextColor={COLORS.gray} />
        <Text style={styles.fieldLabel}>Horario disponible para la recolección <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedProd && missingProd('horario') && styles.inputErr]} value={form.horario} onChangeText={(t) => setField('horario', t)} placeholder="Ej. sábado 9am-12md" placeholderTextColor={COLORS.gray} />

        {formErr && <Text style={styles.error}>{formErr}</Text>}

        <TouchableOpacity style={styles.btnWa} onPress={enviarRecoleccion}>
          <Text style={styles.btnWaText}>🟢 Enviar mis datos por WhatsApp</Text>
        </TouchableOpacity>

        {/* Alternativa: que el donante lo envíe a la ubicación */}
        <View style={styles.dropoffBox}>
          <Text style={styles.dropoffTitle}>O envialo vos por PedidosYa, InDrive o Uber a:</Text>
          <Text style={styles.dropoffAddr}>{PICKUP.dropoffLabel}</Text>
          <Text style={styles.dropoffAddr}>{PICKUP.dropoffApto} · Recibe: {PICKUP.dropoffRecibe} (nosotros lo gestionamos)</Text>
          <TouchableOpacity style={styles.btnMaps} onPress={verUbicacion}>
            <Text style={styles.btnMapsText}>📍 Ver ubicación en el mapa</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.foot}>Coordinación de productos: 6122-2854 · 6325-5309</Text>

        {/* Transparencia */}
        <View style={styles.transBox}>
          <Text style={styles.transText}>
            <Text style={styles.transStrong}>100% transparente:</Text> todo lo recaudado se usa en compra de insumos y publicamos la factura en el grupo de WhatsApp.
          </Text>
        </View>

        {/* ── 2 · ALTERNATIVA: Aporte en dinero ── */}
        <View style={styles.divider} />
        <Text style={styles.section}>2 · ¿Preferís aportar en dinero?</Text>
        <Text style={styles.altSub}>
          Es una alternativa — con <Text style={styles.altStrong}>$1 ya ayudás</Text>. Elegí un monto:
        </Text>
        <View style={[styles.chips, busy && styles.disabledBlock]}>
          {QUICK.map((v) => {
            const active = parseFloat(amount) === v;
            return (
              <TouchableOpacity key={v} style={[styles.chip, active && styles.chipActive]} onPress={() => pickChip(v)} disabled={busy}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>${v}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={[styles.amountRow, busy && styles.disabledBlock]}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={onAmountChange}
            placeholder="0.00"
            placeholderTextColor={COLORS.gray}
            keyboardType="decimal-pad"
            inputMode="decimal"
            editable={!busy}
          />
        </View>

        {/* Cubrir comisión (solo tarjeta) */}
        <View style={styles.coverRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.coverTitle}>Cubrir la comisión de tarjeta</Text>
            <Text style={styles.coverSub}>
              {validBase
                ? `Sumá $${fee.toFixed(2)} (1% + $0.50) para que llegue el monto completo. (Yappy no tiene comisión.)`
                : 'Sumá 1% + $0.50 para que llegue el monto completo. (Yappy no tiene comisión.)'}
            </Text>
          </View>
          <Switch
            value={coverFee}
            onValueChange={setCoverFee}
            trackColor={{ true: COLORS.green, false: COLORS.line }}
            thumbColor={COLORS.white}
          />
        </View>

        {errMsg && status === 'error' && <Text style={styles.error}>{errMsg}</Text>}

        {/* Yappy / Tarjeta */}
        {status === 'yappy_wait' ? (
          <View style={styles.waitBox}>
            <ActivityIndicator color={COLORS.green} />
            <Text style={styles.waitTitle}>Aprobá el cobro en tu app Yappy…</Text>
            {progress && <Text style={styles.waitSub}>Esperando confirmación ({progress.attempts}/{progress.maxAttempts})</Text>}
            <TouchableOpacity style={styles.btnGhost} onPress={cancelYappy}>
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.phoneLabel}>Tu número de Yappy</Text>
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={(t) => setPhone(t)}
              placeholder="6000-0000"
              placeholderTextColor="#9AA0A6"
              keyboardType="phone-pad"
              inputMode="tel"
            />
            <TouchableOpacity style={[styles.btnYappy, busy && styles.btnDisabled]} onPress={donarYappy} disabled={busy}>
              <Text style={styles.btnYappyText}>{busy ? 'Procesando…' : '📱 Donar con Yappy'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btnCard, busy && styles.btnDisabled]} onPress={donarTarjeta} disabled={busy}>
              <Text style={styles.btnCardText}>
                💳 Donar con Tarjeta{validBase ? ` · $${totalTarjeta.toFixed(2)}` : ''}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── 3 · Ayudá en la recolección ── */}
        <View style={styles.divider} />
        <Text style={styles.section}>3 · ¿Querés ayudar en la recolección?</Text>
        <Text style={styles.altSub}>Si podés sumarte a la logística, dejanos tus datos y te escribimos.</Text>

        <Text style={styles.fieldLabel}>Nombre y apellido <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedVol && missingVol('nombre') && styles.inputErr]} value={vol.nombre} onChangeText={(t) => setVolField('nombre', t)} placeholder="Nombre y apellido" placeholderTextColor={COLORS.gray} />

        <Text style={styles.fieldLabel}>Número de contacto / WhatsApp <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedVol && missingVol('telefono') && styles.inputErr]} value={vol.telefono} onChangeText={(t) => setVolField('telefono', t)} placeholder="6000-0000" placeholderTextColor={COLORS.gray} keyboardType="phone-pad" inputMode="tel" />

        <Text style={styles.fieldLabel}>Zona donde podés ayudar</Text>
        <TextInput style={styles.formInput} value={vol.zona} onChangeText={(t) => setVolField('zona', t)} placeholder="Ej. Tumba Muerto, Bella Vista…" placeholderTextColor={COLORS.gray} />

        <Text style={styles.fieldLabel}>Disponibilidad <Text style={styles.req}>*</Text></Text>
        <TextInput style={[styles.formInput, triedVol && missingVol('disponibilidad') && styles.inputErr]} value={vol.disponibilidad} onChangeText={(t) => setVolField('disponibilidad', t)} placeholder="Días y horas que podés ayudar" placeholderTextColor={COLORS.gray} />

        {volErr && <Text style={styles.error}>{volErr}</Text>}
        <TouchableOpacity style={styles.btnVol} onPress={ayudarRecolectar}>
          <Text style={styles.btnVolText}>🤝 Enviar mis datos por WhatsApp</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  back: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 16 },
  scroll: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xxl + 72, alignItems: 'stretch' },

  hero: { alignSelf: 'center', borderRadius: RADIUS.lg, marginBottom: SPACING.md, backgroundColor: COLORS.card },
  kicker: { fontFamily: FONTS.bodyBold, color: COLORS.gold, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  title: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 34, letterSpacing: 1, lineHeight: 36, marginTop: 2 },
  lead: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14, lineHeight: 20, marginTop: SPACING.sm },

  meter: {
    backgroundColor: COLORS.card2, borderRadius: RADIUS.md, padding: SPACING.md,
    marginTop: SPACING.md, borderWidth: 1, borderColor: COLORS.line, ...SHADOWS.card,
  },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  meterValue: { fontFamily: FONTS.heading, color: COLORS.green, fontSize: 30, letterSpacing: 0.5 },
  meterLabel: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  meterSplit: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.line },
  meterSubValue: { fontFamily: FONTS.heading, color: COLORS.gray2, fontSize: 20, letterSpacing: 0.5 },

  comprasBox: { marginTop: SPACING.md },
  comprasTitle: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 16, marginBottom: 4 },
  comprasIntro: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, lineHeight: 18, marginBottom: SPACING.sm },
  compraCard: { backgroundColor: COLORS.card2, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.line, marginBottom: SPACING.sm },
  compraHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compraComercio: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 15, flex: 1, paddingRight: SPACING.sm },
  compraMonto: { fontFamily: FONTS.heading, color: COLORS.red2 ?? COLORS.red, fontSize: 18 },
  compraDesc: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, lineHeight: 18, marginTop: 4 },
  compraItems: { marginTop: SPACING.sm, gap: 3 },
  compraItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACING.sm },
  compraItemName: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, flex: 1, lineHeight: 18 },
  compraItemTotal: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 13 },
  compraBtns: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  compraBtn: { flex: 1, backgroundColor: COLORS.blue, borderRadius: RADIUS.md, paddingVertical: SPACING.sm + 2, alignItems: 'center' },
  compraBtnAlt: { backgroundColor: COLORS.card, borderWidth: 1.5, borderColor: COLORS.gold },
  compraBtnText: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 14 },

  transBox: {
    backgroundColor: COLORS.green + '14', borderRadius: RADIUS.md, padding: SPACING.md,
    marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.green + '44',
  },
  transText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, lineHeight: 19 },
  transStrong: { fontFamily: FONTS.bodyBold, color: COLORS.green },

  section: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 16, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    borderWidth: 1.5, borderColor: COLORS.line, backgroundColor: COLORS.card,
  },
  chipActive: { borderColor: COLORS.gold, backgroundColor: COLORS.gold + '22' },
  chipText: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 15 },
  chipTextActive: { color: COLORS.gold },

  amountRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm,
    borderWidth: 1.5, borderColor: COLORS.line, borderRadius: RADIUS.md,
    backgroundColor: COLORS.card, paddingHorizontal: SPACING.md,
  },
  dollar: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 26, marginRight: SPACING.xs },
  amountInput: { flex: 1, fontFamily: FONTS.heading, color: COLORS.white, fontSize: 28, paddingVertical: SPACING.sm },

  coverRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, gap: SPACING.sm },
  coverTitle: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14 },
  coverSub: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, marginTop: 2, lineHeight: 16 },

  error: { fontFamily: FONTS.bodySemiBold, color: COLORS.red2 ?? COLORS.red, fontSize: 13, marginTop: SPACING.sm },

  btnYappy: { backgroundColor: COLORS.green, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.md },
  btnYappyText: { fontFamily: FONTS.bodyBold, color: '#06231A', fontSize: 16 },
  btnCard: { backgroundColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  btnCardText: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
  disabledBlock: { opacity: 0.5 },

  waitBox: { alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.card2, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.green + '44' },
  waitTitle: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 15, textAlign: 'center' },
  waitSub: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12 },

  divider: { height: 1, backgroundColor: COLORS.line, marginVertical: SPACING.lg },
  prodList: { gap: 4 },
  prodItem: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14, lineHeight: 20 },
  btnWa: { backgroundColor: '#25D366', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.md },
  btnWaText: { fontFamily: FONTS.bodyBold, color: '#06231A', fontSize: 16 },
  foot: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, textAlign: 'center', marginTop: SPACING.sm },

  // Productos físicos (bloque principal)
  pickupBox: {
    backgroundColor: COLORS.gold + '18', borderRadius: RADIUS.md, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.gold + '55', marginTop: SPACING.sm, marginBottom: SPACING.sm,
  },
  pickupText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14, lineHeight: 20 },
  pickupStrong: { fontFamily: FONTS.bodyBold, color: COLORS.gold },
  prodIntro: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14, marginBottom: SPACING.xs },

  // Aporte en dinero (alternativa)
  altSub: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, marginBottom: SPACING.sm, lineHeight: 18 },
  altStrong: { fontFamily: FONTS.bodyBold, color: COLORS.green },

  // Caja del número de Yappy — grande, fondo blanco, letra negra (llamativa)
  phoneLabel: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14, marginTop: SPACING.md, marginBottom: SPACING.xs },
  phoneInput: {
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: FONTS.bodyBold,
    fontSize: 22,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.gold,
    textAlign: 'center',
    letterSpacing: 1,
  },

  // Formulario de recolección
  formInput: {
    backgroundColor: COLORS.card, color: COLORS.white, fontFamily: FONTS.body, fontSize: 15,
    borderWidth: 1.5, borderColor: COLORS.line, borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm + 2, paddingHorizontal: SPACING.md, marginTop: SPACING.sm,
  },
  formLabel: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 13, marginTop: SPACING.md, marginBottom: SPACING.xs },
  fieldLabel: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 12, marginTop: SPACING.sm, marginBottom: 2 },
  req: { color: COLORS.red2 ?? COLORS.red, fontFamily: FONTS.bodyBold },
  inputErr: { borderColor: COLORS.red2 ?? COLORS.red, borderWidth: 1.5 },
  zoneChip: { paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full, borderWidth: 1.5, borderColor: COLORS.line, backgroundColor: COLORS.card },
  zoneChipActive: { borderColor: COLORS.green, backgroundColor: COLORS.green + '22' },
  zoneChipText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  zoneChipTextActive: { color: COLORS.green, fontFamily: FONTS.bodyBold },

  dropoffBox: { backgroundColor: COLORS.card2, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.md, borderWidth: 1, borderColor: COLORS.line },
  dropoffTitle: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 13 },
  dropoffAddr: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, marginTop: 4 },
  btnMaps: { backgroundColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.sm + 2, alignItems: 'center', marginTop: SPACING.sm },
  btnMapsText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14 },

  btnVol: { backgroundColor: COLORS.gold, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  btnVolText: { fontFamily: FONTS.bodyBold, color: '#1A1A0A', fontSize: 16 },

  // Agradecimiento
  thanksWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.sm },
  thanksHeart: { fontSize: 56 },
  thanksTitle: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 30, letterSpacing: 1, textAlign: 'center' },
  thanksSub: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  thanksStat: { fontFamily: FONTS.bodyBold, color: COLORS.green, fontSize: 15, marginTop: SPACING.sm },
  btnPrimary: { backgroundColor: COLORS.gold, borderRadius: RADIUS.md, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, marginTop: SPACING.lg },
  btnPrimaryText: { fontFamily: FONTS.bodyBold, color: '#1A1A0A', fontSize: 16 },
  btnGhost: { paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.xs },
  btnGhostText: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 14 },
});
