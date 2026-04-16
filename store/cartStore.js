import { create } from 'zustand';

// cartKey = productId + talla (allows same product in different sizes as separate entries)
const makeKey = (id, talla) => `${id}::${talla ?? ''}`;

const useCartStore = create((set, get) => ({
  items: [],
  gestorId: null,
  gestorNombre: null,
  gestorCode: null,

  // ── Gestor attribution ───────────────────────────────────────────────────
  setGestor: (id, nombre, code) => set({ gestorId: id, gestorNombre: nombre, gestorCode: code }),
  clearGestor: () => set({ gestorId: null, gestorNombre: null, gestorCode: null }),

  // ── Cart items ──────────────────────────────────────────────────────────
  // product may include { talla } for sized products
  addItem: (product) => {
    const { items } = get();
    const cartKey = makeKey(product.id, product.talla);
    const existing = items.find((i) => i.cartKey === cartKey);
    if (existing) {
      set({ items: items.map((i) => i.cartKey === cartKey ? { ...i, qty: i.qty + 1 } : i) });
    } else {
      set({ items: [...items, { ...product, cartKey, qty: 1 }] });
    }
  },

  removeItem: (cartKey) => {
    set({ items: get().items.filter((i) => i.cartKey !== cartKey) });
  },

  updateQty: (cartKey, qty) => {
    if (qty <= 0) {
      get().removeItem(cartKey);
      return;
    }
    set({ items: get().items.map((i) => i.cartKey === cartKey ? { ...i, qty } : i) });
  },

  clearCart: () => set({ items: [] }),

  get total() {
    return get().items.reduce((sum, i) => sum + i.precio * i.qty, 0);
  },

  get itemCount() {
    return get().items.reduce((sum, i) => sum + i.qty, 0);
  },
}));

export default useCartStore;
