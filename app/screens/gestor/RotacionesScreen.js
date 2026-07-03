import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import ResponsiveContainer from '../../../components/ResponsiveContainer';
import EmptyState from '../../../components/EmptyState';

// ROTACIONES: gestor de cambios por tiempo para partidos con mas inscritos que
// cupos en cancha (ej. amistoso 7v7 con 10 jugadores). Reparte minutos parejos
// con un motor greedy: en cada ventana entran los que MENOS han jugado.
//
// Estado 100% local (AsyncStorage por evento) — cero escrituras a la DB.
// El reloj usa timestamps de pared (Date.now), no conteo de ticks: sobrevive
// throttling del browser, reload de la pagina y hasta cierre de la app.

const STORE_PREFIX = 'b2p_rotaciones_v1';

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// Ventana sugerida: divisor del total que ademas reparte descansos enteros
// entre los N convocados. Fallback: 5 min.
function suggestWindow(totalMin, n, onField) {
  const rest = Math.max(1, n - onField);
  const candidates = [6, 5, 8, 4, 10, 7, 3, 9, 12, 15, 2];
  for (const w of candidates) {
    if (totalMin % w === 0 && ((rest * (totalMin / w)) % n) === 0) return w;
  }
  for (const w of candidates) {
    if (totalMin % w === 0) return w;
  }
  return 5;
}

function newPlan(players, totalMin = 60, onField = 7) {
  const windowMin = suggestWindow(totalMin, Math.max(players.length, onField), onField);
  return {
    version: 1,
    config: { totalMin, onField, windowMin },
    players,               // [{ key, nombre, source, active, playedSec, onField }]
    clock: { runningSince: null, accumSec: 0 },
    nextChangeAtSec: null, // se fija al iniciar
    started: false,
  };
}

