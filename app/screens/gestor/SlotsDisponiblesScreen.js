import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('es-PA', { weekday: 'long', day: '2-digit', month: 'long' });
}
function fmtTime(t) { return t?.slice(0, 5) ?? ''; }
function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function SlotsDisponiblesScreen({ navigation }) {
  const { user } = useAuthStore();
  const [slots, setSlots]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSlots = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cancha_slots')
        .select(`
          id, fecha, hora_inicio, hora_fin, precio_hora,
          visibility, reserved_for_gestor_id, status, notas,
          canchas:cancha_id ( id, nombre, direccion, telefono )
        `)
        .gte('fecha', todayIso())
        .eq('status', 'available')
        .or(`visibility.eq.public,reserved_for_gestor_id.eq.${user.id}`)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true });
      if (error) throw error;
      setSlots(data ?? []);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudieron cargar los slots');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  async function handleClaim(slot) {
    Alert.alert(
      'Reclamar slot',
      `${fmtDate(slot.fecha)}\n${fmtTime(slot.hora_inicio)} – ${fmtTime(slot.hora_fin)}\n${slot.canchas?.nombre ?? ''}\n\n¿Confirmás la reserva?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, reclamar',
          onPress: async () => {
            const { data, error } = await supabase.rpc('claim_cancha_slot', { p_slot_id: slot.id });
            if (error) {
              Alert.alert('No se pudo reclamar', error.message);
            } else {
              Alert.alert('Reservado', 'El slot quedó a tu nombre. Crealo como evento desde Gestor.');
              fetchSlots();
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.red} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Slots disponibles</Text>
      <Text style={styles.subText}>Horarios libres publicados por canchas.</Text>

      <FlatList
        data={slots}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchSlots(); }}
            tintColor={COLORS.red}
          />
        }
        ListEmptyComponent={
          <Text style={[styles.subText, { textAlign: 'center', marginTop: SPACING.xl }]}>
            No hay slots disponibles ahora mismo.
          </Text>
        }
        renderItem={({ item }) => {
          const reservedForMe = item.visibility === 'reserved_for_gestor';
          return (
            <View style={styles.card}>
              {reservedForMe && (
                <View style={styles.lockedBanner}>
                  <Text style={styles.lockedText}>🔒 Reservado para ti</Text>
                </View>
              )}
              <Text style={styles.cardDate}>{fmtDate(item.fecha)}</Text>
              <Text style={styles.cardTime}>{fmtTime(item.hora_inicio)} – {fmtTime(item.hora_fin)}</Text>
              <Text style={styles.cardCancha}>{item.canchas?.nombre ?? 'Cancha'}</Text>
              {!!item.canchas?.direccion && <Text style={styles.subText}>{item.canchas.direccion}</Text>}
              {item.precio_hora != null && (
                <Text style={styles.price}>${Number(item.precio_hora).toFixed(2)} / hora</Text>
              )}
              {!!item.notas && <Text style={styles.subText}>{item.notas}</Text>}
              <TouchableOpacity style={styles.primaryBtn} onPress={() => handleClaim(item)}>
                <Text style={styles.primaryBtnText}>Reclamar este slot</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  title:    { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, paddingHorizontal: SPACING.md, paddingTop: SPACING.md, letterSpacing: 1 },
  subText:  { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, paddingHorizontal: SPACING.md, marginTop: 2 },
  card:     { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.card2 },
  cardDate: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white, textTransform: 'capitalize' },
  cardTime: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.gold, marginTop: 4, letterSpacing: 1 },
  cardCancha:{ fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white, marginTop: 4 },
  price:    { fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.green, marginTop: 4 },
  lockedBanner: { backgroundColor: COLORS.purple, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm, alignSelf: 'flex-start', marginBottom: 6 },
  lockedText:   { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white, letterSpacing: 0.5 },
  primaryBtn:   { backgroundColor: COLORS.red, paddingVertical: 10, borderRadius: RADIUS.sm, alignItems: 'center', marginTop: SPACING.sm },
  primaryBtnText: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 13, letterSpacing: 0.5 },
});
