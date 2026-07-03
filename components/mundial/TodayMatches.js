// ============================================================
// TodayMatches — scoreboard en vivo de los partidos de HOY
// ============================================================
// Reemplaza al banner "JUGÁ EL MUNDIAL" en la pantalla de inicio.
// Lee wc_matches (sincronizado desde api-football por el cron
// wc-sync-results) y muestra los partidos del día con su marcador
// y estado (HOY / EN VIVO / FINAL). Solo informativo: el acceso al
// modulo Mundial queda en el tab inferior.
//
// "Hoy" = dia calendario en Panama (UTC-5, sin DST). La ventana se
// calcula en UTC para filtrar scheduled_at (timestamptz).
//
// flag_url de wc_teams hoy esta vacio -> se usa el codigo de 3 letras
// (MEX, ZAF, ...). Si se backfillea flag_url, basta sumar la imagen.
// ============================================================
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';

const mundialLogo = require('../../assets/mundial/mundial-logo.png');

const PA_OFFSET_MS = 5 * 3600 * 1000; // Panama = UTC-5 (sin DST)
const REFRESH_MS = 45000;             // refresco del marcador en vivo

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Parser robusto: Supabase puede devolver "2026-06-11 19:00:00+00" (espacio,
// offset corto) que Hermes no siempre parsea. Normaliza a ISO antes de Date().
function tsToMs(ts) {
  if (!ts) return 0;
  let s = String(ts).replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00'; // "+00" -> "+00:00"
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

// Ventana [00:00, 24:00) del dia actual de Panama, en epoch ms (UTC).
function paDayWindow() {
  const nowPa = new Date(Date.now() - PA_OFFSET_MS);
  const startMs = Date.UTC(nowPa.getUTCFullYear(), nowPa.getUTCMonth(), nowPa.getUTCDate(), 5, 0, 0);
  return { startIso: new Date(startMs).toISOString(), endMs: startMs + 86400000 };
}

function paTime(ts) {
  const pa = new Date(tsToMs(ts) - PA_OFFSET_MS);
  let h = pa.getUTCHours();
  const m = pa.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function paShortDate(ts) {
  const pa = new Date(tsToMs(ts) - PA_OFFSET_MS);
  return `${pa.getUTCDate()} ${MESES[pa.getUTCMonth()]}`;
}

function teamLabel(team, placeholder) {
  return team?.code || team?.name_es || team?.name || placeholder || '—';
}

// Banderas vía flagcdn (URL remota, sin archivos locales). Mapa code(3 letras
// de wc_teams) -> codigo flagcdn (ISO alpha-2 + casos internos de GB).
const FLAG_CC = {
  CZE: 'cz', KOR: 'kr', MEX: 'mx', ZAF: 'za',
  BIH: 'ba', CAN: 'ca', QAT: 'qa', SUI: 'ch',
  BRA: 'br', SCO: 'gb-sct', HAI: 'ht', MAR: 'ma',
  AUS: 'au', USA: 'us', PAR: 'py', TUR: 'tr',
  GER: 'de', CIV: 'ci', CUW: 'cw', ECU: 'ec',
  JPN: 'jp', NED: 'nl', SWE: 'se', TUN: 'tn',
  BEL: 'be', EGY: 'eg', IRN: 'ir', NZL: 'nz',
  KSA: 'sa', CPV: 'cv', ESP: 'es', URU: 'uy',
  FRA: 'fr', IRQ: 'iq', NOR: 'no', SEN: 'sn',
  DZA: 'dz', ARG: 'ar', AUT: 'at', JOR: 'jo',
  COL: 'co', POR: 'pt', COD: 'cd', UZB: 'uz',
  CRO: 'hr', GHA: 'gh', ENG: 'gb-eng', PAN: 'pa',
};

function flagUri(team) {
  const cc = team?.code ? FLAG_CC[team.code.toUpperCase()] : null;
  return cc ? `https://flagcdn.com/w40/${cc}.png` : null;
}

function Flag({ team }) {
  const uri = flagUri(team);
  if (!uri) return null;
  return <Image source={{ uri }} style={styles.flag} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

export default function TodayMatches({ enabled = true }) {
  const [state, setState] = useState({ loading: true, today: [], next: null });

  const load = useCallback(async () => {
    try {
      const { startIso, endMs } = paDayWindow();
      const { data: rows, error } = await supabase
        .from('wc_matches')
        .select('id, scheduled_at, status, score_home, score_away, penalties_home, penalties_away, went_to_penalties, phase, group_letter, home_placeholder, away_placeholder, team_home_id, team_away_id')
        .gte('scheduled_at', startIso)
        .order('scheduled_at')
        .limit(16);
      if (error) throw error;

      const all = rows ?? [];
      const today = all.filter((r) => tsToMs(r.scheduled_at) < endMs);
      const next = all.find((r) => tsToMs(r.scheduled_at) >= endMs) ?? null;

      const shown = [...today, ...(next ? [next] : [])];
      const ids = [...new Set(shown.flatMap((r) => [r.team_home_id, r.team_away_id]).filter(Boolean))];
      const matchIds = shown.map((r) => r.id);

      // Equipos (nombre/código) + marcador EN VIVO desde wc_results (el RPC de
      // sync escribe ahí el feed del api mientras el partido va; wc_matches.score
      // solo se setea al finalizar = resultado oficial).
      const [teamsRes, liveRes] = await Promise.all([
        ids.length
          ? supabase.from('wc_teams').select('id, code, name_es, name').in('id', ids)
          : Promise.resolve({ data: [] }),
        matchIds.length
          ? supabase.from('wc_results').select('match_id, api_score_home, api_score_away').in('match_id', matchIds)
          : Promise.resolve({ data: [] }),
      ]);
      const teamMap = (teamsRes.data ?? []).reduce((acc, t) => { acc[t.id] = t; return acc; }, {});
      const liveMap = (liveRes.data ?? []).reduce((acc, r) => { acc[r.match_id] = r; return acc; }, {});

      const hydrate = (r) => (r ? {
        ...r,
        home: teamMap[r.team_home_id] ?? null,
        away: teamMap[r.team_away_id] ?? null,
        live: liveMap[r.id] ?? null,
      } : null);
      setState({ loading: false, today: today.map(hydrate), next: hydrate(next) });
    } catch (_) {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, load]);

  if (!enabled) return null;
  const { loading, today, next } = state;

  // Carga inicial: placeholder minimo para no saltar el layout.
  if (loading && today.length === 0 && !next) {
    return (
      <View style={styles.card} dataSet={{ t2Glass: '' }}>
        <Header live={false} />
        <ActivityIndicator color={COLORS.neon} style={{ paddingVertical: SPACING.md }} />
      </View>
    );
  }

  // Sin partidos hoy: anuncio compacto del proximo. Si no hay ninguno, no renderiza.
  if (today.length === 0) {
    if (!next) return null;
    return (
      <View style={styles.card} dataSet={{ t2Glass: '' }}>
        <Header live={false} title="MUNDIAL 2026" />
        <View style={styles.nextRow}>
          <Text style={styles.nextLabel}>PRÓXIMO PARTIDO</Text>
          <Text style={styles.nextMatch} numberOfLines={1}>
            {teamLabel(next.home, next.home_placeholder)}  vs  {teamLabel(next.away, next.away_placeholder)}
          </Text>
          <Text style={styles.nextMeta}>{paShortDate(next.scheduled_at)} · {paTime(next.scheduled_at)}</Text>
        </View>
      </View>
    );
  }

  const anyLive = today.some((m) => m.status === 'live');
  return (
    <View style={styles.card} dataSet={anyLive ? { t2Glass: '', t2Glow: 'mid' } : { t2Glass: '' }}>
      <Header live={anyLive} />
      {today.map((m, i) => (
        <MatchRow key={m.id} m={m} last={i === today.length - 1} />
      ))}
    </View>
  );
}

function Header({ live, title = 'PARTIDOS DE HOY' }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Image source={mundialLogo} style={styles.headerLogo} resizeMode="contain" />
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {live ? (
        <View style={styles.liveChip}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>EN VIVO</Text>
        </View>
      ) : (
        <Text style={styles.headerKicker}>vía api-football</Text>
      )}
    </View>
  );
}

function MatchRow({ m, last }) {
  const isLive = m.status === 'live';
  const isFinished = m.status === 'finished';
  const isOff = m.status === 'postponed' || m.status === 'cancelled';

  // Marcador segun estado: finished = oficial (wc_matches, respeta admin_override);
  // live = feed del api (wc_results, 0-0 si aun no llega); resto = sin marcador.
  let sh = null;
  let sa = null;
  if (isFinished) { sh = m.score_home; sa = m.score_away; }
  else if (isLive) { sh = m.live?.api_score_home ?? 0; sa = m.live?.api_score_away ?? 0; }
  const hasScore = sh != null && sa != null;
  const showPens = isFinished && m.went_to_penalties && m.penalties_home != null && m.penalties_away != null;

  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.side, styles.sideHome]}>
        <Text style={styles.code} numberOfLines={1}>{teamLabel(m.home, m.home_placeholder)}</Text>
        <Flag team={m.home} />
      </View>

      <View style={styles.center}>
        {hasScore ? (
          <Text style={[styles.score, isLive && styles.scoreLive]}>{sh}-{sa}</Text>
        ) : isOff ? (
          <Text style={styles.vs}>—</Text>
        ) : (
          <Text style={styles.time}>{paTime(m.scheduled_at)}</Text>
        )}
        {showPens && <Text style={styles.pens}>pen {m.penalties_home}-{m.penalties_away}</Text>}
        <StatusTag status={m.status} />
      </View>

      <View style={[styles.side, styles.sideAway]}>
        <Flag team={m.away} />
        <Text style={styles.code} numberOfLines={1}>{teamLabel(m.away, m.away_placeholder)}</Text>
      </View>
    </View>
  );
}

function StatusTag({ status }) {
  if (status === 'live') return <Text style={[styles.tag, styles.tagLive]}>EN VIVO</Text>;
  if (status === 'finished') return <Text style={[styles.tag, styles.tagFinal]}>FINAL</Text>;
  if (status === 'postponed') return <Text style={[styles.tag, styles.tagOff]}>APLAZADO</Text>;
  if (status === 'cancelled') return <Text style={[styles.tag, styles.tagOff]}>CANCELADO</Text>;
  return <Text style={[styles.tag, styles.tagSched]}>HOY</Text>;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.bg2 ?? '#0A0E14',
    borderWidth: 1.5,
    borderColor: COLORS.magenta,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    ...SHADOWS.glow,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACING.sm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexShrink: 1 },
  headerLogo: { width: 24, height: 24, borderRadius: 5 },
  headerTitle: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 1.2,
  },
  headerKicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 9,
    color: COLORS.gray2,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: (COLORS.red2 ?? '#FF3B1F') + '22',
    borderColor: COLORS.red2 ?? '#FF3B1F',
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.red2 ?? '#FF3B1F' },
  liveText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 9,
    color: COLORS.red2A11y ?? COLORS.red2 ?? '#FF3B1F',
    letterSpacing: 1.2,
  },

  // ── Fila de partido ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line + '88',
  },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sideHome: { justifyContent: 'flex-end' },
  sideAway: { justifyContent: 'flex-start' },
  code: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.white,
    letterSpacing: 1.5,
  },
  flag: {
    width: 26,
    height: 18,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
    backgroundColor: COLORS.card,
  },

  center: { minWidth: 92, alignItems: 'center', paddingHorizontal: SPACING.sm },
  score: {
    fontFamily: FONTS.heading,
    fontSize: 24,
    color: COLORS.white,
    letterSpacing: 1,
  },
  scoreLive: { color: COLORS.neon },
  time: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.gray2,
    letterSpacing: 1,
  },
  vs: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gray, letterSpacing: 1 },
  pens: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: COLORS.gray2,
    marginTop: 1,
  },
  tag: {
    fontFamily: FONTS.bodyBold,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  tagLive: { color: COLORS.red2A11y ?? COLORS.red2 ?? '#FF3B1F' },
  tagFinal: { color: COLORS.gray2 },
  tagSched: { color: COLORS.neon },
  tagOff: { color: COLORS.gold ?? '#FFD700' },

  // ── Sin partidos hoy: proximo ──
  nextRow: { paddingVertical: SPACING.sm, alignItems: 'center' },
  nextLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 9,
    color: COLORS.gray2,
    letterSpacing: 1.5,
  },
  nextMatch: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.white,
    letterSpacing: 1,
    marginTop: 4,
  },
  nextMeta: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginTop: 2,
  },
});
