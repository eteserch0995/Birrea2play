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

export const ALL_FORMATOS = ['Liga', 'Torneo', 'Amistoso', 'Copa'];
export const ALL_GENEROS  = ['Masculino', 'Femenino', 'Mixto', 'Libre'];
