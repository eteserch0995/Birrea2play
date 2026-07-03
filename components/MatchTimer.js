// MatchTimer — cronómetro único por evento (cuenta regresiva).
//
// • mode="control" → gestor/admin: configura duración, inicia/pausa, reinicia.
// • mode="view"    → jugadores (ver evento en curso): solo ven el tiempo.
//
// El estado vive en la tabla `events` (un solo cronómetro por evento) y se
// sincroniza vía RPCs `get_event_timer` / `set_event_timer`. La cuenta regresiva
// se calcula localmente desde `timer_ends_at` (timestamp absoluto del servidor),
// por lo que es exacta entre dispositivos sin depender de realtime; un poll ligero
// capta los cambios que hace el organizador (iniciar/pausar/reiniciar/duración).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import { supabase } from '../lib/supabase';

const PRESETS = [10, 15, 20, 25, 30, 45]; // minutos

const pad2 = (n) => String(n).padStart(2, '0');
function fmt(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

// Aviso al llegar a 0 — best-effort en web (bloqueos de autoplay se ignoran).
function fireAlarm() {
  if (Platform.OS !== 'web') return;
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([220, 120, 220, 120, 320]);
    }
  } catch {}
  try {
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (start, freq) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.32);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + 0.34);
    };
    beep(0, 880); beep(0.45, 880); beep(0.9, 1175);
    setTimeout(() => { try { ctx.close(); } catch {} }, 1800);
  } catch {}
}

