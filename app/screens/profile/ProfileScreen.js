import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert, ScrollView, RefreshControl, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { supabase } from '../../../lib/supabase';
import {
  getReferralStatus,
  applyReferralCode,
  getPendingEventRefCode,
  clearPendingEventRefCode,
  shareEventReferral,
} from '../../../lib/referral';
import ResponsiveContainer from '../../../components/ResponsiveContainer';
import ReferralCard from '../../../components/ReferralCard';
import StatBox from '../../../components/StatBox';

const ROLE_COLOR = {
  admin:  COLORS.purple,
  gestor: COLORS.red,
  player: COLORS.line,
};

const ROLE_LABEL = {
  admin:  'ADMINISTRADOR',
  gestor: 'GESTOR',
  player: 'JUGADOR',
};

export default function ProfileScreen({ navigation }) {
  const { user, walletBalance, logout, refreshProfile } = useAuthStore();
  const [refreshing,    setRefreshing]    = useState(false);
  const [mvpCount,      setMvpCount]      = useState(0);
  const [totalEvents,   setTotalEvents]   = useState(0);
  const [referralData,  setReferralData]  = useState(null);
  const [sharingCode,   setSharingCode]   = useState(false);

  const loadReferral = useCallback(async () => {
    const data = await getReferralStatus();
    setReferralData(data);
  }, []);

  // Aplica código pendiente guardado durante el registro (una sola vez)
  const applyPendingCode = useCallback(async () => {
    const code = await getPendingEventRefCode();
    if (!code) return;
    const result = await applyReferralCode(code);
    await clearPendingEventRefCode();
    if (result.ok) {
      Alert.alert(
        '¡Código aplicado!',
        `Código de ${result.referrer ?? 'tu amigo/a'} activado. Cuando completes tu primer evento, los dos ganan $1 en créditos.`
      );
      loadReferral();
    }
    // Si falla (código inválido, ya usado, cuenta vieja) simplemente ignoramos —
    // el usuario ya completó el registro correctamente.
  }, [loadReferral]);

  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      applyPendingCode();
      loadReferral();
      if (user?.id) {
        supabase.from('mvp_results').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          .then(({ count }) => setMvpCount(count ?? 0));
        supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'confirmed')
          .then(({ count }) => setTotalEvents(count ?? 0));
      }
    }, [refreshProfile, applyPendingCode, loadReferral, user?.id])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshProfile(), loadReferral()]);
    setRefreshing(false);
  }, [refreshProfile, loadReferral]);

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Seguro que deseas salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: logout },
    ]);
  };

  const handleShare = async () => {
    if (!referralData?.code) return;
    setSharingCode(true);
    await shareEventReferral({ code: referralData.code });
    setSharingCode(false);
  };

  const role = user?.role ?? 'player';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {navigation.canGoBack() && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.screenTitle}>PERFIL</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
      <ResponsiveContainer>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          {user?.foto_url
            ? <Image source={{ uri: user.foto_url }} style={styles.avatar} />
            : <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{user?.nombre?.[0]?.toUpperCase()}</Text>
              </View>
          }
          <Text style={styles.name}>{user?.nombre}</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            <View style={[styles.roleBadge, { backgroundColor: ROLE_COLOR[role] ?? COLORS.navy }]}>
              <Text style={styles.roleText}>{ROLE_LABEL[role] ?? role.toUpperCase()}</Text>
            </View>
            {user?.genero && (
              <View style={[styles.roleBadge, { backgroundColor: user.genero === 'Masculino' ? '#1A6B8A' : '#8B1A5A' }]}>
                <Text style={styles.roleText}>{user.genero === 'Masculino' ? '♂ MASCULINO' : '♀ FEMENINO'}</Text>
              </View>
            )}
          </View>
          {role === 'gestor' && user?.gestor_code && (
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>TU CÓDIGO GESTOR</Text>
              <Text style={styles.code}>{user.gestor_code}</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          <InfoRow label="Correo"    value={user?.correo} />
          <InfoRow label="Teléfono"  value={user?.telefono} />
          <InfoRow label="Residencia"value={user?.residencia} />
          <InfoRow label="Género"    value={user?.genero} />
          <InfoRow label="Deporte"   value={user?.deporte} />
          <InfoRow label="Nivel"     value={user?.nivel} />
          <InfoRow label="Posición"  value={user?.posicion} />
          <InfoRow label="Créditos"  value={`$${walletBalance.toFixed(2)}`} accent />
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBox size="sm" icon="⚽" value={user?.actividades_completadas ?? 0} label="Actividades" />
          <StatBox size="sm" icon="📅" value={totalEvents} label="Eventos" />
          <StatBox size="sm" icon="🏆" value={mvpCount} label="MVPs" />
        </View>

        {/* Invita y Gana */}
        <ReferralCard
          data={referralData}
          onShare={handleShare}
          sharing={sharingCode}
        />

        {/* Actions */}
        <View style={styles.actions}>
          <ActionBtn icon="✏️" label="Editar perfil" onPress={() => navigation.navigate('EditProfile')} />

          {role === 'player' && (
            <ActionBtn icon="🎽" label="Solicitar ser Gestor" onPress={() => navigation.navigate('GestorRequest')} />
          )}

          {role === 'gestor' && (
            <ActionBtn icon="💵" label="Ver mis ventas" onPress={() => navigation.navigate('Panel', { screen: 'GestorVentas' })} />
          )}

          <ActionBtn icon="🔔" label="Notificaciones" onPress={() => navigation.navigate('Notifications')} />
          <ActionBtn icon="💬" label="Necesito ayuda" onPress={() => Linking.openURL('https://wa.me/50761222854')} />
          <ActionBtn icon="🔒" label="Política de privacidad" onPress={() => navigation.navigate('PrivacyPolicy')} />
          <ActionBtn icon="📄" label="Términos y condiciones" onPress={() => navigation.navigate('Terms')} />

          <ActionBtn icon="🚪" label="Cerrar sesión" onPress={handleLogout} danger />
        </View>

        <View style={{ height: SPACING.xxl }} />
      </ResponsiveContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoRow({ label, value, accent }) {
  if (!value) return null;
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, accent && { color: COLORS.gold }]}>{value}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, danger }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, danger && styles.actionBtnDanger]}
      onPress={onPress}
    >
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={[styles.actionLabel, danger && { color: COLORS.red }]}>{label}</Text>
      <Text style={styles.actionArrow}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const rowStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderColor: COLORS.line },
  label: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray },
  value: { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white, maxWidth: '60%', textAlign: 'right' },
});

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: COLORS.bg },
  header:          { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  back:            { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, minHeight: 44, textAlignVertical: 'center' },
  screenTitle:     { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.white, letterSpacing: 3 },
  avatarSection:   { alignItems: 'center', paddingVertical: SPACING.xl },
  avatar:          { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: COLORS.neon, marginBottom: SPACING.md },
  avatarPlaceholder:{ width: 90, height: 90, borderRadius: 45, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  avatarInitial:   { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.white },
  name:            { fontFamily: FONTS.heading, fontSize: 34, color: COLORS.white, letterSpacing: 1 },
  roleBadge:       { paddingHorizontal: SPACING.md, paddingVertical: 5, borderRadius: RADIUS.sm, marginTop: SPACING.sm },
  roleText:        { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white, letterSpacing: 2 },
  codeBox:         { marginTop: SPACING.sm, alignItems: 'center' },
  codeLabel:       { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, letterSpacing: 2 },
  code:            { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.gold, letterSpacing: 6 },
  infoCard:        { backgroundColor: COLORS.card, marginHorizontal: SPACING.md, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.line, marginBottom: SPACING.md },
  statsRow:        { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  actions:         { paddingHorizontal: SPACING.md, gap: SPACING.sm },
  actionBtn:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.sm, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.line },
  actionBtnDanger: { borderColor: COLORS.red + '40' },
  actionIcon:      { fontSize: 20 },
  actionLabel:     { fontFamily: FONTS.bodyMedium, fontSize: 15, color: COLORS.white, flex: 1 },
  actionArrow:     { fontFamily: FONTS.bodyBold, fontSize: 20, color: COLORS.gray },
});
