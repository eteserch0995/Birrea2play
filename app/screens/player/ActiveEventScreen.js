import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { formatScore, formatCountdown } from '../../../lib/eventHelpers';
import useAuthStore from '../../../store/authStore';
import PlayerAvatar from '../../../components/PlayerAvatar';

// Formatos que tienen tabla de posiciones
const FORMATS_WITH_TABLE = ['Liga', 'Torneo'];

export default function ActiveEventScreen({ route, navigation }) {
  const { eventId } = route.params;
  const { user } = useAuthStore();

  const [event,      setEvent]      = useState(null);
  const [teams,      setTeams]      = useState([]);
  const [matches,    setMatches]    = useState([]);
  const [standings,  setStandings]  = useState([]);
  const [players,    setPlayers]    = useState([]);
  const [mvpResult,     setMvpResult]     = useState(null);    // event MVP winner or null
  const [mvpHasVoted,   setMvpHasVoted]   = useState(false);   // user already voted this event
  const [mvpVoteCount,  setMvpVoteCount]  = useState(0);       // total votes so far
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState('Partidos');

  // MVP vote modal state
  const [voteModal,     setVoteModal]     = useState(false);   // show candidate list
  const [voting,        setVoting]        = useState(false);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: t }, { data: m }, { data: regs }] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('teams').select('*').eq('event_id', eventId),
      supabase.from('matches')
        .select('*, home:team_home_id(nombre,color), away:team_away_id(nombre,color)')
        .eq('event_id', eventId)
        .order('jornada'),
      supabase.from('event_registrations')
        .select('*, users(nombre, foto_url)')
        .eq('event_id', eventId)
        .eq('status', 'confirmed'),
    ]);

    setEvent(ev);
    setTeams(t ?? []);
    setMatches(m ?? []);
    setPlayers(regs ?? []);

    // Standings for Liga / Torneo
    if (FORMATS_WITH_TABLE.includes(ev?.formato)) {
      const { data: st } = await supabase
        .from('standings')
        .select('*')
        .eq('event_id', eventId)
        .order('pts', { ascending: false });
      setStandings(st ?? []);
    }

    // Event-level MVP data
    const [{ data: evMvpResult }, { data: myVoteData }, { data: allVotesData }] = await Promise.all([
      supabase.from('mvp_results').select('*, users(nombre, foto_url)').eq('event_id', eventId).maybeSingle(),
      user?.id
        ? supabase.from('mvp_votes').select('id').eq('event_id', eventId).eq('voter_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('mvp_votes').select('id').eq('event_id', eventId),
    ]);
    setMvpResult(evMvpResult ?? null);
    setMvpHasVoted(!!myVoteData);
    setMvpVoteCount((allVotesData ?? []).length);

    setLoading(false);
  }, [eventId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function submitVote(votedForId) {
    if (!user?.id) return;
    setVoting(true);
    const { error } = await supabase.from('mvp_votes').insert({
      event_id:     eventId,
      voter_id:     user.id,
      voted_for_id: votedForId,
    });
    setVoting(false);
    setVoteModal(false);
    if (error) {
      Alert.alert('Error', error.code === '23505' ? 'Ya votaste en este evento.' : error.message);
      return;
    }
    setMvpHasVoted(true);
    setMvpVoteCount((c) => c + 1);
  }

  // Compute standings from matches when DB standings are empty
  const computedStandings = useCallback(() => {
    const table = {};
    teams.forEach((t) => {
      table[t.id] = { equipo: t.nombre, grupo: t.grupo ?? 'A', pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0 };
    });
    matches.filter((m) => m.status === 'finished').forEach((m) => {
      const gh = m.goles_home ?? 0;
      const ga = m.goles_away ?? 0;
      const h = table[m.team_home_id];
      const a = table[m.team_away_id];
      if (h) { h.pj++; h.gf += gh; h.gc += ga; if (gh > ga) { h.pg++; h.pts += 3; } else if (gh === ga) { h.pe++; h.pts += 1; } else h.pp++; }
      if (a) { a.pj++; a.gf += ga; a.gc += gh; if (ga > gh) { a.pg++; a.pts += 3; } else if (gh === ga) { a.pe++; a.pts += 1; } else a.pp++; }
    });
    return Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.gc) - (a.gf - a.gc));
  }, [teams, matches]);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  if (!event)  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15 }}>No se pudo cargar el evento.</Text>
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.blue2 }}>← Volver</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const hasTable  = FORMATS_WITH_TABLE.includes(event.formato);
  const TABS      = hasTable
    ? ['Partidos', 'Tabla', 'MVP', 'Jugadores']
    : ['Partidos', 'MVP', 'Jugadores'];

  const tableData  = standings.length > 0 ? standings : computedStandings();
  const grupos     = [...new Set(tableData.map((r) => r.grupo ?? 'A'))];
  const multiGroup = grupos.length > 1;

  // Group matches by jornada
  const byJornada = matches.reduce((acc, m) => {
    const k = m.jornada ?? 1;
    acc[k] = [...(acc[k] ?? []), m];
    return acc;
  }, {});

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{event.nombre}</Text>
          <Text style={styles.headerSub}>
            {event.deporte ?? 'Fútbol'} · {event.formato}
            {hasTable ? ' · Tabla activa' : ' · Sin tabla'}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
        contentContainerStyle={styles.content}
      >

        {/* ══════════════ PARTIDOS ══════════════ */}
        {tab === 'Partidos' && (
          Object.keys(byJornada).length === 0
            ? <Text style={styles.empty}>No hay partidos generados aún</Text>
            : Object.entries(byJornada).map(([jornada, rMatches]) => (
                <View key={jornada}>
                  <View style={styles.jornadaHeader}>
                    <Text style={styles.jornadaTitle}>
                      {rMatches[0]?.fase === 'final' ? '🏆 FINAL'
                        : rMatches[0]?.fase === 'semis' ? '🥊 SEMIS'
                        : `JORNADA ${jornada}`}
                    </Text>
                    <View style={[styles.faseBadge, { backgroundColor: rMatches[0]?.fase === 'final' ? COLORS.gold + '30' : COLORS.navy }]}>
                      <Text style={[styles.faseText, { color: rMatches[0]?.fase === 'final' ? COLORS.gold : COLORS.gray }]}>
                        {(rMatches[0]?.fase ?? 'grupos').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  {rMatches.map((m) => (
                    <View key={m.id} style={[styles.matchCard, m.status === 'finished' && styles.matchCardDone]}>
                      <View style={styles.matchRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          {m.home?.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.home.color, marginRight: 4 }} />}
                          <Text style={styles.teamName} numberOfLines={1}>{m.home?.nombre ?? m.equipo_local}</Text>
                        </View>
                        <View style={styles.scoreWrap}>
                          {m.status === 'finished'
                            ? <Text style={styles.score}>{m.goles_home ?? 0} - {m.goles_away ?? 0}</Text>
                            : <Text style={styles.scorePending}>VS</Text>
                          }
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                          <Text style={[styles.teamName, { textAlign: 'right' }]} numberOfLines={1}>{m.away?.nombre ?? m.equipo_visitante}</Text>
                          {m.away?.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.away.color, marginLeft: 4 }} />}
                        </View>
                      </View>
                      {m.status === 'finished' && (
                        <Text style={styles.matchDoneTag}>✓ Finalizado</Text>
                      )}
                    </View>
                  ))}
                </View>
              ))
        )}

        {/* ══════════════ TABLA ══════════════ */}
        {tab === 'Tabla' && hasTable && (
          tableData.length === 0
            ? <Text style={styles.empty}>Sin resultados aún — la tabla se actualiza al registrar partidos</Text>
            : multiGroup
              ? grupos.map((grupo) => (
                  <View key={grupo} style={{ marginBottom: SPACING.lg }}>
                    <Text style={styles.grupoTitle}>GRUPO {grupo}</Text>
                    <StandingsTable rows={tableData.filter((r) => (r.grupo ?? 'A') === grupo)} />
                  </View>
                ))
              : <StandingsTable rows={tableData} />
        )}

        {/* ══════════════ MVP ══════════════ */}
        {tab === 'MVP' && (() => {
          const votingOpen = event?.mvp_voting_open && !mvpResult;
          const closesAt   = event?.mvp_closes_at ? new Date(event.mvp_closes_at) : null;
          const expired    = closesAt && closesAt < new Date();
          const countdown  = formatCountdown(event?.mvp_closes_at);
          return (
            <View style={[styles.matchCard, { gap: SPACING.md }]}>
              <Text style={styles.mvpMatchTitle}>🏆 MVP DEL EVENTO</Text>

              {mvpResult ? (
                // Winner declared
                <View style={styles.mvpWinner}>
                  <Text style={styles.mvpWinnerLabel}>🥇 MVP</Text>
                  <Text style={styles.mvpWinnerName}>{mvpResult.users?.nombre}</Text>
                  <Text style={styles.cardSub}>{mvpResult.votos_totales} votos · +$1 ganado</Text>
                </View>
              ) : votingOpen ? (
                // Voting open
                <>
                  <View style={styles.voteRow}>
                    <Text style={[styles.cardSub, { color: COLORS.blue }]}>
                      ⏱ {expired ? 'Votación expirada' : countdown}
                    </Text>
                    <Text style={styles.cardSub}>{mvpVoteCount} voto{mvpVoteCount !== 1 ? 's' : ''}</Text>
                  </View>
                  {mvpHasVoted ? (
                    <View style={styles.votedBadge}>
                      <Text style={styles.votedText}>✅ Ya votaste</Text>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.voteBtn} onPress={() => setVoteModal(true)}>
                      <Text style={styles.voteBtnText}>⭐ Votar por el MVP</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <Text style={[styles.cardSub, { color: COLORS.gray }]}>
                  La votación MVP aún no ha sido abierta por el organizador.
                </Text>
              )}
            </View>
          );
        })()}

        {/* ══════════════ JUGADORES ══════════════ */}
        {tab === 'Jugadores' && (
          players.length === 0
            ? <Text style={styles.empty}>No hay jugadores inscritos</Text>
            : players.map((r) => (
                <View key={r.id} style={styles.playerRow}>
                  <PlayerAvatar user={r.users} size={44} borderColor={COLORS.blue} />
                  <View>
                    <Text style={styles.playerName}>{r.users?.nombre}</Text>
                    <Text style={styles.playerSub}>
                      {r.metodo_pago === 'wallet' ? '💰' : '📱'} ${r.monto_pagado?.toFixed(2)}
                    </Text>
                  </View>
                </View>
              ))
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* ══════════════ MODAL VOTAR MVP ══════════════ */}
      <Modal visible={voteModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>⭐ Votar por el MVP</Text>
            <Text style={styles.modalSub}>Selecciona el jugador más valioso del evento</Text>
            {players.length === 0 ? (
              <Text style={styles.empty}>No hay jugadores registrados</Text>
            ) : (
              <FlatList
                data={players.filter(p => p.user_id !== user?.id)}
                keyExtractor={(p) => p.user_id}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.playerVoteRow}
                    onPress={() => submitVote(item.user_id)}
                    disabled={voting}
                  >
                    <PlayerAvatar user={item.users} size={40} borderColor={COLORS.navy} />
                    <Text style={styles.playerVoteName}>{item.users?.nombre}</Text>
                    {voting ? <ActivityIndicator color={COLORS.gold} /> : <Text style={styles.voteStar}>⭐</Text>}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: COLORS.navy }} />}
              />
            )}
            <TouchableOpacity
              style={[styles.voteBtn, { backgroundColor: COLORS.gray, marginTop: SPACING.md }]}
              onPress={() => setVoteModal(false)}
            >
              <Text style={styles.voteBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Componente tabla de posiciones ────────────────────────────────────────────
function StandingsTable({ rows }) {
  return (
    <View>
      <View style={tableStyles.header}>
        <Text style={[tableStyles.cell, tableStyles.teamCell]}>Equipo</Text>
        <Text style={tableStyles.cell}>PJ</Text>
        <Text style={tableStyles.cell}>G</Text>
        <Text style={tableStyles.cell}>E</Text>
        <Text style={tableStyles.cell}>P</Text>
        <Text style={tableStyles.cell}>GF</Text>
        <Text style={tableStyles.cell}>GC</Text>
        <Text style={tableStyles.cell}>GD</Text>
        <Text style={[tableStyles.cell, tableStyles.ptsCell]}>PTS</Text>
      </View>
      {rows.map((r, i) => (
        <View key={r.team_id ?? r.equipo ?? i} style={[tableStyles.row, i % 2 === 0 && tableStyles.rowAlt]}>
          <View style={[tableStyles.posWrap, { backgroundColor: i === 0 ? COLORS.gold + '30' : i === 1 ? COLORS.gray + '20' : 'transparent' }]}>
            <Text style={[tableStyles.pos, { color: i === 0 ? COLORS.gold : i === 1 ? COLORS.gray2 : COLORS.gray }]}>{i + 1}</Text>
          </View>
          <Text style={[tableStyles.val, tableStyles.teamCell]} numberOfLines={1}>{r.equipo}</Text>
          <Text style={tableStyles.val}>{r.pj ?? 0}</Text>
          <Text style={tableStyles.val}>{r.pg ?? 0}</Text>
          <Text style={tableStyles.val}>{r.pe ?? 0}</Text>
          <Text style={tableStyles.val}>{r.pp ?? 0}</Text>
          <Text style={tableStyles.val}>{r.gf ?? 0}</Text>
          <Text style={tableStyles.val}>{r.gc ?? 0}</Text>
          <Text style={tableStyles.val}>{(r.gf ?? 0) - (r.gc ?? 0)}</Text>
          <Text style={[tableStyles.val, tableStyles.ptsVal]}>{r.pts ?? 0}</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm, paddingHorizontal: 4 }}>
        <LegendDot color={COLORS.gold}  label="1° clasificado" />
        <LegendDot color={COLORS.gray2} label="2° clasificado" />
      </View>
    </View>
  );
}

function LegendDot({ color, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray }}>{label}</Text>
    </View>
  );
}

