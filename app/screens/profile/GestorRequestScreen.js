import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';

export default function GestorRequestScreen({ navigation }) {
  const { user } = useAuthStore();
  const [existingRequest, setExistingRequest] = useState(null);
  const [motivacion,      setMotivacion]      = useState('');
  const [loading,         setLoading]         = useState(true);
  const [submitting,      setSubmitting]       = useState(false);

  useEffect(() => {
    supabase
      .from('gestor_requests')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        setExistingRequest(data);
        setLoading(false);
      });
  }, []);

  const submit = async () => {
    if (!motivacion.trim() || motivacion.length < 20) {
      Alert.alert('Error', 'Escribe al menos 20 caracteres explicando tu motivación.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('gestor_requests').insert({
        user_id:                   user.id,
        actividades_completadas:   user.actividades_completadas ?? 0,
        motivacion:                motivacion.trim(),
        status:                    'pending',
      });
      if (error) throw error;
      Alert.alert(
        '¡Solicitud enviada!',
        'Un administrador revisará tu solicitud. Te notificaremos cuando sea aprobada.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;

  const statusColor = {
    pending:  COLORS.gold,
    approved: COLORS.green,
    rejected: COLORS.red,
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>SOLICITAR GESTOR</Text>
        </View>

        {/* Info */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>¿Qué es un Gestor?</Text>
          <Text style={styles.infoText}>
            Los Gestores pueden manejar eventos, equipos, resultados y reciben una comisión del 5%
            en las ventas de tienda que generen a través de su código personal.
          </Text>
        </View>

        {/* Requirements */}
        <View style={styles.requirementsBox}>
          <Text style={styles.reqTitle}>Requisitos</Text>
          <Text style={[styles.reqItem, user?.actividades_completadas >= 5 ? styles.reqMet : styles.reqUnmet]}>
            {user?.actividades_completadas >= 5 ? '✓' : '✗'}  Mínimo 5 actividades completadas
            ({user?.actividades_completadas ?? 0}/5)
          </Text>
          <Text style={styles.reqItem}>
            •  Buena conducta en eventos anteriores
          </Text>
        </View>

        {/* Existing request */}
        {existingRequest && (
          <View style={[styles.statusBox, { borderColor: statusColor[existingRequest.status] }]}>
            <Text style={[styles.statusLabel, { color: statusColor[existingRequest.status] }]}>
              {existingRequest.status === 'pending'  ? '⏳ Solicitud en revisión'   :
               existingRequest.status === 'approved' ? '✓ Solicitud aprobada'       :
                                                       '✗ Solicitud rechazada'}
            </Text>
            {existingRequest.razon_rechazo && (
              <Text style={styles.rejectReason}>Razón: {existingRequest.razon_rechazo}</Text>
            )}
            <Text style={styles.statusDate}>
              Enviada: {new Date(existingRequest.created_at).toLocaleDateString('es-PA')}
            </Text>
          </View>
        )}

        {/* Form — only if no pending/approved request */}
        {(!existingRequest || existingRequest.status === 'rejected') && (
          <>
            <Text style={styles.label}>
              {existingRequest?.status === 'rejected' ? 'Nueva solicitud — Motivación' : 'Tu motivación'}
            </Text>
            <TextInput
              style={styles.textarea}
              placeholder="Cuéntanos por qué quieres ser gestor y qué aportas al equipo..."
              placeholderTextColor={COLORS.gray}
              value={motivacion}
              onChangeText={setMotivacion}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{motivacion.length} caracteres (mín. 20)</Text>

            <TouchableOpacity
              style={[styles.btn, (user?.actividades_completadas ?? 0) < 5 && styles.btnDisabled]}
              onPress={submit}
              disabled={submitting || (user?.actividades_completadas ?? 0) < 5}
            >
              {submitting
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.btnText}>ENVIAR SOLICITUD</Text>
              }
            </TouchableOpacity>

            {(user?.actividades_completadas ?? 0) < 5 && (
              <Text style={styles.notEnough}>
                Necesitas completar más actividades para solicitar.
              </Text>
            )}
          </>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.bg },
  inner:        { padding: SPACING.md, gap: SPACING.md },
  header:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  back:         { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  title:        { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 3 },
  infoBox:      { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  infoTitle:    { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white, marginBottom: SPACING.sm },
  infoText:     { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 20 },
  requirementsBox:{ backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  reqTitle:     { fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.gold, marginBottom: SPACING.sm },
  reqItem:      { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, marginBottom: 4 },
  reqMet:       { color: COLORS.green },
  reqUnmet:     { color: COLORS.red },
  statusBox:    { borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, backgroundColor: COLORS.card },
  statusLabel:  { fontFamily: FONTS.bodyMedium, fontSize: 15 },
  rejectReason: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, marginTop: 4 },
  statusDate:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginTop: 4 },
  label:        { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 13 },
  textarea: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.navy,
    minHeight: 120,
  },
  charCount:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'right' },
  btn:          { backgroundColor: COLORS.red, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnDisabled:  { opacity: 0.4 },
  btnText:      { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 3 },
  notEnough:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.red, textAlign: 'center' },
});
