import React, { useEffect, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';

export default function PlayerProfileScreen({ route, navigation }) {
  const { userId } = route.params;
  const [player,   setPlayer]   = useState(null);
  const [stats,    setStats]    = useState({ eventos: 0, mvps: 0, deportes: [] });
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { loadPlayer(); }, [userId]);

  async function loadPlayer() {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [
        { data: u, error: uErr },
        { data: regs },
        { data: mvps },
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', userId).single(),
        supabase.from('event_registrations')
          .select('event_id, events(deporte)')
          .eq('user_id', userId)
          .eq('status', 'confirmed'),
        supabase.from('mvp_results')
          .select('id')
          .eq('user_id', userId),
      ]);
      if (uErr) throw uErr;

      setPlayer(u);

      // Deportes únicos jugados
      const deportesSet = new Set(
        (regs ?? [])
          .map(r => r.events?.deporte)
          .filter(Boolean)
          .flatMap(d => d.split(', '))
      );

      setStats({
        eventos:  regs?.length ?? 0,
        mvps:     mvps?.length ?? 0,
        deportes: [...deportesSet],
      });
    } catch (e) {
      console.warn('PlayerProfileScreen loadPlayer error:', e.message);
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  if (!player) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15 }}>No se encontró el perfil del jugador.</Text>
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.blue2 }}>← Volver</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const initial    = player.nombre?.[0]?.toUpperCase();
  const rolColors  = { admin: COLORS.purple, gestor: COLORS.blue, player: COLORS.navy };
  const rolLabels  = { admin: 'ADMIN', gestor: 'GESTOR', player: 'JUGADOR' };
  const generoColor = player.genero === 'Femenino' ? '#8B1A5A' : '#1A6B8A';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>PERFIL</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          {player.foto_url
            ? <Image source={{ uri: player.foto_url }} style={styles.avatar} />
            : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )
          }
          <Text style={styles.name}>{player.nombre}</Text>

          {/* Badges */}
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: rolColors[player.role] ?? COLORS.navy }]}>
              <Text style={styles.badgeText}>{rolLabels[player.role] ?? player.role?.toUpperCase()}</Text>
            </View>
            {player.genero && (
              <View style={[styles.badge, { backgroundColor: generoColor }]}>
                <Text style={styles.badgeText}>{player.genero === 'Masculino' ? '♂ MASCULINO' : '♀ FEMENINO'}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBox icon="📅" value={stats.eventos} label="Eventos" />
          <StatBox icon="🏆" value={stats.mvps}    label="MVPs" />
          <StatBox icon="⚽" value={player.actividades_completadas ?? 0} label="Actividades" />
        </View>

        {/* Info */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>INFORMACIÓN</Text>
          {player.nivel    && <InfoRow label="Nivel"     value={player.nivel} />}
          {player.posicion && <InfoRow label="Posición"  value={player.posicion} />}
          {player.residencia && <InfoRow label="Ciudad"  value={player.residencia} />}
        </View>

        {/* Deportes jugados */}
        {stats.deportes.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>DEPORTES JUGADOS</Text>
            <View style={styles.chips}>
              {stats.deportes.map(d => (
                <View key={d} style={styles.chip}>
                  <Text style={styles.chipText}>{d}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ icon, value, label }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: COLORS.bg },
  topBar:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md },
  back:            { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white },
  topTitle:        { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 3 },
  hero:            { alignItems: 'center', paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md },
  avatar:          { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: COLORS.blue, marginBottom: SPACING.sm },
  avatarPlaceholder:{ width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm, borderWidth: 2, borderColor: COLORS.blue },
  avatarInitial:   { fontFamily: FONTS.heading, fontSize: 44, color: COLORS.white },
  name:            { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 2, marginBottom: SPACING.sm },
  badges:          { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap', justifyContent: 'center' },
  badge:           { paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.full },
  badgeText:       { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white, letterSpacing: 1 },
  statsRow:        { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  statBox:         { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy },
  statIcon:        { fontSize: 22, marginBottom: 2 },
  statVal:         { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white },
  statLabel:       { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  card:            { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, marginHorizontal: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  sectionTitle:    { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, letterSpacing: 2, marginBottom: SPACING.sm },
  row:             { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.navy },
  rowLabel:        { fontFamily: FONTS.bodyMedium, color: COLORS.gray, fontSize: 13 },
  rowVal:          { fontFamily: FONTS.body, color: COLORS.white, fontSize: 13 },
  chips:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:            { backgroundColor: COLORS.navy, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.blue },
  chipText:        { fontFamily: FONTS.body, color: COLORS.white, fontSize: 12 },
});
