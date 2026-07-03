import React, { useEffect, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { isModo26Active } from '../../../lib/modo26';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import useClubStore from '../../../store/clubStore';
import { supabase } from '../../../lib/supabase';
import PlayerAvatar from '../../../components/PlayerAvatar';
import { getReferralStatus, shareEventReferral } from '../../../lib/referral';
import EventCard from '../../../components/EventCard';
import MundialQuickCard from '../../../components/mundial/MundialQuickCard';
import { useAppRefresh } from '../../../hooks/useAppRefresh';
import ResponsiveContainer from '../../../components/ResponsiveContainer';

// Colores propios del banner de rifa (morados), no forman parte de ningún theme.
const RAFFLE_COLORS = { bg: '#1A0A2E', border: '#9B59B6', text: '#BB8FCE' };
// Colores propios del banner de bienvenida $1 (WELCOME_BONUS_ENABLED=false, dead code
// por ahora), no forman parte de ningún theme.
const BONUS_COLORS = { successBg: '#22FF6622', successBorder: '#22FF66', error: '#FF5555', ctaText: '#07080B' };

export default function HomeScreen({ navigation }) {
  const { user, walletBalance, subscribeToWallet } = useAuthStore();
  const { loadPool: loadWcPool, isVisibleTo } = useWcStore();
  const mundialOn = isVisibleTo(user?.role ?? 'player');
  const { settings: clubSettings, loadSettings: loadClubSettings } = useClubStore();
  const clubOn = (user?.role === 'admin') || clubSettings?.is_visible === true;
  useEffect(() => { loadClubSettings(); }, [loadClubSettings]);

  const [events,       setEvents]       = React.useState([]);
  const [loading,      setLoading]      = React.useState(true);
  const [error,        setError]        = React.useState(null);
  const [mvpCount,     setMvpCount]     = React.useState(0);
  const [totalEvents,  setTotalEvents]  = React.useState(0);
  const [myMvps,       setMyMvps]       = React.useState([]); // [{ id, event_id, votos_totales, evento, fecha }]
  const [survivorWinner, setSurvivorWinner] = React.useState(null);

  const RAFFLE_ACTIVE = new Date() < new Date('2026-07-17');
  // RECAUDO_FOCUS: oculta temporalmente en Home la rifa, el Mundial y el Club de socios
  // para dejar SOLO el botón grande de donación. Revertir = poner false.
  const RECAUDO_FOCUS = true;

  // WELCOME_BONUS_ENABLED: bono de bienvenida $1 DESACTIVADO (2026-06-29). Al liberar el
  // acceso (sin gate de instalar la app / activar notificaciones), el bono dejó de tener
  // sentido como anzuelo y queda oculto. Revertir = poner true.
  const WELCOME_BONUS_ENABLED = false;

  // Banner $1 bienvenida — un solo uso
  const [bonusClaimed,    setBonusClaimed]    = React.useState(true); // true = ocultar hasta saber
  const [bonusClaiming,   setBonusClaiming]   = React.useState(false);
  const [bonusSuccess,    setBonusSuccess]     = React.useState(false);
  const [bonusError,      setBonusError]       = React.useState(null);
  const [bonusRemaining,  setBonusRemaining]   = React.useState(null); // cuántos quedan
  const [bonusExpired,    setBonusExpired]     = React.useState(false); // mostrar "Recompensa vencida"

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [{ data: rawEvents, error: evErr }, { count: mvps }, { count: evTotal }, { data: myMvpRows }] = await Promise.all([
        supabase.from('events').select('*').in('status', ['open', 'active']).eq('visible', true).order('fecha').limit(3),
        user?.id
          ? supabase.from('mvp_results').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          : Promise.resolve({ count: 0 }),
        user?.id
          ? supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'confirmed')
          : Promise.resolve({ count: 0 }),
        user?.id
          ? supabase.from('mvp_results')
              .select('id, event_id, votos_totales, premio_wallet, created_at, event:events!event_id(nombre, fecha, deporte)')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: [] }),
      ]);
      if (evErr) throw new Error(evErr.message);

      // Fetch CONFIRMED inscripciones e invitados para los eventos visibles
      const eventIds = (rawEvents ?? []).map((e) => e.id);
      const [regsByEvent, guestsByEvent] = await Promise.all([
        eventIds.length === 0 ? Promise.resolve({}) :
          supabase.from('event_registrations').select('event_id')
            .in('event_id', eventIds).eq('status', 'confirmed')
            .then(({ data }) => (data ?? []).reduce((acc, r) => { acc[r.event_id] = (acc[r.event_id] ?? 0) + 1; return acc; }, {})),
        eventIds.length === 0 ? Promise.resolve({}) :
          supabase.from('event_guests').select('event_id')
            .in('event_id', eventIds).in('status', ['confirmed','pending_payment'])
            .then(({ data }) => (data ?? []).reduce((acc, r) => { acc[r.event_id] = (acc[r.event_id] ?? 0) + 1; return acc; }, {})),
      ]);
      const events = (rawEvents ?? []).map((e) => ({
        ...e,
        event_registrations: [{ count: (regsByEvent[e.id] ?? 0) + (guestsByEvent[e.id] ?? 0) }],
      }));

      setEvents(events);
      setMvpCount(mvps ?? 0);
      setTotalEvents(evTotal ?? 0);
      setMyMvps(myMvpRows ?? []);

      try {
        const { data: wData } = await supabase.rpc('wc_survivor_winner');
        setSurvivorWinner(wData?.[0] ?? null);
      } catch (_) { /* silent */ }


      // Verificar si ya reclamó el bono de $1 + config del bonus
      if (user?.id) {
        try {
          const [{ data: bonusRow }, { data: cfg }] = await Promise.all([
            supabase.from('users').select('pwa_bonus_granted_at').eq('id', user.id).maybeSingle(),
            supabase.from('app_config').select('pwa_bonus_limit,pwa_bonus_expires_at').eq('id', 1).maybeSingle(),
          ]);
          const alreadyClaimed = bonusRow?.pwa_bonus_granted_at != null;
          const now = Date.now();
          const expired = cfg?.pwa_bonus_expires_at ? now >= new Date(cfg.pwa_bonus_expires_at).getTime() : false;
          if (alreadyClaimed || expired) {
            setBonusClaimed(true);
          } else {
            setBonusClaimed(false);
            if (cfg?.pwa_bonus_limit != null) {
              // Contar cuántos ya reclamaron para mostrar los que quedan
              const { count } = await supabase
                .from('users')
                .select('id', { count: 'exact', head: true })
                .not('pwa_bonus_granted_at', 'is', null);
              setBonusRemaining(Math.max(0, cfg.pwa_bonus_limit - (count ?? 0)));
            }
          }
        } catch (_) { setBonusClaimed(true); }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const claimBonus = React.useRef(false); // guard para evitar doble tap
  const handleClaimBonus = useCallback(async () => {
    if (claimBonus.current || bonusSuccess) return;
    claimBonus.current = true;
    setBonusClaiming(true);
    setBonusError(null);
    try {
      const { data, error } = await supabase.rpc('claim_pwa_install_bonus');
      if (error) { setBonusError(error.message || 'Error al cobrar'); return; }
      // data puede ser objeto o array — normalizar
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.granted === true) {
        if (result?.remaining != null) setBonusRemaining(result.remaining);
        setBonusSuccess(true);
        setTimeout(() => setBonusClaimed(true), 3500);
      } else if (result?.already_claimed) {
        setBonusClaimed(true);
      } else if (result?.error === 'limit_reached') {
        setBonusError('¡Se agotaron los $1! Los 102 bonos ya fueron reclamados.');
      } else if (result?.error === 'expired') {
        setBonusExpired(true); // mostrar "Recompensa vencida" en lugar de desaparecer silencioso
      } else {
        setBonusError(`Error: ${result?.error ?? JSON.stringify(result)}`);
      }
    } catch (err) {
      setBonusError(err?.message ?? 'Error de conexión');
    } finally {
      setBonusClaiming(false);
      claimBonus.current = false;
    }
  }, [bonusSuccess]);

  useEffect(() => {
    const unsub = subscribeToWallet();
    fetchData();
    // Realtime channel removido: era overkill (suscribía a TODOS los cambios de events
    // y disparaba fetches innecesarios). Ahora confiamos en pull-to-refresh + on focus.
    return () => { unsub(); };
  }, [fetchData]);

  useEffect(() => { loadWcPool(); }, [loadWcPool]);

  const { refreshing, onRefresh } = useAppRefresh(fetchData);

  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.topGlow} />
      <View pointerEvents="none" style={styles.pitchLine} />
      {isModo26Active() && <View pointerEvents="none" dataSet={{ m26Wave: '' }} style={styles.m26Wave} />}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
      <ResponsiveContainer>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            {isModo26Active() && (
              <View dataSet={{ m26Pulse: '' }} style={styles.m26Pill}><Text style={styles.m26PillText}>MODO 26</Text></View>
            )}
            <Text style={styles.kicker}>BIRREA2PLAY CLUBHOUSE</Text>
            <Text style={styles.greeting}>¡Hola, {user?.nombre?.split(' ')[0]}!</Text>
            <Text style={styles.sub}>Tu próxima birrea está calentando</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            <PlayerAvatar user={user} size={44} borderColor={COLORS.gold} />
          </TouchableOpacity>
        </View>

        {/* ── Rifa Aniversario Birrea2Play ── */}
        {RAFFLE_ACTIVE && !RECAUDO_FOCUS && (
          <TouchableOpacity
            style={styles.raffleBanner}
            activeOpacity={0.88}
            onPress={() => navigation.navigate('Raffle', { eventId: '3293898c-a937-48e2-84f0-cf3fcc10e068' })}
          >
            <Text style={styles.raffleEmoji}>🎽</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.raffleKicker}>RIFA DE ANIVERSARIO</Text>
              <Text style={styles.raffleTitle}>Camiseta Birrea2Play</Text>
              <Text style={styles.raffleSub}>Presencial · jue 16 jul · $1 boleto</Text>
            </View>
            <View style={styles.rafflePriceBadge}>
              <Text style={styles.rafflePriceAmt}>$1</Text>
              <Text style={styles.rafflePriceLbl}>boleto</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Banner $1 bienvenida — un solo uso, vence PAN vs CRO ── */}
        {WELCOME_BONUS_ENABLED && !bonusClaimed && (
          bonusExpired ? (
            <View style={[styles.bonusBanner, { borderColor: COLORS.gray, opacity: 0.75 }]}>
              <Text style={styles.bonusBannerIcon}>⏰</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bonusBannerTitle}>Recompensa vencida</Text>
                <Text style={styles.bonusBannerSub}>El período de la recompensa de bienvenida ya finalizó.</Text>
              </View>
              <TouchableOpacity
                onPress={() => setBonusClaimed(true)}
                style={styles.bonusBannerCta}
                activeOpacity={0.8}
              >
                <Text style={styles.bonusBannerCtaText}>OK</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.bonusBanner, bonusSuccess && styles.bonusBannerSuccess]}>
              <Text style={styles.bonusBannerIcon}>{bonusSuccess ? '✅' : '🎁'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bonusBannerTitle}>
                  {bonusSuccess ? '¡$1 acreditado en tu wallet!' : 'RECOMPENSA DE BIENVENIDA'}
                </Text>
                <Text style={styles.bonusBannerSub}>
                  {bonusSuccess
                    ? 'Ya podés usarlo en tu próxima birrea.'
                    : bonusRemaining != null
                      ? `Solo quedan ${bonusRemaining} — vence hoy al arrancar PAN 🆚 CRO`
                      : 'Recibí $1 en tu wallet — vence hoy al arrancar PAN 🆚 CRO'}
                </Text>
                {bonusError ? (
                  <Text style={{ color: BONUS_COLORS.error, fontSize: 11, marginTop: 4 }}>{bonusError}</Text>
                ) : null}
              </View>
              {!bonusSuccess && (
                bonusClaiming
                  ? <ActivityIndicator size="small" color={COLORS.neon} style={{ marginLeft: 8 }} />
                  : (
                    <TouchableOpacity
                      onPress={handleClaimBonus}
                      style={styles.bonusBannerCta}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.bonusBannerCtaText}>COBRAR $1</Text>
                    </TouchableOpacity>
                  )
              )}
            </View>
          )
        )}


        {/* ── Banner: perfil incompleto ── */}
        {(() => {
          if (!user?.id) return null;
          const localPart = (user.correo ?? '').split('@')[0];
          const expectedFallback = localPart.charAt(0).toUpperCase() + localPart.slice(1);
          const nombreEsFallback = !!user.nombre && user.nombre === expectedFallback;
          const sinTelefono = !user.telefono || user.telefono.trim() === '';
          if (!nombreEsFallback && !sinTelefono) return null;
          return (
            <TouchableOpacity
              style={styles.profileBanner}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.85}
            >
              <Text style={styles.profileBannerIcon}>👤</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileBannerTitle}>Completá tu perfil</Text>
                <Text style={styles.profileBannerSub}>
                  {nombreEsFallback && sinTelefono
                    ? 'Falta tu nombre completo y teléfono.'
                    : nombreEsFallback
                      ? 'Tu nombre quedó como tu correo. Actualizalo.'
                      : 'Falta tu número de teléfono.'}
                </Text>
              </View>
              <Text style={styles.profileBannerArrow}>→</Text>
            </TouchableOpacity>
          );
        })()}

        {mundialOn && !RECAUDO_FOCUS && <MundialQuickCard onPress={() => navigation.navigate('Mundial')} />}

        {/* ── Banner Club de Beneficios (botón dorado) ── */}
        {clubOn && !RECAUDO_FOCUS && (
          <TouchableOpacity
            style={styles.clubBanner}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Beneficios')}
          >
            <Text style={styles.clubBannerIcon}>🎁</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.clubBannerKicker}>CLUB BIRREOSO</Text>
              <Text style={styles.clubBannerTitle}>BENEFICIOS DE SOCIO</Text>
              <Text style={styles.clubBannerSub}>Descuentos exclusivos en comercios aliados</Text>
            </View>
            <Text style={styles.clubBannerArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* ── Recaudo Solidario (Venezuela) — botón principal grande ──
           Gateado por RECAUDO_FOCUS: es el CTA focal del modo campaña (mismo flag que
           oculta rifa/Mundial/Club). Al apagar RECAUDO_FOCUS el Home vuelve simétrico
           a su layout normal sin este botón. */}
        {RECAUDO_FOCUS && (
          <TouchableOpacity
            style={styles.recaudoBig}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Recaudo')}
          >
            <Text style={styles.recaudoBigHeart}>❤️🇻🇪</Text>
            <Text style={styles.recaudoBigKicker}>RECAUDO SOLIDARIO</Text>
            <Text style={styles.recaudoBigTitle}>YO APOYO A VENEZUELA</Text>
            <View style={styles.recaudoNews}>
              <Text style={styles.recaudoNewsText}>
                🧾 ¡Buenas noticias! Ya compramos los primeros insumos médicos. Mirá la factura, las fotos y el fondo disponible. Seguimos toda la semana — aún faltan insumos. ¿Nos ayudás?
              </Text>
            </View>
            <Text style={styles.recaudoBigSub}>Doná productos, dinero o ayudá con la recolección</Text>
            <View style={styles.recaudoBigCta}>
              <Text style={styles.recaudoBigCtaText}>VER DETALLES Y APOYAR  →</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Próximos eventos: PRIMER bloque visible para foco en agenda ── */}
        <SectionHeader title="Próximos eventos" onPress={() => navigation.navigate('Eventos')} />
        {loading
          ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.md }} />
          : error
            ? (
              <View style={styles.errorBox}>
                <Text style={{ fontSize: 28, marginBottom: SPACING.sm }}>⚠️</Text>
                <Text style={styles.empty}>No se pudieron cargar los eventos</Text>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => { setLoading(true); fetchData(); }}
                >
                  <Text style={styles.retryText}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            )
            : events.length === 0
              ? (
                <View style={styles.emptyBox}>
                  <Text style={{ fontSize: 40, marginBottom: SPACING.sm }}>📅</Text>
                  <Text style={styles.empty}>No hay eventos disponibles</Text>
                </View>
              )
              : events.map((ev) => (
                  <View key={ev.id} style={styles.cardWrap}>
                    <EventCard
                      event={ev}
                      onPress={() => navigation.navigate('Eventos', { screen: 'EventDetail', params: { eventId: ev.id } })}
                    />
                  </View>
                ))
        }

        {/* ── Barra compacta: Wallet + Stats en una sola fila scrollable ── */}
        <View style={styles.statsBarWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsBar}>
            <MiniStat icon="💰" value={`$${Number(walletBalance ?? 0).toFixed(2)}`} label="Saldo" onPress={() => navigation.navigate('Wallet')} highlight />
            <MiniStat icon="⚽" value={user?.actividades_completadas ?? 0} label="Actividades" />
            <MiniStat icon="📅" value={totalEvents} label="Eventos" />
            <MiniStat icon="🏆" value={mvpCount} label="MVPs" />
          </ScrollView>
        </View>

        {/* ── Mis MVPs: carrusel con los últimos premios ganados ── */}
        {myMvps.length > 0 && (
          <>
            <SectionHeader title="Mis MVPs" onPress={() => navigation.navigate('Profile')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mvpStrip}>
              {myMvps.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.mvpChip}
                  onPress={() => navigation.navigate('Eventos', { screen: 'EventDetail', params: { eventId: m.event_id } })}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mvpChipTrophy}>🏆</Text>
                  <Text style={styles.mvpChipEvento} numberOfLines={1}>{m.event?.nombre ?? 'Evento'}</Text>
                  <Text style={styles.mvpChipMeta}>
                    {m.votos_totales ?? 0} voto{m.votos_totales === 1 ? '' : 's'}
                    {m.premio_wallet ? ` · +$${Number(m.premio_wallet).toFixed(0)}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* Invita y Gana */}
        {user?.id && <HomeReferralCard />}

        <View style={{ height: SPACING.xxl }} />
      </ResponsiveContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, onPress }) {
  return (
    <View style={secStyles.row}>
      <View>
        <Text style={secStyles.title}>{title}</Text>
        {isModo26Active() && (
          <View style={secStyles.m26Underline}>
            <View style={{ flex: 1, backgroundColor: COLORS.green }} />
            <View style={{ flex: 1, backgroundColor: COLORS.blue }} />
            <View style={{ flex: 1, backgroundColor: COLORS.red }} />
          </View>
        )}
      </View>
      <TouchableOpacity
        onPress={onPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={secStyles.moreBtn}
      >
        <Text style={secStyles.more}>Ver todo →</Text>
      </TouchableOpacity>
    </View>
  );
}

// Chip compacto para la barra horizontal de stats. El saldo va con `highlight`
// para que se vea como CTA tocable (sin robar el foco visual a los eventos).
function MiniStat({ icon, value, label, onPress, highlight }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={[styles.miniStat, highlight && styles.miniStatHighlight]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={styles.miniStatIcon}>{icon}</Text>
      <View>
        <Text style={[styles.miniStatValue, highlight && { color: COLORS.neon }]}>{value}</Text>
        <Text style={styles.miniStatLabel}>{label}</Text>
      </View>
    </Wrapper>
  );
}

const secStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xl, marginBottom: SPACING.sm, paddingHorizontal: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1 },
  moreBtn: { minHeight: 24, justifyContent: 'center' },
  more:  { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.neon, letterSpacing: 1, textTransform: 'uppercase' },
  m26Underline: { flexDirection: 'row', height: 4, width: 44, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
});

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: COLORS.bg },
  topGlow:  { position: 'absolute', top: -110, right: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: COLORS.red + '24' },
  pitchLine:{ position: 'absolute', top: 88, left: -60, right: -60, height: 1, backgroundColor: COLORS.neon + '18', transform: [{ rotate: '-10deg' }] },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, paddingTop: SPACING.sm },
  kicker:   { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.neon, letterSpacing: 1.6, marginBottom: 2 },
  greeting: { fontFamily: FONTS.heading, fontSize: 34, color: COLORS.white, letterSpacing: 1 },
  bonusBanner: {
    marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.sm,
    backgroundColor: COLORS.neon + '22', borderWidth: 1.5, borderColor: COLORS.neon,
    borderRadius: RADIUS.md, padding: SPACING.md,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  bonusBannerSuccess: {
    backgroundColor: BONUS_COLORS.successBg, borderColor: BONUS_COLORS.successBorder,
  },
  bonusBannerIcon: { fontSize: 28 },
  bonusBannerTitle: {
    fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.neon,
    letterSpacing: 0.5, marginBottom: 2,
  },
  bonusBannerSub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 },
  bonusBannerCta: {
    backgroundColor: COLORS.neon,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.sm ?? 8,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  bonusBannerCtaText: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: BONUS_COLORS.ctaText,
  },
  profileBanner: {
    marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.sm,
    backgroundColor: COLORS.gold + '20', borderWidth: 1, borderColor: COLORS.gold,
    borderRadius: RADIUS.md, padding: SPACING.md,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
  },
  profileBannerIcon:  { fontSize: 28 },
  profileBannerTitle: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.gold, letterSpacing: 0.5 },
  profileBannerSub:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 2 },
  profileBannerArrow: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gold },
  sub:      { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  statsBarWrap: { marginTop: SPACING.md },
  statsBar: { paddingHorizontal: SPACING.md, gap: SPACING.sm, paddingVertical: 2 },
  miniStat: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    borderWidth: 1, borderColor: COLORS.navy,
    minHeight: 52,
  },
  miniStatHighlight: { borderColor: COLORS.neon + '66', backgroundColor: COLORS.neon + '10' },
  miniStatIcon:  { fontSize: 20 },
  miniStatValue: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1 },
  miniStatLabel: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: -2 },
  mvpStrip:      { paddingHorizontal: SPACING.md, gap: SPACING.sm, paddingVertical: 2 },
  mvpChip: {
    minWidth: 160, maxWidth: 200,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.gold + '60',
    gap: 2,
  },
  mvpChipTrophy:{ fontSize: 22 },
  mvpChipEvento:{ fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.white },
  mvpChipMeta:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gold },
  cardWrap: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  emptyBox: { alignItems: 'center', padding: SPACING.xl },
  errorBox: { alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm },
  retryBtn: { backgroundColor: COLORS.red, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, marginTop: SPACING.xs },
  retryText:{ fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 14 },
  mvpCard:  {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  mvpAvatarWrap:{ },
  mvpInfo:  { flex: 1 },
  mvpName:  { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  mvpSub:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  empty:    { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },

  survivorChip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    backgroundColor: COLORS.gold + '18',
    borderWidth: 1, borderColor: COLORS.gold + '88',
    borderRadius: RADIUS.full,
    paddingVertical: 8, paddingHorizontal: SPACING.md,
  },
  survivorChipIcon: { fontSize: 16 },
  survivorChipText: {
    flex: 1, fontFamily: FONTS.bodyBold, fontSize: 12,
    color: COLORS.gold, letterSpacing: 0.4,
  },

  // ── Rifa aniversario ──
  raffleBanner: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    backgroundColor: RAFFLE_COLORS.bg,
    borderWidth: 1.5, borderColor: RAFFLE_COLORS.border,
    borderRadius: RADIUS.md, padding: SPACING.md,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
  },
  raffleEmoji:  { fontSize: 30, width: 40, textAlign: 'center' },
  raffleKicker: { fontFamily: FONTS.bodyBold, fontSize: 10, color: RAFFLE_COLORS.text, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 2 },
  raffleTitle:  { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 0.5 },
  raffleSub:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 2 },
  rafflePriceBadge: {
    alignItems: 'center', backgroundColor: RAFFLE_COLORS.border + '33',
    borderWidth: 1, borderColor: RAFFLE_COLORS.border,
    borderRadius: RADIUS.sm ?? 8, paddingHorizontal: 10, paddingVertical: 6,
    minWidth: 48,
  },
  rafflePriceAmt: { fontFamily: FONTS.heading, fontSize: 20, color: RAFFLE_COLORS.text, letterSpacing: 0.5 },
  rafflePriceLbl: { fontFamily: FONTS.body, fontSize: 10, color: RAFFLE_COLORS.text, textAlign: 'center' },

  // ── Modo 26 ──
  m26Wave: { ...StyleSheet.absoluteFillObject },
  m26Pill: { alignSelf: 'flex-start', backgroundColor: COLORS.gold, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 6 },
  m26PillText: { fontFamily: FONTS.bodyBold, fontSize: 10, letterSpacing: 1.5, color: COLORS.bg },

  // ── Club Banner (dorado) ──
  clubBanner: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.bg2,
    borderWidth: 1.5,
    borderColor: COLORS.gold,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    ...SHADOWS.card,
  },
  clubBannerIcon: { fontSize: 34, width: 50, textAlign: 'center' },
  clubBannerKicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.gold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  clubBannerTitle: {
    fontFamily: FONTS.heading,
    fontSize: 26,
    color: COLORS.white,
    letterSpacing: 1.5,
    lineHeight: 28,
  },
  clubBannerSub: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginTop: 3,
  },
  clubBannerArrow: {
    fontFamily: FONTS.heading,
    fontSize: 26,
    color: COLORS.gold,
  },

  // ── Recaudo: botón principal grande (RECAUDO_FOCUS) ──
  recaudoBig: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.bg2,
    borderWidth: 2,
    borderColor: COLORS.red,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    ...SHADOWS.glow,
  },
  recaudoBigHeart: { fontSize: 44 },
  recaudoBigKicker: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.red2,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: SPACING.xs,
  },
  recaudoBigTitle: {
    fontFamily: FONTS.heading,
    color: COLORS.white,
    fontSize: 32,
    letterSpacing: 1,
    textAlign: 'center',
    lineHeight: 34,
    marginTop: 2,
  },
  recaudoBigSub: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    fontSize: 13,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  recaudoNews: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.gold + '55',
  },
  recaudoNewsText: {
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.white,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  recaudoBigCta: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
  },
  recaudoBigCtaText: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
    fontSize: 16,
    letterSpacing: 1,
  },
});

// ─── Tarjeta "Invita y Gana" en Home ─────────────────────────
function HomeReferralCard() {
  const [data,    setData]    = useState(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    getReferralStatus().then(d => { if (d?.active !== false) setData(d); });
  }, []);

  if (!data?.code) return null;

  return (
    <View style={refCard.wrap}>
      <View style={refCard.headerRow}>
        <Text style={refCard.title}>INVITA Y GANA</Text>
        <View style={refCard.badge}><Text style={refCard.badgeText}>$1 × REFERIDO</Text></View>
      </View>
      <Text style={refCard.desc}>
        Compartí tu código. Cuando tu amigo/a complete su primer evento, los dos ganan $1 en créditos.
      </Text>
      <View style={refCard.codeRow}>
        <Text style={refCard.code}>{data.code}</Text>
        <TouchableOpacity
          style={[refCard.shareBtn, sharing && { opacity: 0.6 }]}
          onPress={async () => {
            setSharing(true);
            await shareEventReferral({ code: data.code });
            setSharing(false);
          }}
          disabled={sharing}
        >
          <Text style={refCard.shareBtnText}>COMPARTIR</Text>
        </TouchableOpacity>
      </View>
      <View style={refCard.statsRow}>
        <View style={refCard.stat}><Text style={refCard.statVal}>{data.referrals_total}</Text><Text style={refCard.statLbl}>Invitados</Text></View>
        <View style={refCard.stat}><Text style={[refCard.statVal, { color: COLORS.gold }]}>${Number(data.earned_total ?? 0).toFixed(2)}</Text><Text style={refCard.statLbl}>Ganado</Text></View>
        <View style={refCard.stat}><Text style={refCard.statVal}>{data.referrals_this_month}/{data.monthly_cap}</Text><Text style={refCard.statLbl}>Este mes</Text></View>
      </View>
      {data.cap_remaining === 0 && (
        <Text style={refCard.cap}>Cupo del mes alcanzado (5/5)</Text>
      )}
    </View>
  );
}

const refCard = StyleSheet.create({
  wrap: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.card ?? '#11151C',
    borderRadius: RADIUS.md, padding: SPACING.md,
    borderWidth: 1, borderColor: (COLORS.green ?? '#23D18B') + '55',
  },
  headerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  title:        { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 2 },
  badge:        { backgroundColor: (COLORS.green ?? '#23D18B') + '22', borderRadius: 99, paddingHorizontal: SPACING.sm, paddingVertical: 3, borderWidth: 1, borderColor: (COLORS.green ?? '#23D18B') + '55' },
  badgeText:    { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 10, color: COLORS.green ?? '#23D18B', letterSpacing: 1 },
  desc:         { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2 ?? COLORS.gray, lineHeight: 19, marginBottom: SPACING.md },
  codeRow:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  code:         { flex: 1, fontFamily: FONTS.heading, fontSize: 28, color: COLORS.gold, letterSpacing: 6 },
  shareBtn:     { backgroundColor: COLORS.green ?? '#23D18B', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, minWidth: 100, alignItems: 'center', minHeight: 38, justifyContent: 'center' },
  shareBtnText: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.bg ?? '#07080B', letterSpacing: 2 },
  statsRow:     { flexDirection: 'row', gap: SPACING.sm },
  stat:         { flex: 1, backgroundColor: COLORS.bg2 ?? '#101318', borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.line ?? '#2A323F' },
  statVal:      { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
  statLbl:      { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: 2 },
  cap:          { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, textAlign: 'center', marginTop: SPACING.sm },
});
