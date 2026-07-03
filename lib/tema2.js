// Tema 2 — "Estadio Nocturno + Holo" (rediseño 2026, híbrido A+B).
// Preview GATEADO: se activa SOLO manual con ?preview=tema en la URL (persiste
// en localStorage) y se apaga con ?preview=off. Sin ventana de fechas.
// Cuando Sergio lo apruebe, pasará a ser el skin BASE post-Mundial (20-jul-2026).
// Patrón hermano de lib/modo26.js; tiene PRIORIDAD sobre modo26 en theme.js.

export const TEMA2_FLAG_KEY = 'b2p_tema2';

// Side effect al importar: theme.js importa este módulo antes de computar COLORS,
// así el flag de la URL aplica desde el PRIMER load (sin reload extra).
function processUrlFlag() {
  try {
    if (typeof window === 'undefined' || !window.location) return;
    if (typeof localStorage === 'undefined' || !localStorage) return;
    const p = new URLSearchParams(window.location.search).get('preview');
    if (p === 'tema') localStorage.setItem(TEMA2_FLAG_KEY, 'on');
    else if (p === 'off') localStorage.removeItem(TEMA2_FLAG_KEY);
  } catch (e) {}
}
processUrlFlag();

// Cacheado: el flag solo cambia con URL/reload o setTema2. Evita leer
// localStorage en cada render de cada card en listas (hallazgo del review).
let cachedActive = null;

export function isTema2Active() {
  if (cachedActive !== null) return cachedActive;
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      cachedActive = localStorage.getItem(TEMA2_FLAG_KEY) === 'on';
      return cachedActive;
    }
  } catch (e) {}
  cachedActive = false;
  return cachedActive;
}

export function setTema2(on) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      if (on) localStorage.setItem(TEMA2_FLAG_KEY, 'on');
      else localStorage.removeItem(TEMA2_FLAG_KEY);
    }
  } catch (e) {}
  cachedActive = !!on;
}

// data-tema2="on" en <html>: activa el CSS inyectado (components/Tema2.css)
// y el motor de tilt (components/tema2-fx.js). Llamar al arrancar (App.js),
// junto a applyModo26DomAttribute.
export function applyTema2DomAttribute() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      if (isTema2Active()) document.documentElement.setAttribute('data-tema2', 'on');
      else document.documentElement.removeAttribute('data-tema2');
    }
  } catch (e) {}
}
