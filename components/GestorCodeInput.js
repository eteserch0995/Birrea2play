import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import useCartStore from '../store/cartStore';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * GestorCodeInput — lets a buyer link their purchase to a gestor.
 * Used in CartScreen / StoreScreen.
 */
export default function GestorCodeInput() {
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const { gestorNombre, setGestor, clearGestor } = useCartStore();

  const apply = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, nombre, gestor_code')
        .eq('gestor_code', trimmed)
        .eq('role', 'gestor')
        .single();

      if (error || !data) {
        Alert.alert('Código inválido', 'No se encontró ningún gestor con ese código.');
        return;
      }
      setGestor(data.id, data.nombre, data.gestor_code);
      Alert.alert('¡Gestor vinculado!', `Compra vinculada a: ${data.nombre}`);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  if (gestorNombre) {
    return (
      <View style={styles.applied}>
        <Text style={styles.appliedText}>👤 Gestor: {gestorNombre}</Text>
        <TouchableOpacity onPress={clearGestor}>
          <Text style={styles.remove}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        placeholder="Código de gestor (opcional)"
        placeholderTextColor={COLORS.gray}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        maxLength={6}
      />
      <TouchableOpacity style={styles.btn} onPress={apply} disabled={loading}>
        {loading
          ? <ActivityIndicator color={COLORS.white} size="small" />
          : <Text style={styles.btnText}>Aplicar</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACING.sm },
  input: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.white,
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.navy,
    letterSpacing: 2,
  },
  btn: {
    backgroundColor: COLORS.blue,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText:      { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14 },
  applied: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.blue + '30',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.blue2,
  },
  appliedText: { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 14 },
  remove:      { fontFamily: FONTS.bodyBold, color: COLORS.gray, fontSize: 16, padding: 4 },
});
