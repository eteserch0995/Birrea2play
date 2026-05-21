import { create } from 'zustand';
import { signIn, signOut, getUserProfile, updateUserProfile, uploadAvatar } from '../lib/auth';
import { supabase } from '../lib/supabase';
// Lazy import to avoid circular dependency
const getCartStore = () => require('./cartStore').default;

function withTimeout(promise, ms, label = 'auth query') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

const useAuthStore = create((set, get) => ({
  user: null,
  walletBalance: 0,
  isLoading: false,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const { user: authUser } = await signIn(email, password);
      try {
        const profile = await getUserProfile(authUser.id);
        // PostgREST returns one-to-many joins as arrays — normalize to single object
        const wallet = Array.isArray(profile.wallets) ? (profile.wallets[0] ?? null) : (profile.wallets ?? null);
        set({
          user: { ...profile, wallets: wallet },
          walletBalance: wallet?.balance ?? 0,
          isAuthenticated: true,
        });
      } catch (profileErr) {
        // Auth succeeded but profile load failed — sign out to avoid limbo state
        signOut().catch(() => {});
        throw new Error('No se pudo cargar tu perfil. Intenta nuevamente.');
      }
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await signOut();
      // Clear cart so a subsequent user doesn't see previous user's items
      getCartStore().getState().clearCart();
      set({ user: null, walletBalance: 0, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  loadProfile: async (authId) => {
    try {
      const profile = await getUserProfile(authId);
      // PostgREST returns one-to-many joins as arrays — normalize to single object
      const wallet = Array.isArray(profile.wallets) ? (profile.wallets[0] ?? null) : (profile.wallets ?? null);
      set({
        user: { ...profile, wallets: wallet },
        walletBalance: wallet?.balance ?? 0,
        isAuthenticated: true,
      });
    } catch (e) {
      // Only log out if there is genuinely no active session.
      // Logging out on network errors or query failures causes unexpected logouts.
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        5000,
        'loadProfile.getSession'
      ).catch(() => ({ data: { session: null } }));
      if (!session) {
        set({ user: null, isAuthenticated: false });
      }
    }
  },

  // Silent refresh — updates profile data without ever logging out.
  // Use this inside screens (useFocusEffect, pull-to-refresh) instead of loadProfile.
  refreshProfile: async () => {
    const { user } = get();
    if (!user?.auth_id) return;
    try {
      const profile = await getUserProfile(user.auth_id);
      const wallet = Array.isArray(profile.wallets) ? (profile.wallets[0] ?? null) : (profile.wallets ?? null);
      set({ user: { ...profile, wallets: wallet }, walletBalance: wallet?.balance ?? 0 });
    } catch (_) {
      // Network or query error — keep existing user data, never logout
    }
  },

  updateProfile: async (data) => {
    const { user } = get();
    if (!user) return;
    const updated = await updateUserProfile(user.id, data);
    set({ user: { ...user, ...updated } });
  },

  updatePhoto: async (uri) => {
    const { user } = get();
    if (!user) return;
    const url = await uploadAvatar(user.id, uri);
    await updateUserProfile(user.id, { foto_url: url });
    set({ user: { ...user, foto_url: url } });
  },

  setWalletBalance: (balance) => set({ walletBalance: balance }),

  subscribeToWallet: () => {
    const { user } = get();
    // user.wallets is normalized to a single object (or null) — guard against missing wallet row
    if (!user?.id) return () => {};
    const channel = supabase
      .channel(`wallet-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'wallets',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        set({ walletBalance: payload.new.balance });
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  },
}));

export default useAuthStore;
