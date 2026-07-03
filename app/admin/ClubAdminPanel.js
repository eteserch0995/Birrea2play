import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  Switch,
  Image,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../../lib/supabase';
import useAuthStore from '../../store/authStore';
import { uploadImage } from '../../lib/uploadImage';
import { broadcastNotification } from '../../lib/notifications';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import {
  WCCard,
  WCButton,
  WCBadge,
  WCSectionTitle,
  WCEmptyState,
  WCHeader,
  WCTabBar,
  WC_ALPHA,
} from '../../components/mundial/WCComponents';

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────
const TABS = ['Ajustes', 'Empresas', 'Beneficios', 'Canjes'];

const CATEGORIAS = ['restaurante', 'deporte', 'salud', 'retail', 'servicios', 'otro'];
const TIPOS_BENEFICIO = ['porcentaje', 'monto', '2x1', 'regalo', 'otro'];
const CANALES = ['presencial', 'online', 'ambos'];

function emptyCompany() {
  return {
    nombre: '',
    categoria: '',
    descripcion: '',
    telefono: '',
    whatsapp: '',
    instagram: '',
    website: '',
    direccion: '',
    distrito: '',
    orden: '0',
    activo: true,
    logo_url: '',
  };
}

function emptyBenefit() {
  return {
    titulo: '',
    descripcion: '',
    terminos: '',
    tipo: 'porcentaje',
    valor_num: '',
    channel: 'presencial',
    max_uses_mode: 'ilimitado',
    max_uses_custom: '',
    sin_vencimiento: true,
    valido_desde: '',
    valido_hasta: '',
    codigo_online: '',
    usage_limit_total: '',
    imagen_url: '',
    activo: true,
    orden: '0',
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function toISOOrNull(str) {
  if (!str || !str.trim()) return null;
  const d = new Date(str.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PA');
}

// ─────────────────────────────────────────────────────────────
// ChipSelector — chips de selección horizontal
// ─────────────────────────────────────────────────────────────
function ChipSelector({ options, value, onChange, accent = COLORS.gold }) {
  return (
    <View style={chipStyles.row}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[
              chipStyles.chip,
              active && { backgroundColor: accent + '33', borderColor: accent },
            ]}
          >
            <Text style={[chipStyles.label, active && { color: accent }]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginVertical: SPACING.xs },
  chip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: WC_ALPHA.divider,
    backgroundColor: WC_ALPHA.cardDarkMid,
  },
  label: {
    fontFamily: FONTS.bodyBold,
    fontSize: 12,
    color: COLORS.gray2,
    textTransform: 'lowercase',
  },
});

// ─────────────────────────────────────────────────────────────
// FieldLabel
// ─────────────────────────────────────────────────────────────
function FieldLabel({ label }) {
  return (
    <Text style={fieldStyles.label}>{label}</Text>
  );
}
const fieldStyles = StyleSheet.create({
  label: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.gray2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: SPACING.sm,
  },
});

// ─────────────────────────────────────────────────────────────
// ModalBox — overlay + caja centrada
// ─────────────────────────────────────────────────────────────
function ModalBox({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalBoxStyles.overlay}>
        <View style={modalBoxStyles.box}>
          <View style={modalBoxStyles.header}>
            <Text style={modalBoxStyles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={modalBoxStyles.closeBtn}>
              <Text style={modalBoxStyles.closeX}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingBottom: SPACING.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modalBoxStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.80)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  box: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 22,
    color: COLORS.white,
    letterSpacing: 1.5,
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: {
    fontFamily: FONTS.bodyBold,
    fontSize: 16,
    color: COLORS.gray2,
  },
});

// ─────────────────────────────────────────────────────────────
// StyledInput
// ─────────────────────────────────────────────────────────────
function StyledInput({ value, onChangeText, placeholder, multiline, keyboardType, style }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder ?? ''}
      placeholderTextColor={COLORS.gray + '88'}
      multiline={multiline}
      numberOfLines={multiline ? 3 : 1}
      keyboardType={keyboardType ?? 'default'}
      style={[inputStyles.input, multiline && inputStyles.multiline, style]}
    />
  );
}

const inputStyles = StyleSheet.create({
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 14,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
    minHeight: 44,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: SPACING.xs + 2,
  },
});