const tableStyles = StyleSheet.create({
  header:   { flexDirection: 'row', backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 },
  row:      { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, borderRadius: RADIUS.sm, alignItems: 'center' },
  rowAlt:   { backgroundColor: COLORS.card },
  cell:     { flex: 1, fontFamily: FONTS.bodyMedium, fontSize: 11, color: COLORS.gray, textAlign: 'center' },
  teamCell: { flex: 3, textAlign: 'left' },
  ptsCell:  { color: COLORS.gold },
  posWrap:  { width: 20, alignItems: 'center', borderRadius: 4, marginRight: 4 },
  pos:      { fontFamily: FONTS.bodyBold, fontSize: 11 },
  val:      { flex: 1, fontFamily: FONTS.body, fontSize: 12, color: COLORS.white, textAlign: 'center' },
  ptsVal:   { fontFamily: FONTS.bodyBold, color: COLORS.gold },
});

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: COLORS.bg },
  header:         { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
  back:           { padding: 4 },
  backText:       { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  headerInfo:     { flex: 1 },
  headerTitle:    { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1 },
  headerSub:      { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  tabScroll:      { flexGrow: 0 },
  tabRow:         { paddingHorizontal: SPACING.md, gap: SPACING.sm, marginBottom: SPACING.sm },
  tab:            { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.card, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy },
  tabActive:      { backgroundColor: COLORS.red, borderColor: COLORS.red },
  tabText:        { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  tabTextActive:  { color: COLORS.white, fontFamily: FONTS.bodyMedium },
  content:        { paddingHorizontal: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl },
  jornadaHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.sm, marginBottom: 4 },
  jornadaTitle:   { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, letterSpacing: 2 },
  faseBadge:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  faseText:       { fontFamily: FONTS.bodyMedium, fontSize: 10, letterSpacing: 1 },
  matchCard:      { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, marginBottom: SPACING.sm },
  matchCardDone:  { borderColor: COLORS.green + '40' },
  matchRow:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  teamName:       { flex: 1, fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white },
  scoreWrap:      { minWidth: 72, alignItems: 'center' },
  score:          { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.gold },
  scorePending:   { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.gray },
  matchDoneTag:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.green, textAlign: 'center', marginTop: 4 },
  grupoTitle:     { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 2, marginBottom: SPACING.sm },
  cardSub:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  // MVP tab
  mvpMatchTitle:  { fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white },
  mvpWinner:      { backgroundColor: COLORS.gold + '15', borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center', gap: 2 },
  mvpWinnerLabel: { fontFamily: FONTS.heading, fontSize: 12, color: COLORS.gold, letterSpacing: 2 },
  mvpWinnerName:  { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
  voteRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  votedBadge:     { backgroundColor: COLORS.green + '20', borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center' },
  votedText:      { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.green },
  voteBtn:        { backgroundColor: COLORS.gold, borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center' },
  voteBtnText:    { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  // Jugadores
  playerRow:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  playerName:     { fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white },
  playerSub:      { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  empty:          { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
  // Vote modal
  overlay:        { flex: 1, backgroundColor: '#000000BB', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.lg ?? 16, borderTopRightRadius: RADIUS.lg ?? 16, padding: SPACING.lg, gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy, maxHeight: '75%' },
  modalTitle:     { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  modalSub:       { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13 },
  playerVoteRow:  { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
  playerVoteName: { flex: 1, fontFamily: FONTS.bodyMedium, fontSize: 15, color: COLORS.white },
  voteStar:       { fontSize: 20 },
});
