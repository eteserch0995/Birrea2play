import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { useAppRefresh } from '../../../hooks/useAppRefresh';

const TYPE_ICON = {
  evento:    '📅',
  mvp:       '🏆',
  wallet:    '💰',
  sistema:   '🔔',
  gestor:    '🎽',
};

export default function NotificationsScreen({ navigation }) {
  const { user } = useAuthStore();
  const [notifications, setNotifications] = useState([]);

  const fetch = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications(data ?? []);
  };

  useEffect(() => { fetch(); }, []);

  const { refreshing, onRefresh } = useAppRefresh(fetch);

  const markRead = async (id) => {
    await supabase.from('notifications').update({ leida: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, leida: true } : n));
  };

  const markAllRead = async () => {
    await supabase.from('notifications').update({ leida: true }).eq('user_id', user?.id).eq('leida', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, leida: true })));
  };

  const unreadCount = notifications.filter((n) => !n.leida).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>NOTIFICACIONES</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={styles.markAll}>Leer todo</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Sin notificaciones</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.item, !item.leida && styles.itemUnread]}
            onPress={() => markRead(item.id)}
          >
            <Text style={styles.icon}>{TYPE_ICON[item.tipo] ?? '🔔'}</Text>
            <View style={styles.content}>
              <Text style={styles.mensaje}>{item.mensaje}</Text>
              <Text style={styles.date}>
                {new Date(item.created_at).toLocaleString('es-PA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            {!item.leida && <View style={styles.dot} />}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: COLORS.bg },
  header:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md },
  back:        { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  title:       { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 3, flex: 1 },
  markAll:     { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gold },
  list:        { padding: SPACING.md, gap: SPACING.sm },
  item:        { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  itemUnread:  { borderColor: COLORS.blue, backgroundColor: COLORS.card2 },
  icon:        { fontSize: 22 },
  content:     { flex: 1 },
  mensaje:     { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, lineHeight: 20 },
  date:        { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 4 },
  dot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red, marginTop: 4 },
  empty:       { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
});