// ─────────────────────────────────────────────────────────────
// CompanyEditModal
// ─────────────────────────────────────────────────────────────
function CompanyEditModal({ visible, editingId, initialData, onClose, onSaved }) {
  const [form, setForm] = useState(emptyCompany());
  const [processing, setProcessing] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    if (visible) {
      setForm(initialData
        ? {
            ...emptyCompany(),
            ...Object.fromEntries(Object.entries(initialData).map(([k, v]) => [k, v == null ? '' : v])),
            orden: String(initialData.orden ?? 0),
          }
        : emptyCompany());
    }
  }, [visible, initialData]);

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function pickLogo() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploadingLogo(true);
    try {
      const url = await uploadImage(
        'partner-logos',
        'logos/' + (editingId || 'new') + '_' + Date.now(),
        asset,
      );
      set('logo_url', url);
    } catch (e) {
      Alert.alert('Error', 'No se pudo subir el logo: ' + e.message);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSave() {
    if (!form.nombre.trim()) {
      Alert.alert('Error', 'El nombre es obligatorio.');
      return;
    }
    setProcessing(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        categoria: form.categoria || null,
        descripcion: form.descripcion.trim() || null,
        telefono: form.telefono.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        instagram: form.instagram.trim() || null,
        website: form.website.trim() || null,
        direccion: form.direccion.trim() || null,
        distrito: form.distrito.trim() || null,
        orden: parseInt(form.orden, 10) || 0,
        activo: form.activo,
        logo_url: form.logo_url || null,
      };
      let error;
      if (editingId) {
        ({ error } = await supabase.from('partner_companies').update(payload).eq('id', editingId));
      } else {
        ({ error } = await supabase.from('partner_companies').insert(payload));
        if (!error && payload.activo) {
          broadcastNotification(
            '🏪 Nueva empresa en Club de Beneficios',
            `${payload.nombre} ya está disponible en el Club. ¡Mirá sus beneficios!`,
            { url: 'https://birrea2play.com' },
          ).catch(() => {});
        }
      }
      if (error) throw error;
      onSaved();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <ModalBox
      visible={visible}
      onClose={onClose}
      title={editingId ? 'Editar empresa' : 'Nueva empresa'}
    >
      <FieldLabel label="Nombre *" />
      <StyledInput value={form.nombre} onChangeText={(v) => set('nombre', v)} placeholder="Nombre de la empresa" />

      <FieldLabel label="Categoria" />
      <ChipSelector options={CATEGORIAS} value={form.categoria} onChange={(v) => set('categoria', v)} />

      <FieldLabel label="Descripcion" />
      <StyledInput value={form.descripcion} onChangeText={(v) => set('descripcion', v)} placeholder="Descripcion breve" multiline />

      <FieldLabel label="Telefono" />
      <StyledInput value={form.telefono} onChangeText={(v) => set('telefono', v)} placeholder="+507 6000-0000" keyboardType="phone-pad" />

      <FieldLabel label="WhatsApp" />
      <StyledInput value={form.whatsapp} onChangeText={(v) => set('whatsapp', v)} placeholder="+507 6000-0000" keyboardType="phone-pad" />

      <FieldLabel label="Instagram" />
      <StyledInput value={form.instagram} onChangeText={(v) => set('instagram', v)} placeholder="@usuario" />

      <FieldLabel label="Website" />
      <StyledInput value={form.website} onChangeText={(v) => set('website', v)} placeholder="https://..." keyboardType="url" />

      <FieldLabel label="Direccion" />
      <StyledInput value={form.direccion} onChangeText={(v) => set('direccion', v)} placeholder="Calle, local, referencia" />

      <FieldLabel label="Distrito" />
      <StyledInput value={form.distrito} onChangeText={(v) => set('distrito', v)} placeholder="Panama, San Miguelito, etc." />

      <FieldLabel label="Orden" />
      <StyledInput value={form.orden} onChangeText={(v) => set('orden', v)} placeholder="0" keyboardType="numeric" />

      <View style={ss.row}>
        <Text style={ss.switchLabel}>Activo</Text>
        <Switch
          value={form.activo}
          onValueChange={(v) => set('activo', v)}
          trackColor={{ true: COLORS.gold, false: COLORS.line }}
          thumbColor={COLORS.white}
        />
      </View>

      <FieldLabel label="Logo" />
      <WCButton
        label={uploadingLogo ? 'Subiendo...' : 'Subir logo'}
        onPress={pickLogo}
        variant="ghost"
        size="sm"
        disabled={uploadingLogo}
        loading={uploadingLogo}
      />
      {!!form.logo_url && (
        <Image
          source={{ uri: form.logo_url }}
          style={ss.logoPreview}
          resizeMode="contain"
        />
      )}

      <View style={[ss.row, { marginTop: SPACING.md, gap: SPACING.sm }]}>
        <WCButton label="Cancelar" onPress={onClose} variant="ghost" size="md" style={{ flex: 1 }} />
        <WCButton label="Guardar" onPress={handleSave} variant="gold" size="md" disabled={processing} loading={processing} style={{ flex: 1 }} />
      </View>
    </ModalBox>
  );
}

