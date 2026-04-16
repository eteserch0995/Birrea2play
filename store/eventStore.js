import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const useEventStore = create((set, get) => ({
  events: [],
  activeEvent: null,
  loading: false,

  fetchEvents: async (filter = null) => {
    set({ loading: true });
    let q = supabase
      .from('events')
      .select('*, event_registrations(count)')
      .eq('visible', true)   // Solo eventos visibles para jugadores
      .order('fecha');

    if (filter && filter !== 'Todos') {
      if (['open', 'active', 'finished', 'draft'].includes(filter)) {
        q = q.eq('status', filter);
      } else {
        q = q.eq('formato', filter);
      }
    }

    const { data } = await q;

    // Auto-ocultar eventos finalizados hace más de 24 horas
    // (lazy evaluation — sin cron job, solo filtramos en el cliente)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const visible = (data ?? []).filter((ev) => {
      if (ev.status === 'finished' && ev.event_finished_at) {
        return new Date(ev.event_finished_at).getTime() > cutoff;
      }
      return true;
    });

    set({ events: visible, loading: false });
  },

  fetchActiveEvent: async (eventId) => {
    const [
      { data: ev },
      { data: teams },
      { data: matches },
      { data: standings },
      { data: regs },
    ] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('teams').select('*, team_players(*, users(nombre, foto_url))').eq('event_id', eventId),
      supabase.from('matches').select('*').eq('event_id', eventId).order('round'),
      supabase.from('standings').select('*').eq('event_id', eventId).order('pts', { ascending: false }),
      supabase.from('event_registrations').select('*, users(nombre, foto_url)').eq('event_id', eventId).eq('status', 'confirmed'),
    ]);
    set({
      activeEvent: {
        event:      ev,
        teams:      teams    ?? [],
        matches:    matches  ?? [],
        standings:  standings ?? [],
        players:    regs     ?? [],
      },
    });
  },

  clearActiveEvent: () => set({ activeEvent: null }),
}));

export default useEventStore;
