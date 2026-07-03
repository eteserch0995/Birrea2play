// Mock de HISTORIAS estilo Instagram para el preview.
//
// Cada usuario tiene 1-3 segmentos (fotos). En produccion cada segmento expira a
// las 24h: se filtra por created_at, y cuando un usuario se queda sin segmentos
// vivos, su circulo desaparece de la barra de arriba.
//
// Media 100% OFFLINE: la "foto" de cada segmento es un placeholder de color (tone).
// No hay URLs remotas ni llamadas a Supabase.

import { COLORS } from '../../constants/theme';

const T = {
  navy: COLORS.navy, purple: COLORS.purple, blue: COLORS.blue, red: COLORS.red,
  green: COLORS.green, orange: COLORS.orange, magenta: COLORS.magenta, card2: COLORS.card2,
};

// items: segmentos de la historia (cada uno = una foto que dura 24h)
export function getMockStories() {
  return [
    {
      id: 'you', username: 'Tu historia', initial: 'T', tone: T.navy,
      isYou: true, seen: false, items: [],
    },
    {
      id: 'u1', username: 'yeimontoya', initial: 'Y', tone: T.magenta, seen: false,
      items: [
        { tone: T.magenta, timeAgo: 'hace 2 h', expiresIn: '22 h', caption: 'Que partidazo anoche' },
        { tone: T.purple, timeAgo: 'hace 2 h', expiresIn: '22 h', caption: '' },
      ],
    },
    {
      id: 'u2', username: 'tripleshot.pty', initial: 'T', tone: T.green, seen: false,
      items: [
        { tone: T.navy, timeAgo: 'hace 3 h', expiresIn: '21 h', caption: 'Armamos para el domingo' },
      ],
    },
    {
      id: 'u3', username: 'emyc17', initial: 'E', tone: T.orange, seen: false,
      items: [
        { tone: T.orange, timeAgo: 'hace 5 h', expiresIn: '19 h', caption: 'Golazo del torneo' },
        { tone: T.red, timeAgo: 'hace 5 h', expiresIn: '19 h', caption: '' },
        { tone: T.blue, timeAgo: 'hace 5 h', expiresIn: '19 h', caption: 'Equipo campeon' },
      ],
    },
    {
      id: 'u4', username: 'kevin_o9', initial: 'K', tone: T.blue, seen: true,
      items: [
        { tone: T.blue, timeAgo: 'hace 8 h', expiresIn: '16 h', caption: '' },
      ],
    },
    {
      id: 'u5', username: 'la_bombonera', initial: 'L', tone: T.red, seen: true,
      items: [
        { tone: T.card2, timeAgo: 'hace 11 h', expiresIn: '13 h', caption: 'Cancha lista' },
      ],
    },
    {
      id: 'u6', username: 'fut7_pty', initial: 'F', tone: T.green, seen: true,
      items: [
        { tone: T.green, timeAgo: 'hace 20 h', expiresIn: '4 h', caption: 'Ultimos cupos del finde' },
      ],
    },
  ];
}

// Tonos disponibles para que el usuario "elija una foto" al publicar su historia.
export const ADD_TONES = [T.red, T.green, T.blue, T.purple, T.orange, T.magenta];