// ─────────────────────────────────────────────────────────────
// StaffModal
// ─────────────────────────────────────────────────────────────
function StaffModal({ visible, company, onClose }) {
  const [staffList, setStaffList] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const fetchStaff = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('partner_company_staff')
        .select('id, user_id, users(nombre, correo)')
        .eq('company_id', company.id);
      if (error) throw error;
      setStaffList(data ?? []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    if (visible && company) {
      setEmailInput('');
      fetchStaff();
    }
  }, [visible, company, fetchStaff]);

  async function handleAdd() {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    setProcessing(true);
    try {
      const { data: u, error: ue } = await supabase
        .from('users')
        .select('id, nombre, correo')
        .eq('correo', email)
        .maybeSingle();
      if (ue) throw ue;
      if (!u) {
        Alert.alert('No encontrado', 'No existe un usuario con ese correo.');
        setProcessing(false);
        return;
      }
      const { error } = await supabase
        .from('partner_company_staff')
        .insert({ company_id: company.id, user_id: u.id });
      if (error) {
        if (error.code === '23505') {
          Alert.alert('Aviso', 'Ya es staff de esta empresa.');
        } else {
          throw error;
        }
      } else {
        setEmailInput('');
        await fetchStaff();
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleRemove(staffId) {
    setProcessing(true);
    try {
      const { error } = await supabase.from('partner_company_staff').delete().eq('id', staffId);
      if (error) throw error;
      await fetchStaff();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <ModalBox
      visible={visible}
      onClose={onClose}
      title={'Staff — ' + (company?.nombre ?? '')}
    >
      <FieldLabel label="Agregar por correo" />
      <View style={[ss.row, { gap: SPACING.sm }]}>
        <StyledInput
          value={emailInput}
          onChangeText={setEmailInput}
          placeholder="correo@ejemplo.com"
          keyboardType="email-address"
          style={{ flex: 1 }}
        />
        <WCButton
          label="Agregar"
          onPress={handleAdd}
          variant="gold"
          size="sm"
          disabled={processing || !emailInput.trim()}
          loading={processing}
        />
      </View>

      <FieldLabel label="Staff actual" />
      {loading ? (
        <ActivityIndicator color={COLORS.gold} style={{ marginTop: SPACING.sm }} />
      ) : staffList.length === 0 ? (
        <Text style={ss.emptyNote}>Sin staff asignado.</Text>
      ) : (
        staffList.map((s) => (
          <View key={s.id} style={ss.staffRow}>
            <View style={{ flex: 1 }}>
              <Text style={ss.staffName}>{s.users?.nombre ?? s.user_id}</Text>
              <Text style={ss.staffEmail}>{s.users?.correo ?? ''}</Text>
            </View>
            <WCButton
              label="Quitar"
              onPress={() => handleRemove(s.id)}
              variant="danger"
              size="sm"
              disabled={processing}
            />
          </View>
        ))
      )}
    </ModalBox>
  );
}

// ─────────────────────────────────────────────────────────────
// BenefitEditModal
// ─────────────────────────────────────────────────────────────
function BenefitEditModal({ visible, editingId, initialData, company, onClose, onSaved }) {
  const [form, setForm] = useState(emptyBenefit());
  const [processing, setProcessing] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);

  useEffect(() => {
    if (visible) {
      if (initialData) {
        let maxMode = 'ilimitado';
        let maxCustom = '';
        if (initialData.max_uses_per_user === 1) maxMode = 'unico';
        else if (initialData.max_uses_per_user === null || initialData.max_uses_per_user === undefined) maxMode = 'ilimitado';
        else { maxMode = 'personalizado'; maxCustom = String(initialData.max_uses_per_user); }
        setForm({
          titulo: initialData.titulo ?? '',
          descripcion: initialData.descripcion ?? '',
          terminos: initialData.terminos ?? '',
          tipo: initialData.tipo ?? 'porcentaje',
          valor_num: initialData.valor_num != null ? String(initialData.valor_num) : '',
          channel: initialData.channel ?? 'presencial',
          max_uses_mode: maxMode,
          max_uses_custom: maxCustom,
          sin_vencimiento: !initialData.valido_desde && !initialData.valido_hasta,
          valido_desde: initialData.valido_desde ? initialData.valido_desde.slice(0, 10) : '',
          valido_hasta: initialData.valido_hasta ? initialData.valido_hasta.slice(0, 10) : '',
          codigo_online: initialData.codigo_online ?? '',
          usage_limit_total: initialData.usage_limit_total != null ? String(initialData.usage_limit_total) : '',
          imagen_url: initialData.imagen_url ?? '',
          activo: initialData.activo ?? true,
          orden: String(initialData.orden ?? 0),
        });
      } else {
        setForm(emptyBenefit());
      }
    }
  }, [visible, initialData]);

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploadingImg(true);
    try {
      const url = await uploadImage(
        'partner-logos',
        'benefits/' + (editingId || 'new') + '_' + Date.now(),
        asset,
      );
      set('imagen_url', url);
    } catch (e) {
      Alert.alert('Error', 'No se pudo subir la imagen: ' + e.message);
    } finally {
      setUploadingImg(false);
    }
  }

  async function handleSave() {
    if (!form.titulo.trim()) {
      Alert.alert('Error', 'El titulo es obligatorio.');
      return;
    }
    setProcessing(true);
    try {
      let max_uses_per_user = null;
      if (form.max_uses_mode === 'unico') max_uses_per_user = 1;
      else if (form.max_uses_mode === 'personalizado') {
        const n = parseInt(form.max_uses_custom, 10);
        max_uses_per_user = isNaN(n) ? null : n;
      }

      const payload = {
        company_id: company.id,
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim() || null,
        terminos: form.terminos.trim() || null,
        tipo: form.tipo,
        valor_num: ['porcentaje', 'monto'].includes(form.tipo) && form.valor_num !== ''
          ? parseFloat(form.valor_num) || null
          : null,
        channel: form.channel,
        max_uses_per_user,
        valido_desde: form.sin_vencimiento ? null : toISOOrNull(form.valido_desde),
        valido_hasta: form.sin_vencimiento ? null : toISOOrNull(form.valido_hasta),
        codigo_online: form.channel !== 'presencial' ? (form.codigo_online.trim() || null) : null,
        usage_limit_total: form.usage_limit_total !== '' ? (parseInt(form.usage_limit_total, 10) || null) : null,
        imagen_url: form.imagen_url || null,
        activo: form.activo,
        orden: parseInt(form.orden, 10) || 0,
      };

      let error;
      if (editingId) {
        ({ error } = await supabase.from('partner_benefits').update(payload).eq('id', editingId));
      } else {
        ({ error } = await supabase.from('partner_benefits').insert(payload));
        if (!error && payload.activo) {
          const tipoLabel =
            payload.tipo === 'porcentaje' && payload.valor_num
              ? `${payload.valor_num}% de descuento`
              : payload.tipo === 'monto' && payload.valor_num
              ? `$${payload.valor_num} de descuento`
              : 'Nuevo beneficio disponible';
          broadcastNotification(
            `🎁 ${payload.titulo}`,
            `${tipoLabel} en el Club de Beneficios. ¡Aprovechalo ahora!`,
            { url: 'https://birrea2play.com' },
          ).catch(() => {});
        }
      }
      if (error) throw error;
      onSaved();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <ModalBox
      visible={visible}
      onClose={onClose}
      title={editingId ? 'Editar beneficio' : 'Nuevo beneficio'}
    >
      <FieldLabel label="Titulo *" />
      <StyledInput value={form.titulo} onChangeText={(v) => set('titulo', v)} placeholder="Ej: 15% de descuento" />

      <FieldLabel label="Descripcion" />
      <StyledInput value={form.descripcion} onChangeText={(v) => set('descripcion', v)} placeholder="Descripcion del beneficio" multiline />

      <FieldLabel label="Terminos" />
      <StyledInput value={form.terminos} onChangeText={(v) => set('terminos', v)} placeholder="Condiciones y restricciones" multiline />

      <FieldLabel label="Tipo" />
      <ChipSelector options={TIPOS_BENEFICIO} value={form.tipo} onChange={(v) => set('tipo', v)} />

      {(form.tipo === 'porcentaje' || form.tipo === 'monto') && (
        <>
          <FieldLabel label={form.tipo === 'porcentaje' ? 'Porcentaje (ej: 15)' : 'Monto ($)'} />
          <StyledInput
            value={form.valor_num}
            onChangeText={(v) => set('valor_num', v)}
            placeholder="0"
            keyboardType="decimal-pad"
          />
        </>
      )}

      <FieldLabel label="Canal" />
      <ChipSelector options={CANALES} value={form.channel} onChange={(v) => set('channel', v)} />

      {form.channel !== 'presencial' && (
        <>
          <FieldLabel label="Codigo online" />
          <StyledInput
            value={form.codigo_online}
            onChangeText={(v) => set('codigo_online', v)}
            placeholder="BIRREA10"
          />
        </>
      )}

      <FieldLabel label="Usos por usuario" />
      <ChipSelector
        options={['unico', 'ilimitado', 'personalizado']}
        value={form.max_uses_mode}
        onChange={(v) => set('max_uses_mode', v)}
      />
      {form.max_uses_mode === 'personalizado' && (
        <>
          <FieldLabel label="Cantidad de usos" />
          <StyledInput
            value={form.max_uses_custom}
            onChangeText={(v) => set('max_uses_custom', v)}
            placeholder="Ej: 3"
            keyboardType="numeric"
          />
        </>
      )}

      <FieldLabel label="Cupo total del beneficio (opcional)" />
      <StyledInput
        value={form.usage_limit_total}
        onChangeText={(v) => set('usage_limit_total', v)}
        placeholder="Vacio = ilimitado. Ej: 100"
        keyboardType="numeric"
      />

      <View style={ss.row}>
        <Text style={ss.switchLabel}>Sin vencimiento</Text>
        <Switch
          value={form.sin_vencimiento}
          onValueChange={(v) => set('sin_vencimiento', v)}
          trackColor={{ true: COLORS.gold, false: COLORS.line }}
          thumbColor={COLORS.white}
        />
      </View>

      {!form.sin_vencimiento && (
        <>
          <FieldLabel label="Valido desde (YYYY-MM-DD)" />
          <StyledInput
            value={form.valido_desde}
            onChangeText={(v) => set('valido_desde', v)}
            placeholder="2026-01-01"
          />
          <FieldLabel label="Valido hasta (YYYY-MM-DD)" />
          <StyledInput
            value={form.valido_hasta}
            onChangeText={(v) => set('valido_hasta', v)}
            placeholder="2026-12-31"
          />
        </>
      )}

      <FieldLabel label="Imagen del beneficio" />
      <WCButton
        label={uploadingImg ? 'Subiendo...' : 'Subir imagen'}
        onPress={pickImage}
        variant="ghost"
        size="sm"
        disabled={uploadingImg}
        loading={uploadingImg}
      />
      {!!form.imagen_url && (
        <Image source={{ uri: form.imagen_url }} style={ss.benefitImgPreview} resizeMode="contain" />
      )}

      <FieldLabel label="Orden" />
      <StyledInput
        value={form.orden}
        onChangeText={(v) => set('orden', v)}
        placeholder="0"
        keyboardType="numeric"
      />

      <View style={ss.row}>
        <Text style={ss.switchLabel}>Activo</Text>
        <Switch
          value={form.activo}
          onValueChange={(v) => set('activo', v)}
          trackColor={{ true: COLORS.gold, false: COLORS.line }}
          thumbColor={COLORS.white}
        />
      </View>

      <View style={[ss.row, { marginTop: SPACING.md, gap: SPACING.sm }]}>
        <WCButton label="Cancelar" onPress={onClose} variant="ghost" size="md" style={{ flex: 1 }} />
        <WCButton
          label="Guardar"
          onPress={handleSave}
          variant="gold"
          size="md"
          disabled={processing}
          loading={processing}
          style={{ flex: 1 }}
        />
      </View>
    </ModalBox>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab: AJUSTES
// ─────────────────────────────────────────────────────────────
function TabAjustes() {
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('club_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      setIsVisible(data?.is_visible ?? false);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  async function handleToggle(val) {
    const prev = isVisible;
    setIsVisible(val);
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('club_settings')
        .update({ is_visible: val, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;
    } catch (e) {
      setIsVisible(prev);
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return <ActivityIndicator color={COLORS.gold} style={{ marginTop: SPACING.xl }} />;
  }

  return (
    <View>
      <WCCard accent="gold" style={{ marginBottom: SPACING.md }}>
        <View style={ss.settingRow}>
          <View style={{ flex: 1, marginRight: SPACING.md }}>
            <Text style={ss.settingTitle}>Modulo Club visible para todos</Text>
            <Text style={ss.settingDesc}>
              Cuando esta activo, todos los usuarios ven el Club de Beneficios. Si esta apagado, solo vos (admin) lo ves para preparar el contenido.
            </Text>
          </View>
          <Switch
            value={isVisible}
            onValueChange={handleToggle}
            trackColor={{ true: COLORS.gold, false: COLORS.line }}
            thumbColor={COLORS.white}
            disabled={processing}
          />
        </View>
      </WCCard>
      <WCBadge label={isVisible ? 'VISIBLE' : 'OCULTO'} tone={isVisible ? 'success' : 'finalizado'} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab: EMPRESAS
// ─────────────────────────────────────────────────────────────
function TabEmpresas({ onOpenBenefits }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingData, setEditingData] = useState(null);

  const [staffModalVisible, setStaffModalVisible] = useState(false);
  const [staffCompany, setStaffCompany] = useState(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('partner_companies')
        .select('*')
        .order('orden', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw error;
      setCompanies(data ?? []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  function openNew() {
    setEditingId(null);
    setEditingData(null);
    setEditModalVisible(true);
  }

  function openEdit(c) {
    setEditingId(c.id);
    setEditingData(c);
    setEditModalVisible(true);
  }

  function openStaff(c) {
    setStaffCompany(c);
    setStaffModalVisible(true);
  }

  async function handleDelete(c) {
    Alert.alert(
      'Borrar empresa',
      `Confirmas que queres borrar "${c.nombre}"? Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            setProcessing(true);
            try {
              const { error } = await supabase.from('partner_companies').delete().eq('id', c.id);
              if (error) throw error;
              await fetchCompanies();
            } catch (e) {
              Alert.alert('Error', e.message);
            } finally {
              setProcessing(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return <ActivityIndicator color={COLORS.gold} style={{ marginTop: SPACING.xl }} />;
  }

  return (
    <View>
      <WCButton
        label="+ Agregar empresa"
        onPress={openNew}
        variant="gold"
        size="md"
        style={{ marginBottom: SPACING.md }}
      />

      {companies.length === 0 ? (
        <WCEmptyState
          icon="🏢"
          title="Sin empresas"
          message="Agrega la primera empresa socia."
          action={<WCButton label="+ Agregar empresa" onPress={openNew} variant="gold" size="md" />}
        />
      ) : (
        companies.map((c) => (
          <WCCard key={c.id} accent="gold" style={{ marginBottom: SPACING.sm }}>
            <View style={ss.companyRow}>
              {c.logo_url ? (
                <Image source={{ uri: c.logo_url }} style={ss.companyLogo} resizeMode="contain" />
              ) : (
                <View style={ss.companyLogoPlaceholder}>
                  <Text style={{ fontSize: 22 }}>🏢</Text>
                </View>
              )}
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={ss.companyName}>{c.nombre}</Text>
                <View style={ss.badgeRow}>
                  {c.categoria ? <WCBadge label={c.categoria} tone="gold" size="sm" /> : null}
                  <WCBadge label={c.activo ? 'ACTIVO' : 'INACTIVO'} tone={c.activo ? 'success' : 'finalizado'} size="sm" />
                </View>
              </View>
            </View>
            <View style={[ss.actionRow, { marginTop: SPACING.sm }]}>
              <WCButton label="Editar" onPress={() => openEdit(c)} variant="ghost" size="sm" style={ss.actionBtn} />
              <WCButton label="Staff" onPress={() => openStaff(c)} variant="ghost" size="sm" style={ss.actionBtn} />
              <WCButton
                label="Beneficios"
                onPress={() => onOpenBenefits(c)}
                variant="secondary"
                size="sm"
                style={ss.actionBtn}
              />
              <WCButton
                label="Borrar"
                onPress={() => handleDelete(c)}
                variant="danger"
                size="sm"
                disabled={processing}
                style={ss.actionBtn}
              />
            </View>
          </WCCard>
        ))
      )}

      <CompanyEditModal
        visible={editModalVisible}
        editingId={editingId}
        initialData={editingData}
        onClose={() => setEditModalVisible(false)}
        onSaved={async () => {
          setEditModalVisible(false);
          await fetchCompanies();
        }}
      />

      <StaffModal
        visible={staffModalVisible}
        company={staffCompany}
        onClose={() => setStaffModalVisible(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab: BENEFICIOS
// ─────────────────────────────────────────────────────────────
function TabBeneficios({ preselectedCompany }) {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(preselectedCompany ?? null);
  const [benefits, setBenefits] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingBenefits, setLoadingBenefits] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingData, setEditingData] = useState(null);

  const fetchCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    try {
      const { data, error } = await supabase
        .from('partner_companies')
        .select('id, nombre, activo')
        .order('orden', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw error;
      setCompanies(data ?? []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  const fetchBenefits = useCallback(async (companyId) => {
    if (!companyId) { setBenefits([]); return; }
    setLoadingBenefits(true);
    try {
      const { data, error } = await supabase
        .from('partner_benefits')
        .select('*')
        .eq('company_id', companyId)
        .order('orden', { ascending: true });
      if (error) throw error;
      setBenefits(data ?? []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoadingBenefits(false);
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  useEffect(() => {
    if (preselectedCompany && !selectedCompany) {
      setSelectedCompany(preselectedCompany);
    }
  }, [preselectedCompany]);

  useEffect(() => {
    fetchBenefits(selectedCompany?.id ?? null);
  }, [selectedCompany, fetchBenefits]);

  function openNew() {
    setEditingId(null);
    setEditingData(null);
    setEditModalVisible(true);
  }

  function openEdit(b) {
    setEditingId(b.id);
    setEditingData(b);
    setEditModalVisible(true);
  }

  async function handleDelete(b) {
    Alert.alert(
      'Borrar beneficio',
      `Confirmas que queres borrar "${b.titulo}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            setProcessing(true);
            try {
              const { error } = await supabase.from('partner_benefits').delete().eq('id', b.id);
              if (error) throw error;
              await fetchBenefits(selectedCompany?.id);
            } catch (e) {
              Alert.alert('Error', e.message);
            } finally {
              setProcessing(false);
            }
          },
        },
      ],
    );
  }

  if (loadingCompanies) {
    return <ActivityIndicator color={COLORS.gold} style={{ marginTop: SPACING.xl }} />;
  }

  return (
    <View>
      <Text style={ss.sectionHint}>Elegí una empresa para gestionar sus beneficios</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: SPACING.xs, paddingBottom: SPACING.sm }}
      >
        {companies.map((c) => {
          const active = selectedCompany?.id === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => setSelectedCompany(c)}
              style={[
                ss.companyChip,
                active && { backgroundColor: COLORS.gold + '33', borderColor: COLORS.gold },
              ]}
            >
              <Text style={[ss.companyChipLabel, active && { color: COLORS.gold }]}>{c.nombre}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!selectedCompany ? (
        <WCEmptyState
          icon="🏷️"
          title="Elegi una empresa"
          message="Selecciona una empresa arriba para ver y gestionar sus beneficios."
        />
      ) : (
        <View>
          <WCButton
            label="+ Agregar beneficio"
            onPress={openNew}
            variant="gold"
            size="md"
            style={{ marginBottom: SPACING.md }}
          />
          {loadingBenefits ? (
            <ActivityIndicator color={COLORS.gold} style={{ marginTop: SPACING.md }} />
          ) : benefits.length === 0 ? (
            <WCEmptyState
              icon="🎁"
              title="Sin beneficios"
              message="Agrega el primer beneficio para esta empresa."
            />
          ) : (
            benefits.map((b) => (
              <WCCard key={b.id} style={{ marginBottom: SPACING.sm }}>
                <View style={ss.benefitHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={ss.benefitTitle}>{b.titulo}</Text>
                    <View style={ss.badgeRow}>
                      <WCBadge label={b.tipo} tone="gold" size="sm" />
                      <WCBadge label={b.channel} tone="blue" size="sm" />
                      <WCBadge label={b.activo ? 'ACTIVO' : 'INACTIVO'} tone={b.activo ? 'success' : 'finalizado'} size="sm" />
                    </View>
                  </View>
                  {b.imagen_url ? (
                    <Image source={{ uri: b.imagen_url }} style={ss.benefitThumb} resizeMode="cover" />
                  ) : null}
                </View>
                {b.descripcion ? (
                  <Text style={ss.benefitDesc} numberOfLines={2}>{b.descripcion}</Text>
                ) : null}
                <View style={[ss.actionRow, { marginTop: SPACING.xs }]}>
                  <WCButton label="Editar" onPress={() => openEdit(b)} variant="ghost" size="sm" style={ss.actionBtn} />
                  <WCButton label="Borrar" onPress={() => handleDelete(b)} variant="danger" size="sm" disabled={processing} style={ss.actionBtn} />
                </View>
              </WCCard>
            ))
          )}
        </View>
      )}

      <BenefitEditModal
        visible={editModalVisible}
        editingId={editingId}
        initialData={editingData}
        company={selectedCompany}
        onClose={() => setEditModalVisible(false)}
        onSaved={async () => {
          setEditModalVisible(false);
          await fetchBenefits(selectedCompany?.id);
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab: CANJES
// ─────────────────────────────────────────────────────────────
function TabCanjes() {
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const fetchCanjes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('benefit_redemptions')
        .select('*')
        .eq('status', 'redeemed')
        .order('redeemed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = data ?? [];

      const benefitIds = [...new Set(rows.map((r) => r.benefit_id).filter(Boolean))];
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

      let benefitMap = {};
      let companyMap = {};
      let userMap = {};

      if (benefitIds.length) {
        const { data: bData } = await supabase
          .from('partner_benefits')
          .select('id, titulo, company_id')
          .in('id', benefitIds);
        (bData ?? []).forEach((b) => { benefitMap[b.id] = b; });

        const companyIds = [...new Set((bData ?? []).map((b) => b.company_id).filter(Boolean))];
        if (companyIds.length) {
          const { data: cData } = await supabase
            .from('partner_companies')
            .select('id, nombre')
            .in('id', companyIds);
          (cData ?? []).forEach((c) => { companyMap[c.id] = c; });
        }
      }

      if (userIds.length) {
        const { data: uData } = await supabase
          .from('users')
          .select('id, nombre')
          .in('id', userIds);
        (uData ?? []).forEach((u) => { userMap[u.id] = u; });
      }

      setRedemptions(
        rows.map((r) => ({
          ...r,
          _benefit: benefitMap[r.benefit_id] ?? null,
          _company: companyMap[benefitMap[r.benefit_id]?.company_id] ?? null,
          _user: userMap[r.user_id] ?? null,
        })),
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  async function deleteCanje(r) {
    const ok = Platform.OS === 'web'
      ? (typeof window !== 'undefined' && window.confirm('¿Quitar este canje? El socio podrá volver a usar el beneficio.'))
      : await new Promise((res) => Alert.alert(
          'Quitar canje',
          'El socio podrá volver a usar el beneficio.',
          [{ text: 'Cancelar', style: 'cancel', onPress: () => res(false) },
           { text: 'Quitar', style: 'destructive', onPress: () => res(true) }],
        ));
    if (!ok) return;
    setDeleting(r.id);
    const { error } = await supabase.from('benefit_redemptions').delete().eq('id', r.id);
    setDeleting(null);
    if (error) { Alert.alert('Error', error.message); return; }
    setRedemptions((prev) => prev.filter((x) => x.id !== r.id));
  }

  useEffect(() => { fetchCanjes(); }, [fetchCanjes]);

  return (
    <View>
      <View style={[ss.row, { marginBottom: SPACING.md, justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text style={ss.tabSectionTitle}>Canjes recientes (últimos 100)</Text>
        <WCButton label="Refrescar" onPress={fetchCanjes} variant="ghost" size="sm" />
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.gold} style={{ marginTop: SPACING.xl }} />
      ) : redemptions.length === 0 ? (
        <WCEmptyState
          icon="🧾"
          title="Sin canjes todavia"
          message="Cuando los socios canjeen beneficios apareceran aca."
        />
      ) : (
        redemptions.map((r) => (
          <WCCard key={r.id} style={{ marginBottom: SPACING.sm }}>
            <View style={ss.canjeHeader}>
              <Text style={ss.canjeCode}>{r.code ?? r.id?.slice(0, 8)}</Text>
              {r.channel_used ? <WCBadge label={r.channel_used} tone="blue" size="sm" /> : null}
            </View>
            <Text style={ss.canjeBenefit}>{r._benefit?.titulo ?? r.benefit_id}</Text>
            <Text style={ss.canjeCompany}>{r._company?.nombre ?? '—'}</Text>
            <View style={[ss.row, { marginTop: 4, justifyContent: 'space-between' }]}>
              <Text style={ss.canjeSocio}>👤 {r._user?.nombre ?? r.user_id}</Text>
              <Text style={ss.canjeDate}>{r.redeemed_at ? fmtDate(r.redeemed_at) : '—'}</Text>
            </View>
            <WCButton
              label="Quitar"
              onPress={() => deleteCanje(r)}
              variant="danger"
              size="sm"
              loading={deleting === r.id}
              style={{ marginTop: SPACING.sm, alignSelf: 'flex-start' }}
            />
          </WCCard>
        ))
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main: ClubAdminPanel
// ─────────────────────────────────────────────────────────────
export default function ClubAdminPanel({ navigation }) {
  const [activeTab, setActiveTab] = useState('Ajustes');
  const [beneficiosPreselect, setBeneficiosPreselect] = useState(null);

  function goToBenefits(company) {
    setBeneficiosPreselect(company);
    setActiveTab('Beneficios');
  }

  function renderTab() {
    switch (activeTab) {
      case 'Ajustes':
        return <TabAjustes />;
      case 'Empresas':
        return <TabEmpresas onOpenBenefits={goToBenefits} />;
      case 'Beneficios':
        return (
          <TabBeneficios
            key={beneficiosPreselect?.id ?? 'none'}
            preselectedCompany={beneficiosPreselect}
          />
        );
      case 'Canjes':
        return <TabCanjes />;
      default:
        return null;
    }
  }

  return (
    <SafeAreaView style={ss.safe} edges={['top']}>
      <WCHeader
        title="Club Birreoso"
        kicker="ADMIN"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={ss.scroll}
        contentContainerStyle={ss.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <WCTabBar
          tabs={TABS}
          active={activeTab}
          onChange={(t) => {
            if (t !== 'Beneficios') setBeneficiosPreselect(null);
            setActiveTab(t);
          }}
          accent="gold"
        />
        {renderTab()}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl * 2,
  },

  // Ajustes
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingTitle: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.white,
    marginBottom: 4,
  },
  settingDesc: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 18,
  },

  // Empresas
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  companyLogo: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
  },
  companyLogoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  companyName: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.white,
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  actionBtn: {
    flex: 1,
    minWidth: 70,
  },

  // Staff
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    gap: SPACING.sm,
  },
  staffName: {
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
    color: COLORS.white,
  },
  staffEmail: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
  },
  emptyNote: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray,
    textAlign: 'center',
    marginVertical: SPACING.md,
  },

  // Beneficios
  sectionHint: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    marginBottom: SPACING.sm,
  },
  companyChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: WC_ALPHA.divider,
    backgroundColor: WC_ALPHA.cardDarkMid,
  },
  companyChipLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 12,
    color: COLORS.gray2,
  },
  benefitHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  benefitTitle: {
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
    color: COLORS.white,
    marginBottom: 4,
    flex: 1,
  },
  benefitThumb: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    marginLeft: SPACING.sm,
    backgroundColor: COLORS.card,
  },
  benefitDesc: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginBottom: 4,
  },

  // Canjes
  tabSectionTitle: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.gray2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  canjeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  canjeCode: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.gold,
    letterSpacing: 1.5,
  },
  canjeBenefit: {
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
    color: COLORS.white,
    marginBottom: 2,
  },
  canjeCompany: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginBottom: 2,
  },
  canjeSocio: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
  },
  canjeDate: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray,
  },

  // Shared
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
    color: COLORS.white,
    flex: 1,
  },

  // Modal image previews
  logoPreview: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  benefitImgPreview: {
    width: '100%',
    height: 120,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
});
