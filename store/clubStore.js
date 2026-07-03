import { create } from 'zustand';
import { supabase } from '../lib/supabase';

// Store del modulo Club de Beneficios.
// - settings: fila unica club_settings (is_visible controla visibilidad para no-admin)
// - myCompanies: empresas donde el user es staff (le habilita el modulo comercio)

const useClubStore = create((set, get) => ({
  settings: null,
  myCompanies: [],
  loading: false,
  loaded: false,

  loadSettings: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { data } = await supabase
        .from('club_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      set({ settings: data ?? null, loading: false, loaded: true });
    } catch (_) {
      set({ loading: false });
    }
  },

  loadMyCompanies: async (userId) => {
    if (!userId) { set({ myCompanies: [] }); return; }
    try {
      const { data } = await supabase
        .from('partner_company_staff')
        .select('company_id, is_primary, partner_companies(*)')
        .eq('user_id', userId);
      const companies = (data ?? [])
        .map((r) => r.partner_companies)
        .filter(Boolean);
      set({ myCompanies: companies });
    } catch (_) {
      set({ myCompanies: [] });
    }
  },

  // Admin siempre ve el modulo; resto solo si is_visible=true.
  isVisibleTo: (userRole) => {
    if (userRole === 'admin') return true;
    return get().settings?.is_visible === true;
  },

  isStaff: () => (get().myCompanies?.length ?? 0) > 0,

  reset: () => set({ settings: null, myCompanies: [], loaded: false }),
}));

export default useClubStore;
