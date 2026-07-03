const COUNTRY_WEAR_COLORS = {
  argentina: 'Blanco',
  colombia: 'Amarillo',
  espana: 'Rojo',
  francia: 'Azul',
};

const HEX_COLOR_NAMES = {
  '#ffffff': 'Blanco',
  '#f2f2f2': 'Blanco',
  '#75aadb': 'Celeste',
  '#fcd116': 'Amarillo',
  '#ffd700': 'Amarillo',
  '#c60b1e': 'Rojo',
  '#ff0000': 'Rojo',
  '#1e2a78': 'Azul',
  '#0000ff': 'Azul',
  '#001a4d': 'Azul',
  '#000000': 'Negro',
  '#008000': 'Verde',
  '#00a651': 'Verde',
  '#800080': 'Morado',
  '#ff7f00': 'Naranja',
};

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function getTeamWearColor(team) {
  const name = normalize(team?.nombre ?? team?.name_es ?? team?.name);
  if (COUNTRY_WEAR_COLORS[name]) return COUNTRY_WEAR_COLORS[name];

  const hex = normalize(team?.color);
  if (HEX_COLOR_NAMES[hex]) return HEX_COLOR_NAMES[hex];

  return 'Por confirmar';
}

export function getTeamNameWithColor(team) {
  const name = team?.nombre ?? team?.name_es ?? team?.name ?? team?.code ?? 'Equipo';
  return `${name} · Color: ${getTeamWearColor(team)}`;
}
