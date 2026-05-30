import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { filterActiveEventGuests } from '../lib/eventGuests';
import useAuthStore from './authStore';

// Helper: rechaza si la promise tarda más de `ms`. Sin esto, una query de
// Supabase que se cuelga (token refresh atascado, lock interno, etc.) deja
// `loading=true` para siempre y el usuario ve spinner infinito.
function withTimeout(promise, ms, label = 'query') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

const useEventStore = create((set, get) => ({
  events: [],
  activeEvent: null,
  loading: false,
  error: null,

  fetchEvents: async (filter = null) => {
    set({ loading: true, error: null });
    try {
      let q = supabase
        .from('events')
        .select('*')
        .eq('visible', true)   // Solo eventos visibles para jugadores
        .order('fecha');

      if (filter && filter !== 'Todos') {
        if (['open', 'active', 'finished', 'draft'].includes(filter)) {
          q = q.eq('status', filter);
        } else {
          q = q.eq('formato', filter);
        }
      }

      const { data, error } = await withTimeout(q, 12000, 'fetchEvents.events');
      if (error) throw error;

      // Fetch CONFIRMED inscripciones e invitados — necesario porque embedded
      // event_registrations(count) cuenta también 'cancelled'.
      const eventIds = (data ?? []).map((e) => e.id);
      const [regsByEvent, guestsByEvent] = await withTimeout(Promise.all([
        eventIds.length === 0 ? Promise.resolve({}) :
          supabase.from('event_registrations').select('event_id, user_id, status')
            .in('event_id', eventIds).eq('status', 'confirmed')
            .then(({ data: rows }) => (rows ?? []).reduce((acc, r) => {
              const bucket = acc[r.event_id] ?? { count: 0, rows: [] };
              bucket.count += 1;
              bucket.rows.push(r);
              acc[r.event_id] = bucket;
              return acc;
            }, {})),
        eventIds.length === 0 ? Promise.resolve({}) :
          supabase.from('event_guests').select('event_id, invited_by, status')
            .in('event_id', eventIds).in('status', ['confirmed','pending_payment'])
            .then(({ data: rows }) => (rows ?? []).reduce((acc, r) => {
              (acc[r.event_id] ??= []).push(r);
              return acc;
            }, {})),
      ]), 12000, 'fetchEvents.counts');
      const uid = useAuthStore.getState().user?.id;
      const withCount = (data ?? []).map((e) => ({
        ...e,
        my_registered: !!uid && (regsByEvent[e.id]?.rows ?? []).some((r) => r.user_id === uid),
        event_registrations: [{
          count: (regsByEvent[e.id]?.count ?? 0)
            + filterActiveEventGuests(guestsByEvent[e.id] ?? [], regsByEvent[e.id]?.rows ?? []).length,
        }],
      }));

      // Auto-ocultar eventos finalizados hace más de 24 horas
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const visible = withCount.filter((ev) => {
        if (ev.status === 'finished' && ev.event_finished_at) {
          return new Date(ev.event_finished_at).getTime() > cutoff;
        }
        return true;
      });

      // Sort: open events first (accepting registrations), then active, then others
      // Within same status: soonest event date first
      const STATUS_PRIORITY = { open: 0, active: 1, finished: 2, draft: 3, cancelled: 4 };
      visible.sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 5;
        const pb = STATUS_PRIORITY[b.status] ?? 5;
        if (pa !== pb) return pa - pb;
        return new Date(a.fecha) - new Date(b.fecha);
      });

      set({ events: visible, loading: false });
    } catch (e) {
      set({ loading: false, error: e.message ?? 'Error cargando eventos' });
    }
  },

  fetchActiveEvent: async (eventId) => {
    try {
      const [
        { data: ev },
        { data: teams },
        { data: matches },
        { data: standings },
        { data: regs },
      ] = await withTimeout(Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('teams').select('*, team_players(*, users(nombre, foto_url))').eq('event_id', eventId),
        supabase.from('matches').select('*').eq('event_id', eventId).order('round'),
        supabase.from('standings').select('*').eq('event_id', eventId).order('pts', { ascending: false }),
        supabase.from('event_registrations').select('*, users(nombre, foto_url)').eq('event_id', eventId).eq('status', 'confirmed'),
      ]), 12000, 'fetchActiveEvent');
      set({
        activeEvent: {
          event:      ev,
          teams:      teams    ?? [],
          matches:    matches  ?? [],
          standings:  standings ?? [],
          players:    regs     ?? [],
        },
      });
    } catch (e) {
      // Si la carga falla o timeout, no dejamos activeEvent corrupto.
      set({ activeEvent: null });
      throw e;
    }
  },

  clearActiveEvent: () => set({ activeEvent: null }),
}));

export default useEventStore;
