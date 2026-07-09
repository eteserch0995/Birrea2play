// Nombre del color de PETO que debe vestir un equipo (seccion "que color
// llevar?"). FUENTE DE VERDAD = el color real del equipo (team.color, el que
// elige el gestor).
//
// Bug historico (2026-07-09): un mapa por NOMBRE de pais pisaba el color real
// -p.ej. cualquier equipo llamado "Argentina" salia "Blanco" aunque el gestor
// pusiera celeste-. Ahora el color manda; el nombre de pais es solo fallback
// cuando el equipo no tiene color propio.

// Paleta base nombrada (misma que TEAM_COLORS del picker). Cualquier hex se
// mapea al color nombrado mas cercano por distancia RGB: robusto para colores
// custom y para los colores de seleccion (celeste, etc.).
const NAMED_COLORS = [
  { nombre: 'Rojo',     rgb: [230, 57, 70]   }, // #E63946
  { nombre: 'Azul',     rgb: [69, 123, 157]  }, // #457B9D
  { nombre: 'Verde',    rgb: [45, 198, 83]   }, // #2DC653
  { nombre: 'Negro',    rgb: [43, 45, 66]    }, // #2B2D42
  { nombre: 'Blanco',   rgb: [232, 232, 232] }, // #E8E8E8
  { nombre: 'Rosa',     rgb: [255, 107, 157] }, // #FF6B9D
  { nombre: 'Amarillo', rgb: [255, 190, 11]  }, // #FFBE0B
  { nombre: 'Naranja',  rgb: [251, 86, 7]    }, // #FB5607
  { nombre: 'Morado',   rgb: [123, 45, 139]  }, // #7B2D8B
  { nombre: 'Celeste',  rgb: [72, 202, 228]  }, // #48CAE4
];

// Fallback por nombre de seleccion SOLO cuando el equipo no tiene color valido.
const COUNTRY_WEAR_COLORS = {
  argentina: 'Celeste',
  colombia:  'Amarillo',
  espana:    'Rojo',
  francia:   'Azul',
};

// lowercase + trim + quita tildes/enye comunes (sin usar rangos de marcas
// combinantes, que son fragiles en el fuente).
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/á|à|ä|â/g, 'a')
    .replace(/é|è|ë|ê/g, 'e')
    .replace(/í|ì|ï|î/g, 'i')
    .replace(/ó|ò|ö|ô/g, 'o')
    .replace(/ú|ù|ü|û/g, 'u')
    .replace(/ñ/g, 'n')
    .trim();
}

function hexToRgb(hex) {
  const m = String(hex ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

// Color nombrado mas cercano a un hex (distancia euclidiana en RGB).
function nearestColorName(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  let best = null;
  let bestDist = Infinity;
  for (const c of NAMED_COLORS) {
    const d =
      (rgb[0] - c.rgb[0]) ** 2 +
      (rgb[1] - c.rgb[1]) ** 2 +
      (rgb[2] - c.rgb[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = c.nombre; }
  }
  return best;
}

export function getTeamWearColor(team) {
  // El color real del equipo manda (lo que el gestor eligio en el picker).
  const byColor = nearestColorName(team?.color);
  if (byColor) return byColor;
  // Fallback: nombre de seleccion conocido, si no hay color valido.
  const name = normalize(team?.nombre ?? team?.name_es ?? team?.name);
  if (COUNTRY_WEAR_COLORS[name]) return COUNTRY_WEAR_COLORS[name];
  return 'Por confirmar';
}

export function getTeamNameWithColor(team) {
  const name = team?.nombre ?? team?.name_es ?? team?.name ?? team?.code ?? 'Equipo';
  return `${name} · Color: ${getTeamWearColor(team)}`;
}