export default function RotacionesScreen({ navigation, route }) {
  const paramEventId = route?.params?.eventId ?? null;
  const user = useAuthStore((s) => s.user);

  const [eventId, setEventId] = useState(paramEventId);
  const [eventName, setEventName] = useState('');
  const [pickerEvents, setPickerEvents] = useState(null); // null = cargando picker
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [newName, setNewName] = useState('');
  const [selOut, setSelOut] = useState(null); // key seleccionado EN CANCHA (cambio manual)
  const [selIn, setSelIn] = useState(null);   // key seleccionado en BANCA
  const [, setTickCount] = useState(0);       // re-render por segundo con reloj corriendo

  const storeKey = eventId ? `${STORE_PREFIX}:${eventId}` : null;

  // ── Persistencia: cada mutacion pasa por commit() ──────────────────────────
  const commit = useCallback((next) => {
    setPlan(next);
    if (storeKey) AsyncStorage.setItem(storeKey, JSON.stringify(next)).catch(() => {});
  }, [storeKey]);

  // ── Selector de evento (cuando se entra sin eventId, ej. desde AdminPanel) ─
  useEffect(() => {
    if (eventId || !user?.id) return;
    (async () => {
      let q = supabase.from('events').select('id, nombre, fecha, formato, status')
        .in('status', ['draft', 'open', 'active'])
        .order('fecha', { ascending: true });
      if (user.role !== 'admin') q = q.eq('created_by', user.id);
      const { data } = await q;
      setPickerEvents(data ?? []);
      setLoading(false);
    })();
  }, [eventId, user?.id, user?.role]);

  // ── Carga de roster desde la DB (inscritos activos + invitados) ────────────
  const fetchRoster = useCallback(async () => {
    const [{ data: regs }, { data: gs }] = await Promise.all([
      supabase.from('event_registrations').select('user_id, users(nombre)')
        .eq('event_id', eventId).in('status', ['confirmed', 'pending']),
      supabase.from('event_guests').select('id, nombre')
        .eq('event_id', eventId).in('status', ['confirmed', 'pending_payment']),
    ]);
    const players = [
      ...(regs ?? []).map((r) => ({
        key: `u:${r.user_id}`, nombre: r.users?.nombre ?? 'Jugador',
        source: 'reg', active: true, playedSec: 0, onField: false,
      })),
      ...(gs ?? []).map((g) => ({
        key: `g:${g.id}`, nombre: `${g.nombre ?? 'Invitado'} (inv)`,
        source: 'guest', active: true, playedSec: 0, onField: false,
      })),
    ];
    return players;
  }, [eventId]);

  // ── Hidratacion: AsyncStorage primero; si no hay, roster fresco de la DB ───
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: ev }, stored] = await Promise.all([
          supabase.from('events').select('nombre').eq('id', eventId).single(),
          AsyncStorage.getItem(`${STORE_PREFIX}:${eventId}`),
        ]);
        if (cancelled) return;
        setEventName(ev?.nombre ?? '');
        if (stored) {
          setPlan(JSON.parse(stored));
        } else {
          const players = await fetchRoster();
          if (cancelled) return;
          setPlan(newPlan(players));
        }
      } catch (e) {
        Alert.alert('Error', 'No se pudo cargar el evento. Verifica tu conexion.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, fetchRoster]);

  // ── Tick de render (el estado NO cambia: el tiempo se deriva de Date.now) ──
  const running = !!plan?.clock?.runningSince;
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setTickCount((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // ── Derivados de tiempo ─────────────────────────────────────────────────────
  const now = Date.now();
  const clockSec = plan
    ? plan.clock.accumSec + (plan.clock.runningSince ? (now - plan.clock.runningSince) / 1000 : 0)
    : 0;
  const playerSec = useCallback((p) => {
    if (!plan) return 0;
    const live = p.onField && plan.clock.runningSince ? (now - plan.clock.runningSince) / 1000 : 0;
    return p.playedSec + live;
  }, [plan, now]);

  const totalSec = (plan?.config.totalMin ?? 0) * 60;
  const activePlayers = useMemo(() => (plan?.players ?? []).filter((p) => p.active), [plan]);
  const onFieldPlayers = activePlayers.filter((p) => p.onField);
  const benchPlayers = activePlayers.filter((p) => !p.onField);
  const inactivePlayers = (plan?.players ?? []).filter((p) => !p.active);
  const targetSec = activePlayers.length > 0
    ? (totalSec * (plan?.config.onField ?? 7)) / activePlayers.length
    : 0;
  const countdown = plan?.nextChangeAtSec != null ? plan.nextChangeAtSec - clockSec : null;
  const changeDue = countdown != null && countdown <= 0 && plan?.started;
  const timeUp = plan?.started && clockSec >= totalSec && totalSec > 0;

  // ── Motor: propuesta de cambio (los que MENOS jugaron entran) ──────────────
  const proposal = useMemo(() => {
    if (!plan) return null;
    const S = plan.config.onField;
    const ranked = [...activePlayers].sort((a, b) => {
      const d = playerSec(a) - playerSec(b);
      if (Math.abs(d) > 0.5) return d;
      // Empate: prioriza a quien ya esta en cancha (minimiza cambios)
      return (b.onField ? 1 : 0) - (a.onField ? 1 : 0);
    });
    const nextOn = new Set(ranked.slice(0, S).map((p) => p.key));
    const sale = onFieldPlayers.filter((p) => !nextOn.has(p.key));
    const entra = benchPlayers.filter((p) => nextOn.has(p.key));
    return { sale, entra };
  }, [plan, activePlayers, onFieldPlayers, benchPlayers, playerSec]);

  // ── Mutadores ───────────────────────────────────────────────────────────────
  // Cierra el segmento corriente: acredita el tiempo transcurrido a los que
  // estan en cancha y reinicia la marca. Base de TODAS las operaciones de reloj.
  function flushSegment(p) {
    if (!p.clock.runningSince) return p;
    const delta = (Date.now() - p.clock.runningSince) / 1000;
    return {
      ...p,
      players: p.players.map((pl) => pl.onField && pl.active ? { ...pl, playedSec: pl.playedSec + delta } : pl),
      clock: { runningSince: Date.now(), accumSec: p.clock.accumSec + delta },
    };
  }

  function startOrResume() {
    let next = { ...plan };
    if (!next.started) {
      const S = next.config.onField;
      const actives = next.players.filter((p) => p.active);
      if (actives.length < S) {
        Alert.alert('Faltan jugadores', `Necesitas al menos ${S} convocados activos.`);
        return;
      }
      // Titulares: los primeros S activos, salvo que el gestor ya haya marcado
      // manualmente exactamente S en cancha antes de iniciar.
      const preset = actives.filter((p) => p.onField);
      const starters = new Set(
        (preset.length === S ? preset : actives.slice(0, S)).map((p) => p.key)
      );
      next.players = next.players.map((p) => ({ ...p, onField: starters.has(p.key) }));
      next.started = true;
      next.nextChangeAtSec = next.config.windowMin * 60;
    }
    next.clock = { ...next.clock, runningSince: Date.now() };
    commit(next);
  }

  function pause() {
    let next = flushSegment(plan);
    next = { ...next, clock: { ...next.clock, runningSince: null } };
    commit(next);
  }

  function applyProposal() {
    if (!proposal) return;
    let next = flushSegment(plan);
    const out = new Set(proposal.sale.map((p) => p.key));
    const inn = new Set(proposal.entra.map((p) => p.key));
    next = {
      ...next,
      players: next.players.map((p) =>
        out.has(p.key) ? { ...p, onField: false } : inn.has(p.key) ? { ...p, onField: true } : p
      ),
      // La proxima ventana se ancla al reloj del partido en el momento del cambio
      // (accumSec ya quedo al dia por el flushSegment de arriba).
      nextChangeAtSec: next.clock.accumSec + next.config.windowMin * 60,
    };
    commit(next);
    setSelOut(null); setSelIn(null);
  }

  function postponeProposal() {
    // Pospone 2 minutos el aviso, sin mover la cadencia base
    commit({ ...plan, nextChangeAtSec: clockSec + 120 });
  }

  function manualSwap() {
    if (!selOut || !selIn) return;
    let next = flushSegment(plan);
    next = {
      ...next,
      players: next.players.map((p) =>
        p.key === selOut ? { ...p, onField: false } : p.key === selIn ? { ...p, onField: true } : p
      ),
    };
    commit(next);
    setSelOut(null); setSelIn(null);
  }

  function toggleActive(p) {
    // Lesion / se fue / vuelve. Si estaba en cancha, primero acredita su tiempo.
    let next = flushSegment(plan);
    next = {
      ...next,
      players: next.players.map((pl) =>
        pl.key === p.key ? { ...pl, active: !pl.active, onField: false } : pl
      ),
    };
    commit(next);
  }

  function toggleFieldPreset(p) {
    // Antes de iniciar: marcar titulares a dedo
    if (plan.started) return;
    commit({
      ...plan,
      players: plan.players.map((pl) => pl.key === p.key ? { ...pl, onField: !pl.onField } : pl),
    });
  }

  function addManual() {
    const nombre = newName.trim();
    if (!nombre) return;
    const p = {
      key: `m:${Date.now()}`, nombre, source: 'manual',
      active: true, playedSec: 0, onField: false,
    };
    commit({ ...plan, players: [...plan.players, p] });
    setNewName('');
  }

  async function reloadRoster() {
    // Trae inscritos nuevos sin pisar tiempos de los existentes
    const fresh = await fetchRoster();
    const known = new Set(plan.players.map((p) => p.key));
    const nuevos = fresh.filter((p) => !known.has(p.key));
    if (nuevos.length === 0) { Alert.alert('Roster', 'No hay inscritos nuevos.'); return; }
    commit({ ...plan, players: [...plan.players, ...nuevos] });
    Alert.alert('Roster', `${nuevos.length} jugador(es) agregado(s).`);
  }

  function updateConfig(field, delta) {
    // "En cancha" queda fija tras iniciar; duracion y ventana se pueden ajustar
    // en caliente (ej. deciden jugar 70' o cambiar el ritmo de rotacion).
    if (plan.started && field === 'onField') return;
    const cfg = { ...plan.config };
    if (field === 'totalMin') cfg.totalMin = Math.min(180, Math.max(10, cfg.totalMin + delta));
    if (field === 'onField') cfg.onField = Math.min(11, Math.max(3, cfg.onField + delta));
    if (field === 'windowMin') cfg.windowMin = Math.min(30, Math.max(1, cfg.windowMin + delta));
    if (!plan.started && field !== 'windowMin') {
      cfg.windowMin = suggestWindow(cfg.totalMin, Math.max(activePlayers.length, cfg.onField), cfg.onField);
    }
    commit({ ...plan, config: cfg });
  }

  function resetAll() {
    Alert.alert('Reiniciar rotaciones', 'Se borran tiempos y el plan vuelve a cero. ¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reiniciar', style: 'destructive', onPress: async () => {
        if (storeKey) await AsyncStorage.removeItem(storeKey).catch(() => {});
        const players = plan.players.map((p) => ({ ...p, playedSec: 0, onField: false, active: true }));
        commit(newPlan(players, plan.config.totalMin, plan.config.onField));
      }},
    ]);
  }

  // ── Render: selector de evento ──────────────────────────────────────────────
  if (!eventId) {
    return (
      <SafeAreaView style={styles.safe}>
        <ResponsiveContainer>
          <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}>
            <Text style={styles.title}>ROTACIONES</Text>
            <Text style={styles.sub}>Elegi el evento a gestionar</Text>
            {pickerEvents === null ? (
              <ActivityIndicator color={COLORS.neon} style={{ margin: SPACING.xl }} />
            ) : pickerEvents.length === 0 ? (
              <EmptyState icon="⏱" title="Sin eventos activos" subtitle="Crea el evento primero desde tu panel" />
            ) : (
              pickerEvents.map((ev) => (
                <TouchableOpacity key={ev.id} style={styles.pickCard} onPress={() => { setLoading(true); setEventId(ev.id); }}>
                  <Text style={styles.pickName}>{ev.nombre}</Text>
                  <Text style={styles.pickSub}>{ev.formato} · {ev.status?.toUpperCase()} · {ev.fecha ? String(ev.fecha).slice(0, 10) : ''}</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </ResponsiveContainer>
      </SafeAreaView>
    );
  }

  if (loading || !plan) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.neon} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const S = plan.config.onField;
  const canApply = proposal && (proposal.entra.length > 0 || proposal.sale.length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <ResponsiveContainer>
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}>

          {/* Header */}
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.back}>← Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={resetAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={[styles.back, { color: COLORS.red2 }]}>Reiniciar</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.title}>ROTACIONES {S}v{S}</Text>
            {!!eventName && <Text style={styles.sub}>{eventName}</Text>}
          </View>

          {/* Config (editable hasta iniciar) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>PLAN</Text>
            <View style={styles.cfgRow}>
              <CfgStepper label="Duracion" value={`${plan.config.totalMin}'`}
                onMinus={() => updateConfig('totalMin', -5)} onPlus={() => updateConfig('totalMin', 5)} />
              <CfgStepper label="En cancha" value={String(S)} locked={plan.started}
                onMinus={() => updateConfig('onField', -1)} onPlus={() => updateConfig('onField', 1)} />
              <CfgStepper label="Ventana" value={`${plan.config.windowMin}'`}
                onMinus={() => updateConfig('windowMin', -1)} onPlus={() => updateConfig('windowMin', 1)} />
            </View>
            <Text style={styles.target}>
              {activePlayers.length} convocados → objetivo ≈ {fmt(targetSec)} c/u
              {activePlayers.length > S ? ` · descansan ${activePlayers.length - S} por ventana` : ''}
            </Text>
            {!plan.started && (
              <Text style={styles.hint}>Antes de iniciar podes marcar titulares tocando jugadores en la lista.</Text>
            )}
          </View>

          {/* Reloj */}
          <View style={[styles.card, timeUp && { borderColor: COLORS.gold }]}>
            <Text style={styles.clockBig}>{fmt(clockSec)} <Text style={styles.clockTotal}>/ {plan.config.totalMin}:00</Text></Text>
            {timeUp ? (
              <Text style={styles.timeUp}>TIEMPO CUMPLIDO</Text>
            ) : plan.started && countdown != null ? (
              <Text style={[styles.countdown, changeDue ? { color: COLORS.red2 } : countdown <= 30 ? { color: COLORS.gold } : null]}>
                {changeDue ? '¡TOCA CAMBIO!' : `Proximo cambio en ${fmt(countdown)}`}
              </Text>
            ) : null}
            <View style={styles.btnRow}>
              {running ? (
                <TouchableOpacity style={[styles.bigBtn, { backgroundColor: COLORS.gold + '22', borderColor: COLORS.gold }]} onPress={pause}>
                  <Text style={[styles.bigBtnText, { color: COLORS.gold }]}>PAUSAR</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.bigBtn, { backgroundColor: COLORS.green + '22', borderColor: COLORS.green }]} onPress={startOrResume}>
                  <Text style={[styles.bigBtnText, { color: COLORS.green }]}>{plan.started ? 'REANUDAR' : 'INICIAR PARTIDO'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Cambio sugerido */}
          {plan.started && canApply && (
            <View style={[styles.card, changeDue && { borderColor: COLORS.red2 }]}>
              <Text style={styles.cardTitle}>CAMBIO SUGERIDO</Text>
              <View style={{ gap: 6 }}>
                {proposal.sale.map((p) => (
                  <Text key={p.key} style={styles.swapLine}>
                    <Text style={{ color: COLORS.red2 }}>SALE</Text>  {p.nombre}  <Text style={styles.mins}>({fmt(playerSec(p))})</Text>
                  </Text>
                ))}
                {proposal.entra.map((p) => (
                  <Text key={p.key} style={styles.swapLine}>
                    <Text style={{ color: COLORS.green }}>ENTRA</Text>  {p.nombre}  <Text style={styles.mins}>({fmt(playerSec(p))})</Text>
                  </Text>
                ))}
              </View>
              <View style={styles.btnRow}>
                <TouchableOpacity style={[styles.bigBtn, { backgroundColor: COLORS.neon + '18', borderColor: COLORS.neon }]} onPress={applyProposal}>
                  <Text style={[styles.bigBtnText, { color: COLORS.neon }]}>APLICAR CAMBIO</Text>
                </TouchableOpacity>
                {changeDue && (
                  <TouchableOpacity style={[styles.bigBtn, { flex: 0.6, borderColor: COLORS.line }]} onPress={postponeProposal}>
                    <Text style={[styles.bigBtnText, { color: COLORS.gray2 }]}>+2 MIN</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* En cancha */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>EN CANCHA ({onFieldPlayers.length}/{S})</Text>
            {onFieldPlayers.map((p) => (
              <PlayerRow key={p.key} p={p} sec={playerSec(p)} target={targetSec}
                selected={selOut === p.key}
                onPress={() => plan.started ? setSelOut(selOut === p.key ? null : p.key) : toggleFieldPreset(p)}
                onLongPress={() => toggleActive(p)} field />
            ))}
            {onFieldPlayers.length < S && plan.started && (
              <Text style={[styles.hint, { color: COLORS.gold }]}>Cancha incompleta — aplica el cambio sugerido.</Text>
            )}
          </View>

          {/* Banca */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>BANCA ({benchPlayers.length})</Text>
            {benchPlayers.length === 0 && <Text style={styles.hint}>Sin suplentes disponibles.</Text>}
            {benchPlayers.map((p) => (
              <PlayerRow key={p.key} p={p} sec={playerSec(p)} target={targetSec}
                selected={selIn === p.key}
                onPress={() => plan.started ? setSelIn(selIn === p.key ? null : p.key) : toggleFieldPreset(p)}
                onLongPress={() => toggleActive(p)} />
            ))}
            {selOut && selIn && (
              <TouchableOpacity style={[styles.bigBtn, { backgroundColor: COLORS.blue2 + '22', borderColor: COLORS.blue2 }]} onPress={manualSwap}>
                <Text style={[styles.bigBtnText, { color: COLORS.blue2 }]}>CAMBIO MANUAL AHORA</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.hint}>
              {plan.started
                ? 'Cambio manual: toca uno EN CANCHA y uno de BANCA. Manten presionado para marcar lesion/salida.'
                : 'Toca para marcar titulares. Manten presionado para desconvocar.'}
            </Text>
          </View>

          {/* Desconvocados / lesionados */}
          {inactivePlayers.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>FUERA ({inactivePlayers.length})</Text>
              {inactivePlayers.map((p) => (
                <TouchableOpacity key={p.key} style={styles.playerRow} onPress={() => toggleActive(p)}>
                  <Text style={[styles.playerName, { color: COLORS.gray }]}>{p.nombre}</Text>
                  <Text style={styles.mins}>{fmt(p.playedSec)} · toca para reactivar</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Agregar gente */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AGREGAR</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <TextInput
                style={styles.input}
                placeholder="Nombre (llego tarde / no esta inscrito)"
                placeholderTextColor={COLORS.gray}
                value={newName}
                onChangeText={setNewName}
                onSubmitEditing={addManual}
              />
              <TouchableOpacity style={[styles.bigBtn, { flex: 0, paddingHorizontal: SPACING.md, borderColor: COLORS.neon }]} onPress={addManual}>
                <Text style={[styles.bigBtnText, { color: COLORS.neon }]}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={reloadRoster} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.hint, { color: COLORS.blue2 }]}>↻ Recargar inscritos del evento</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

function CfgStepper({ label, value, onMinus, onPlus, locked }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <TouchableOpacity disabled={locked} onPress={onMinus} style={[styles.stepBtn, locked && { opacity: 0.3 }]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity disabled={locked} onPress={onPlus} style={[styles.stepBtn, locked && { opacity: 0.3 }]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PlayerRow({ p, sec, target, onPress, onLongPress, selected, field }) {
  const diff = sec - target;
  return (
    <TouchableOpacity
      style={[styles.playerRow, field && styles.playerRowField, selected && styles.playerRowSel]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
    >
      <View style={[styles.dot, { backgroundColor: field ? COLORS.green : COLORS.gray }]} />
      <Text style={styles.playerName} numberOfLines={1}>{p.nombre}</Text>
      <Text style={[styles.playerTime, field && { color: COLORS.green }]}>{fmt(sec)}</Text>
      <Text style={[styles.diff, { color: diff > 60 ? COLORS.gold : diff < -60 ? COLORS.blue2 : COLORS.gray }]}>
        {diff >= 0 ? '+' : '−'}{fmt(Math.abs(diff))}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  back: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 13 },
  title: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.white, letterSpacing: 1, marginTop: SPACING.xs },
  sub: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2 },
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.line, padding: SPACING.md, gap: SPACING.sm,
  },
  cardTitle: { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray2, letterSpacing: 1.2 },
  cfgRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  stepper: { alignItems: 'center', flex: 1, gap: 4 },
  stepperLabel: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  stepperValue: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, minWidth: 44, textAlign: 'center' },
  stepBtn: {
    width: 30, height: 30, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card2,
  },
  stepBtnText: { fontFamily: FONTS.bodyBold, fontSize: 16, color: COLORS.white },
  target: { fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.neon },
  hint: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  clockBig: { fontFamily: FONTS.heading, fontSize: 52, color: COLORS.white, textAlign: 'center', letterSpacing: 2 },
  clockTotal: { fontSize: 22, color: COLORS.gray },
  countdown: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.gray2, textAlign: 'center' },
  timeUp: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.gold, textAlign: 'center', letterSpacing: 1 },
  btnRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  bigBtn: {
    flex: 1, minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', borderColor: COLORS.line,
  },
  bigBtnText: { fontFamily: FONTS.bodyBold, fontSize: 14, letterSpacing: 1 },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    minHeight: 44, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md,
    backgroundColor: COLORS.card2, borderWidth: 1, borderColor: 'transparent',
  },
  playerRowField: { borderColor: COLORS.green + '44' },
  playerRowSel: { borderColor: COLORS.blue2, backgroundColor: COLORS.blue2 + '18' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  playerName: { flex: 1, fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white },
  playerTime: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gray2, letterSpacing: 1 },
  diff: { fontFamily: FONTS.body, fontSize: 11, minWidth: 52, textAlign: 'right' },
  mins: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  swapLine: { fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white },
  input: {
    flex: 1, minHeight: 44, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.line,
    backgroundColor: COLORS.card2, color: COLORS.white, paddingHorizontal: SPACING.md,
    fontFamily: FONTS.body, fontSize: 14,
  },
  pickCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.line,
    padding: SPACING.md, gap: 2,
  },
  pickName: { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  pickSub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
});
