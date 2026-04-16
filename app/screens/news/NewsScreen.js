import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Image, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { useAppRefresh } from '../../../hooks/useAppRefresh';

const FILTERS = ['Todo', 'Noticia', 'Resultados', 'MVP', 'Torneo'];

export default function NewsScreen() {
  const [newsItems, setNewsItems]   = useState([]);
  const [mvps,      setMvps]        = useState([]);
  const [filter,    setFilter]      = useState('Todo');
  const [loading,   setLoading]     = useState(true);
  const [expanded,  setExpanded]    = useState(null);

  const fetch = async () => {
    const [{ data: news }, { data: mvpData }] = await Promise.all([
      supabase.from('news').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('mvp_results')
        .select('*, users(nombre, foto_url), matches(event_id, events(nombre))')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
    setNewsItems(news ?? []);
    setMvps(mvpData ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetch();
    // Escuchar nuevas noticias en tiempo real
    const ch = supabase.channel('news-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, () => fetch())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mvp_results' }, () => fetch())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const { refreshing, onRefresh } = useAppRefresh(fetch);

  const filtered = filter === 'Todo'
    ? newsItems
    : newsItems.filter((i) => i.tipo?.toLowerCase() === filter.toLowerCase());

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>NOTICIAS</Text>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.xl }} />
        : (
          <FlatList
            data={filter === 'MVP' ? [] : filtered}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
            ListHeaderComponent={() => (
              (filter === 'Todo' || filter === 'MVP') && mvps.length > 0 ? (
                <View style={styles.mvpSection}>
                  <Text style={styles.sectionTitle}>🏆 HALL OF FAME — MVPs</Text>
                  {mvps.map((m) => (
                    <View key={m.id} style={styles.mvpCard}>
                      <View style={styles.mvpAvatarWrap}>
                        {m.users?.foto_url
                          ? <Image source={{ uri: m.users.foto_url }} style={styles.mvpAvatar} />
                          : <View style={styles.mvpAvatarPlaceholder}>
                              <Text style={styles.mvpInitial}>{m.users?.nombre?.[0]}</Text>
                            </View>
                        }
                      </View>
                      <View style={styles.mvpInfo}>
                        <Text style={styles.mvpName}>{m.users?.nombre}</Text>
                        <Text style={styles.mvpEvent}>{m.matches?.events?.nombre ?? 'Evento'}</Text>
                        <Text style={styles.mvpStats}>{m.votos_totales} votos · +${m.premio_wallet?.toFixed(2)}</Text>
                      </View>
                      <Text style={{ fontSize: 28 }}>🏆</Text>
                    </View>
                  ))}
                </View>
              ) : null
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.newsCard}
                onPress={() => setExpanded(expanded === item.id ? null : item.id)}
                activeOpacity={0.85}
              >
                {item.imagen_url && (
                  <Image source={{ uri: item.imagen_url }} style={styles.newsImage} />
                )}
                <View style={styles.newsBody}>
                  <View style={styles.newsMeta}>
                    <View style={[styles.tipoBadge, { backgroundColor: tipoColor(item.tipo) + '30' }]}>
                      <Text style={[styles.tipoText, { color: tipoColor(item.tipo) }]}>
                        {(item.tipo ?? 'NOTICIA').toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.newsDate}>
                      {new Date(item.created_at).toLocaleDateString('es-PA', { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                  <Text style={styles.newsTitle}>{item.titulo}</Text>
                  {expanded === item.id
                    ? <Text style={styles.newsContent}>{item.contenido}</Text>
                    : <Text style={styles.newsExcerpt} numberOfLines={2}>{item.contenido}</Text>
                  }
                  <Text style={styles.readMore}>{expanded === item.id ? 'Ver menos ↑' : 'Leer más →'}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              filter !== 'MVP'
                ? <Text style={styles.empty}>No hay noticias disponibles</Text>
                : null
            }
          />
        )
      }
    </SafeAreaView>
  );
}

function tipoColor(tipo) {
  const map = {
    noticia:    COLORS.blue2,
    resultados: COLORS.green,
    mvp:        COLORS.gold,
    torneo:     COLORS.red,
  };
  return map[tipo?.toLowerCase()] ?? COLORS.gray;
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: COLORS.bg },
  title:       { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },
  filterRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  chip:        { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy },
  chipActive:  { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipText:    { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  chipTextActive:{ color: COLORS.white, fontFamily: FONTS.bodyMedium },
  list:        { padding: SPACING.md, gap: SPACING.sm },
  mvpSection:  { marginBottom: SPACING.md, gap: SPACING.sm },
  sectionTitle:{ fontFamily: FONTS.heading, fontSize: 20, color: COLORS.gold, letterSpacing: 2, marginBottom: SPACING.sm },
  mvpCard:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.gold + '40' },
  mvpAvatarWrap:{ position: 'relative' },
  mvpAvatar:   { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: COLORS.gold },
  mvpAvatarPlaceholder:{ width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.gold + '30', alignItems: 'center', justifyContent: 'center' },
  mvpInitial:  { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gold },
  mvpInfo:     { flex: 1 },
  mvpName:     { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  mvpEvent:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginTop: 2 },
  mvpStats:    { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.gold, marginTop: 2 },
  newsCard:    { backgroundColor: COLORS.card, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.navy },
  newsImage:   { width: '100%', height: 160, resizeMode: 'cover' },
  newsBody:    { padding: SPACING.md, gap: SPACING.sm },
  newsMeta:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tipoBadge:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  tipoText:    { fontFamily: FONTS.bodyMedium, fontSize: 10, letterSpacing: 1 },
  newsDate:    { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  newsTitle:   { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.white },
  newsExcerpt: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 20 },
  newsContent: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 20 },
  readMore:    { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.blue2 },
  empty:       { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
});
