import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import useAuthStore from '../store/authStore';

const BADGE_COLOR = {
  'Plan Básico':   COLORS.navy   ?? '#1A2A4A',
  'Plan Premium':  COLORS.blue   ?? '#1E5FCC',
  'Plan Elite':    COLORS.gold   ?? '#F0A500',
};

export default function PlanesModal({ visible, onClose, onPlanActivado }) {
  const { user, walletBalance, setWalletBalance } = useAuthStore();
  const [planes,       setPlanes]       = useState([]);
  const [planActivo,   setPlanActivo]   = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [comprando,    setComprando]    = useState(null);

  useEffect(() => {
    if (visible) { fetchData(); }
  }, [visible]);

  async function fetchData() {
    setLoading(true);
    const [planesRes, planActivoRes] = await Promise.all([
      supabase.from('wallet_plans').select('*').eq('activo', true).order('orden'),
      supabase.rpc('get_user_active_plan', { p_user_id: user.id }),
    ]);
    setPlanes(planesRes.data ?? []);
    setPlanActivo(planActivoRes.data?.[0] ?? null);
    setLoading(false);
  }

  async function comprarPlan(plan) {
    if (walletBalance < plan.precio_mensual) {
      Alert.alert(
        'Saldo insuficiente',
        `Necesitas $${plan.precio_mensual.toFixed(2)} en tu wallet.\nSaldo actual: $${walletBalance.toFixed(2)}\n\nRecarga tu wallet primero.`
      );
      return;
    }

    Alert.alert(
      `Activar ${plan.nombre}`,
      `Se descontarán $${plan.precio_mensual.toFixed(2)} de tu wallet por 30 días.${plan.bonus_wallet > 0 ? `\n\n¡Recibirás $${plan.bonus_wallet.toFixed(2)} de bonus inmediato!` : ''}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setComprando(plan.id);
            try {
              const { error } = await supabase.rpc('purchase_plan', {
                p_user_id: user.id,
                p_plan_id: plan.id,
              });
              if (error) throw new Error(error.message);

              // Refrescar balance
              const { data: wallet } = await supabase
                .from('wallets').select('balance').eq('user_id', user.id).single();
              if (wallet) setWalletBalance(wallet.balance);

              await fetchData();
              Alert.alert('¡Plan activado!', `Tu ${plan.nombre} está activo por 30 días.`);
              if (onPlanActivado) onPlanActivado();
            } catch (e) {
              Alert.alert('Error', e.message);
            } finally {
              setComprando(null);
            }
          },
        },
      ]
    );
  }

  const esActivo = (plan) => planActivo?.plan_id === plan.id;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>PLANES MENSUALES</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {planActivo && (
            <View style={styles.activoBanner}>
              <Text style={styles.activoText}>
                ✅ Plan activo: <Text style={styles.activoNombre}>{planActivo.nombre}</Text>
              </Text>
              <Text style={styles.activoSub}>
                {planActivo.descuento_pct}% descuento • Vence {new Date(planActivo.fecha_fin).toLocaleDateString('es-PA')}
              </Text>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={COLORS.red} style={{ marginVertical: SPACING.xl }} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {planes.map((plan) => {
                const activo   = esActivo(plan);
                const badgeCol = BADGE_COLOR[plan.nombre] ?? COLORS.navy;
                return (
                  <View key={plan.id} style={[styles.planCard, activo && styles.planCardActivo]}>
                    <View style={[styles.planBadge, { backgroundColor: badgeCol }]}>
                      <Text style={styles.planNombre}>{plan.nombre.toUpperCase()}</Text>
                    </View>

                    <View style={styles.planBody}>
                      <Text style={styles.planPrecio}>
                        ${plan.precio_mensual.toFixed(2)}
                        <Text style={styles.planPeriodo}> / mes</Text>
                      </Text>
                      <Text style={styles.planDesc}>{plan.descripcion}</Text>

                      <View style={styles.planPerks}>
                        <Text style={styles.perk}>🎯 {plan.descuento_pct}% descuento en inscripciones</Text>
                        {plan.bonus_wallet > 0 && (
                          <Text style={styles.perk}>💰 +${plan.bonus_wallet.toFixed(2)} bonus en wallet</Text>
                        )}
                        <Text style={styles.perk}>📅 30 días de vigencia</Text>
                      </View>

                      {activo ? (
                        <View style={styles.activoTag}>
                          <Text style={styles.activoTagText}>PLAN ACTIVO</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.comprarBtn, { backgroundColor: badgeCol }]}
                          onPress={() => comprarPlan(plan)}
                          disabled={comprando !== null}
                        >
                          {comprando === plan.id
                            ? <ActivityIndicator color={COLORS.white} />
                            : <Text style={styles.comprarText}>ACTIVAR PLAN</Text>
                          }
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
              <View style={{ height: SPACING.xl }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: COLORS.card2 ?? '#111827',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: SPACING.md,
  },
  title: {
    fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2,
  },
  closeBtn: { fontFamily: FONTS.body, fontSize: 20, color: COLORS.gray },
  activoBanner: {
    backgroundColor: COLORS.green + '22',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
  },
  activoText: { fontFamily: FONTS.bodyMedium, color: COLORS.green, fontSize: 14 },
  activoNombre: { fontFamily: FONTS.heading },
  activoSub: { fontFamily: FONTS.body, color: COLORS.green + 'BB', fontSize: 12, marginTop: 2 },
  planCard: {
    backgroundColor: COLORS.card ?? '#1A2A4A',
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.navy ?? '#1E3A5F',
    ...SHADOWS.card,
  },
  planCardActivo: {
    borderColor: COLORS.green,
    borderWidth: 2,
  },
  planBadge: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  planNombre: {
    fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 3,
  },
  planBody: { padding: SPACING.md },
  planPrecio: {
    fontFamily: FONTS.heading, fontSize: 36, color: COLORS.white, marginBottom: SPACING.xs,
  },
  planPeriodo: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },
  planDesc: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2 ?? '#9CA3AF', marginBottom: SPACING.sm,
  },
  planPerks: { marginBottom: SPACING.md, gap: 4 },
  perk: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.white + 'CC' },
  activoTag: {
    backgroundColor: COLORS.green + '33',
    borderRadius: RADIUS.full,
    padding: SPACING.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  activoTagText: {
    fontFamily: FONTS.heading, fontSize: 13, color: COLORS.green, letterSpacing: 2,
  },
  comprarBtn: {
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
  },
  comprarText: {
    fontFamily: FONTS.heading, fontSize: 15, color: COLORS.white, letterSpacing: 2,
  },
});