export default function MatchTimer({ eventId, mode = 'view', style }) {
  const isControl = mode === 'control';
  const [state, setState]       = useState(null);   // { status, duration, endsAt(ms|null), remaining(sec|null) }
  const [offsetMs, setOffsetMs] = useState(0);       // serverNow - clientNow
  const [, setTick]             = useState(0);
  const [busy, setBusy]         = useState(false);
  const [editM, setEditM]       = useState('');
  const [editS, setEditS]       = useState('');
  const [alarm, setAlarm]       = useState(false);
  const mountedRef              = useRef(true);
  const alarmFiredRef           = useRef(false);     // latch anti-redisparo por ciclo

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applyRow = useCallback((row) => {
    if (!row || !mountedRef.current) return;
    const serverNow = row.server_now ? new Date(row.server_now).getTime() : Date.now();
    setOffsetMs(serverNow - Date.now());
    setState({
      status:    row.timer_status ?? 'idle',
      duration:  row.timer_duration_sec ?? 1500,
      endsAt:    row.timer_ends_at ? new Date(row.timer_ends_at).getTime() : null,
      remaining: row.timer_remaining_sec ?? null,
    });
  }, []);

  const fetchState = useCallback(async () => {
    if (!eventId) return;
    const { data, error } = await supabase.rpc('get_event_timer', { p_event_id: eventId });
    if (error || !mountedRef.current) return;
    applyRow(Array.isArray(data) ? data[0] : data);
  }, [eventId, applyRow]);

  // Al cambiar de evento: descartar estado/alarma previos (evita mostrar el
  // cronómetro y disparar la alarma del evento anterior si la instancia se reusa).
  useEffect(() => {
    setState(null);
    alarmFiredRef.current = false;
    setAlarm(false);
  }, [eventId]);

  // Carga inicial + poll para captar cambios del organizador.
  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, isControl ? 6000 : 3500);
    return () => clearInterval(id);
  }, [fetchState, isControl]);

  // Tick local: countdown fluido sin depender del poll. Solo corre cuando está
  // en marcha (en idle/paused el tiempo es estático → evita renders inútiles).
  useEffect(() => {
    if (state?.status !== 'running') return undefined;
    const id = setInterval(() => setTick((t) => (t + 1) % 1e9), 500);
    return () => clearInterval(id);
  }, [state?.status]);

  const computeRemaining = () => {
    if (!state) return 0;
    if (state.status === 'running' && state.endsAt != null) {
      // ceil: 00:00 solo cuando realmente se alcanzó endsAt (no medio segundo antes).
      return Math.max(0, Math.ceil((state.endsAt - (Date.now() + offsetMs)) / 1000));
    }
    return Math.max(0, state.remaining ?? state.duration ?? 0);
  };
  const remaining = computeRemaining();

  // Cruce a 0 → alarma una sola vez por ciclo de cuenta (latch dedicado).
  useEffect(() => {
    if (!state) return;
    if (state.status === 'running') {
      if (remaining > 2) alarmFiredRef.current = false; // hay tiempo → re-armar para el próximo ciclo
      if (remaining === 0 && !alarmFiredRef.current) {
        alarmFiredRef.current = true;
        setAlarm(true);
        fireAlarm();
      }
    } else {
      alarmFiredRef.current = false;
      if (remaining > 0 && alarm) setAlarm(false);
    }
  }, [remaining, state, alarm]);

  async function control(action, durationSec) {
    if (busy || !eventId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('set_event_timer', {
        p_event_id: eventId,
        p_action: action,
        p_duration_sec: durationSec ?? null,
      });
      if (!mountedRef.current) return;
      if (error) { console.warn('[MatchTimer]', action, error.message); return; }
      applyRow(Array.isArray(data) ? data[0] : data);
      alarmFiredRef.current = false;
      setAlarm(false);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function applyManualDuration() {
    const m = parseInt(editM, 10);
    const s = parseInt(editS, 10);
    const total = (isNaN(m) ? 0 : m) * 60 + (isNaN(s) ? 0 : s);
    if (total <= 0) return;
    control('config', total);
    setEditM(''); setEditS('');
  }

  // ── VIEW (jugadores) ───────────────────────────────────────────────────────
  if (!isControl) {
    if (!state || state.status === 'idle') return null; // sin cronómetro activo → nada
    const danger = remaining === 0;
    const color = remaining === 0 ? COLORS.red : state.status === 'paused' ? COLORS.gold : COLORS.green;
    return (
      <View style={[styles.viewWrap, danger && styles.wrapDanger, style]}>
        <Text style={styles.viewLabel}>
          {remaining === 0 ? '⏱ ¡TIEMPO!' : state.status === 'paused' ? '⏱ EN PAUSA' : '⏱ EN JUEGO'}
        </Text>
        <Text style={[styles.viewTime, { color }]}>{fmt(remaining)}</Text>
      </View>
    );
  }

  // ── CONTROL (gestor/admin) ──────────────────────────────────────────────────
  const running = state?.status === 'running';
  const timeColor = remaining === 0 ? COLORS.red
    : running ? COLORS.green
    : state?.status === 'paused' ? COLORS.gold
    : COLORS.white;
  return (
    <View style={[styles.ctrlWrap, alarm && remaining === 0 && styles.wrapDanger, style]}>
      <View style={styles.ctrlHeaderRow}>
        <Text style={styles.ctrlTitle}>⏱ CRONÓMETRO</Text>
        <Text style={styles.ctrlStatus}>
          {running ? 'EN JUEGO' : state?.status === 'paused' ? 'PAUSA' : 'LISTO'}
        </Text>
      </View>

      <Text style={[styles.ctrlTime, { color: timeColor }]}>{fmt(remaining)}</Text>

      {!running && (
        <>
          <View style={styles.presetRow}>
            {PRESETS.map((min) => (
              <TouchableOpacity key={min} style={styles.preset} onPress={() => control('config', min * 60)} disabled={busy}>
                <Text style={styles.presetText}>{min}'</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput} keyboardType="number-pad" maxLength={3}
              placeholder={String(Math.floor((state?.duration ?? 0) / 60))} placeholderTextColor={COLORS.gray}
              value={editM} onChangeText={setEditM}
            />
            <Text style={styles.manualColon}>:</Text>
            <TextInput
              style={styles.manualInput} keyboardType="number-pad" maxLength={2}
              placeholder={pad2((state?.duration ?? 0) % 60)} placeholderTextColor={COLORS.gray}
              value={editS} onChangeText={setEditS}
            />
            <TouchableOpacity style={styles.applyBtn} onPress={applyManualDuration} disabled={busy}>
              <Text style={styles.applyBtnText}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: running ? COLORS.gold : COLORS.green, opacity: busy ? 0.6 : 1 }]}
          onPress={() => control(running ? 'pause' : 'start')}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color={COLORS.bg} size="small" />
            : <Text style={[styles.actionText, { color: COLORS.bg }]}>{running ? '⏸ Pausar' : '▶ Iniciar'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.resetBtn, { opacity: busy ? 0.6 : 1 }]} onPress={() => control('reset')} disabled={busy}>
          <Text style={[styles.actionText, { color: COLORS.white }]}>↺ Reiniciar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapDanger:    { borderColor: COLORS.red, backgroundColor: COLORS.red + '18' },

  // view (el espaciado inferior lo controla el contenedor padre vía gap)
  viewWrap:      { backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.green + '55', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, alignItems: 'center' },
  viewLabel:     { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray2, letterSpacing: 2 },
  viewTime:      { fontFamily: FONTS.heading, fontSize: 46, letterSpacing: 2, lineHeight: 50 },

  // control
  ctrlWrap:      { backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.navy, padding: SPACING.md, gap: SPACING.sm },
  ctrlHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ctrlTitle:     { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gold, letterSpacing: 1 },
  ctrlStatus:    { fontFamily: FONTS.bodyMedium, fontSize: 11, color: COLORS.gray, letterSpacing: 1 },
  ctrlTime:      { fontFamily: FONTS.heading, fontSize: 56, letterSpacing: 2, textAlign: 'center', lineHeight: 60 },
  presetRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, justifyContent: 'center' },
  preset:        { paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy, borderWidth: 1, borderColor: COLORS.line },
  presetText:    { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  manualRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs },
  manualInput:   { backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.navy, color: COLORS.white, fontFamily: FONTS.heading, fontSize: 22, textAlign: 'center', width: 64, paddingVertical: 4 },
  manualColon:   { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gray },
  applyBtn:      { backgroundColor: COLORS.blue, borderRadius: RADIUS.sm, paddingVertical: 8, paddingHorizontal: 14, marginLeft: SPACING.xs },
  applyBtnText:  { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  actionsRow:    { flexDirection: 'row', gap: SPACING.sm },
  actionBtn:     { flex: 1, borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  resetBtn:      { backgroundColor: COLORS.navy, borderWidth: 1, borderColor: COLORS.line },
  actionText:    { fontFamily: FONTS.bodyBold, fontSize: 14, letterSpacing: 0.5 },
});
