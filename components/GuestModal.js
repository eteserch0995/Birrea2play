import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * GuestModal — add a non-registered guest to an event.
 * Props: visible, onClose, eventId, onSuccess
 */
export default function GuestModal({ visible, onClose, eventId, onSuccess }) {
  const [nombre,   setNombre]   = useState('');
  const [telefono, setTelefono] = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async () => {
    if (!nombre.trim()) { Alert.alert('Error', 'El nombre es requerido'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.from('event_guests').insert({
        event_id: eventId,
        nombre:   nombre.trim(),
        telefono: telefono.trim() || null,
      });
      if (error) throw error;
      Alert.alert('¡Listo!', 'Invitado agregado exitosamente.');
      setNombre('');
      setTelefono('');
      onSuccess?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Agregar Invitado</Text>

          <TextInput
            style={styles.input}
            placeholder="Nombre del invitado"
            placeholderTextColor={COLORS.gray}
            value={nombre}
            onChangeText={setNombre}
          />
          <TextInput
            style={styles.input}
            placeholder="Teléfono (opcional)"
            placeholderTextColor={COLORS.gray}
            value={telefono}
            onChangeText={setTelefono}
            keyboardType="phone-pad"
          />

          <View style={styles.btns}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnAdd} onPress={submit} disabled={loading}>
              {loading
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.btnAddText}>Agregar</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.card2,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  btns:          { flexDirection: 'row', gap: SPACING.sm },
  btnCancel:     { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy },
  btnCancelText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15 },
  btnAdd:        { flex: 1, backgroundColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnAddText:    { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 15 },
});
