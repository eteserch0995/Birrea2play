import { create } from 'zustand';
import { supabase } from '../lib/supabase';

// Store para el módulo Mundial 2026.
// Cachea la config global (wc_pools fila única) en memoria.
// Re-cargá con loadPool() después de cambios de admin (toggle is_visible, etc).

const useWcStore = create((set, get) => ({
  pool: null,
  loading: false,
  loaded: false,

  loadPool: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('wc_pools')
        .select('*')
        .eq('season', 'fifa_wc_2026')
        .maybeSingle();
      if (error) {
        set({ loading: false });
        return;
      }
      set({ pool: data ?? null, loading: false, loaded: true });
    } catch (_) {
      set({ loading: false });
    }
  },

  // Determina si el módulo Mundial es visible para un user dado.
  // - Admin siempre lo ve.
  // - Resto solo si wc_pools.is_visible = true.
  isVisibleTo: (userRole) => {
    if (userRole === 'admin') return true;
    const { pool } = get();
    return pool?.is_visible === true;
  },

  reset: () => set({ pool: null, loaded: false }),
}));

export default useWcStore;
