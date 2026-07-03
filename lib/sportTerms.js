export const SPORTS = [
  { id: 'futbol',     label: 'Fútbol',         icon: '⚽' },
  { id: 'futbol7',    label: 'Fútbol 7',        icon: '⚽' },
  { id: 'futsal',     label: 'Fútbol Sala',      icon: '⚽' },
  { id: 'volleyball', label: 'Volleyball',       icon: '🏐' },
  { id: 'beach_vb',   label: 'Beach Volleyball', icon: '🏖️' },
  { id: 'padel',      label: 'Pádel',            icon: '🎾' },
  { id: 'tenis',      label: 'Tenis',            icon: '🎾' },
  { id: 'basketball', label: 'Basketball',       icon: '🏀' },
  { id: 'baseball',   label: 'Baseball',         icon: '⚾' },
  { id: 'otro',       label: 'Otro',             icon: '🏅' },
];

const TERMS = {
  futbol:     { posiciones: ['Portero','Defensa','Centrocampista','Delantero'],          formatos: ['Liga','Torneo','Amistoso'] },
  futbol7:    { posiciones: ['Portero','Defensa','Centrocampista','Delantero'],          formatos: ['Liga','Torneo','Amistoso'] },
  futsal:     { posiciones: ['Portero','Cierre','Ala','Pívot'],                         formatos: ['Liga','Torneo','Amistoso'] },
  volleyball: { posiciones: ['Colocador','Opuesto','Central','Líbero','Receptor'],      formatos: ['Liga','Torneo','Amistoso'] },
  beach_vb:   { posiciones: ['Bloqueador','Defensor'],                                  formatos: ['Torneo','Amistoso'] },
  padel:      { posiciones: ['Drive','Revés','Completo'],                               formatos: ['Liga','Torneo','Amistoso'] },
  tenis:      { posiciones: ['Fondo de cancha','Saque y volea','Completo'],             formatos: ['Torneo','Amistoso'] },
  basketball: { posiciones: ['Base','Escolta','Alero','Ala-Pívot','Pívot'],            formatos: ['Liga','Torneo','Amistoso'] },
  baseball:   { posiciones: ['Lanzador','Receptor','Cuadro','Jardinero'],               formatos: ['Liga','Torneo','Amistoso'] },
  otro:       { posiciones: ['Atacante','Defensor','Medio','Otro'],                     formatos: ['Liga','Torneo','Amistoso','Copa'] },
};

export function getSportTerms(sportLabel) {
  const sport = SPORTS.find((s) => s.label === sportLabel);
  if (!sport) return TERMS.otro;
  return TERMS[sport.id] ?? TERMS.otro;
}

// Términos de ANOTACIÓN por deporte — usados por la Pantalla en Vivo (grito del
// overlay) y por los botones de marcador en vivo del gestor/admin.
const SCORING = {
  futbol:     { grito: '¡GOOOL!',   unidad: 'gol',     icon: '⚽' },
  futbol7:    { grito: '¡GOOOL!',   unidad: 'gol',     icon: '⚽' },
  futsal:     { grito: '¡GOOOL!',   unidad: 'gol',     icon: '⚽' },
  volleyball: { grito: '¡PUNTO!',   unidad: 'punto',   icon: '🏐' },
  beach_vb:   { grito: '¡PUNTO!',   unidad: 'punto',   icon: '🏐' },
  padel:      { grito: '¡PUNTO!',   unidad: 'punto',   icon: '🎾' },
  tenis:      { grito: '¡PUNTO!',   unidad: 'punto',   icon: '🎾' },
  basketball: { grito: '¡PUNTO!',   unidad: 'punto',   icon: '🏀' },
  baseball:   { grito: '¡CARRERA!', unidad: 'carrera', icon: '⚾' },
  otro:       { grito: '¡PUNTO!',   unidad: 'punto',   icon: '🏅' },
};

// Los callers pasan `event.deporte ?? 'Fútbol'` (mismo fallback que el resto
// de la app) para que eventos legacy sin deporte sigan gritando gol.
export function getScoringTerms(sportLabel) {
  const sport = SPORTS.find((s) => s.label === sportLabel);
  return SCORING[sport?.id] ?? SCORING.otro;
}

// Reglas de PUNTOS de tabla por deporte. Fútbol clásico 3/1/0. Los deportes
// sin empate usan Victoria 2 / Derrota 1 (sistema FIVB/FIBA: presentarse y
// perder también suma) — `draw` queda definido solo por robustez ante data
// vieja con empates cargados.
const STANDINGS_RULES = {
  futbol:     { win: 3, draw: 1, loss: 0 },
  futbol7:    { win: 3, draw: 1, loss: 0 },
  futsal:     { win: 3, draw: 1, loss: 0 },
  volleyball: { win: 2, draw: 1, loss: 1 },
  beach_vb:   { win: 2, draw: 1, loss: 1 },
  basketball: { win: 2, draw: 1, loss: 1 },
  tenis:      { win: 2, draw: 1, loss: 1 },
  padel:      { win: 2, draw: 1, loss: 1 },
  baseball:   { win: 2, draw: 1, loss: 1 },
  otro:       { win: 3, draw: 1, loss: 0 },
};

export function getStandingsRules(sportLabel) {
  const sport = SPORTS.find((s) => s.label === sportLabel);
  return STANDINGS_RULES[sport?.id] ?? STANDINGS_RULES.otro;
}

export const ALL_FORMATOS = ['Liga', 'Torneo', 'Amistoso', 'Copa'];
export const ALL_GENEROS  = ['Masculino', 'Femenino', 'Mixto', 'Libre'];
