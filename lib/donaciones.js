/**
 * lib/donaciones.js — Recaudo Solidario (Venezuela).
 *
 * Flujo de donación INDEPENDIENTE del flujo de pago de eventos:
 *  - Yappy:   iniciarBotonYappy({ tipo: 'donacion' }) → yappy-ipn → registrar_donacion()
 *  - Tarjeta: iniciarPagoTarjeta({ tipo: 'donacion', credito_monto: base }) → pf-webhook → registrar_donacion()
 *
 * NO toca wallet, eventos, ni inscripciones. Solo inserta en la tabla `donaciones`.
 */
import { supabase } from './supabase';

export const RECAUDO = {
  campana: 'venezuela',
  whatsappProductos: '50761222854', // +507 6122-2854 (coordinar donación de productos físicos)
  feePct: 0.01,    // 1% del monto (solo tarjeta, si el donante elige cubrir la comisión)
  feeFixed: 0.50,  // + $0.50 fijo (solo tarjeta)
  min: 1,          // mínimo $1.00 (Yappy y tarjeta)
  yappyMax: 500,   // tope duro de Yappy Botón de Pago V2
  cardMax: 2000,   // tope de seguridad anti fat-finger para tarjeta
};

/** Comisión que se suma al cobro de tarjeta si el donante decide cubrirla. */
export function cardFee(base) {
  const b = Number(base) || 0;
  if (b <= 0) return 0;
  return Math.round((b * RECAUDO.feePct + RECAUDO.feeFixed) * 100) / 100;
}

/** Total a cobrar en tarjeta según si cubre o no la comisión. */
export function cardTotal(base, coverFee) {
  const b = Number(base) || 0;
  return coverFee ? Math.round((b + cardFee(b)) * 100) / 100 : Math.round(b * 100) / 100;
}

/** Agregados públicos para el termómetro: recaudado, donantes, donaciones, gastado y disponible. */
export async function getRecaudoStats() {
  const { data, error } = await supabase.rpc('get_recaudo_stats', { p_campana: RECAUDO.campana });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total:      Number(row?.total ?? 0),
    donantes:   Number(row?.donantes ?? 0),
    cantidad:   Number(row?.cantidad ?? 0),
    gastado:    Number(row?.gastado ?? 0),
    disponible: Number(row?.disponible ?? 0),
  };
}

/** Compras hechas con el fondo (transparencia): factura + detalle + fotos. */
export async function getRecaudoCompras() {
  const { data, error } = await supabase
    .from('recaudo_compras')
    .select('id, fecha, comercio, descripcion, monto, items, factura_url, foto_url')
    .eq('campana', RECAUDO.campana)
    .order('fecha', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Link de WhatsApp para coordinar donación de productos físicos. */
export function whatsappProductosUrl() {
  const text = encodeURIComponent(
    'Hola, quiero donar productos para el Recaudo Solidario por Venezuela. ¿Cómo coordinamos la entrega?',
  );
  return `https://wa.me/${RECAUDO.whatsappProductos}?text=${text}`;
}

// Recolección de productos físicos.
export const PICKUP = {
  // Zonas céntricas cercanas a la capital donde SÍ recogemos. NO Panamá Norte/Este/Oeste.
  zones: [
    'Tumba Muerto', 'Transístmica', 'Bethania', 'Vía España', 'Bella Vista',
    'Obarrio', 'San Francisco', 'El Cangrejo', 'Calidonia', 'Pueblo Nuevo', 'Otros',
  ],
  dropoffMaps: 'https://maps.app.goo.gl/1fi8V9UD8fkZnw2TA',
  dropoffLabel: 'PH Victory Tower, Villa de las Fuentes, Tumba Muerto',
  dropoffApto: 'Apto 10C',
  dropoffRecibe: 'Vilma Guevara',
};

/** WhatsApp con los datos del formulario de recolección pre-cargados. */
export function whatsappRecoleccionUrl(f = {}) {
  const lines = [
    'Hola, quiero DONAR PRODUCTOS para el Recaudo Solidario por Venezuela.',
    '',
    `Nombre: ${f.nombre ?? ''}`,
    `Contacto: ${f.telefono ?? ''}`,
    `Zona/Sector: ${f.zona ?? ''}`,
    `Provincia: ${f.provincia ?? ''}`,
    `Distrito: ${f.distrito ?? ''}`,
    `Corregimiento: ${f.corregimiento ?? ''}`,
    `Barriada: ${f.barriada ?? ''}`,
    `Calle/Apartamento: ${f.calle ?? ''}`,
    `Disponibilidad de recolección: ${f.horario ?? ''}`,
  ];
  return `https://wa.me/${RECAUDO.whatsappProductos}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/** WhatsApp para voluntarios que quieren ayudar con la recolección (con sus datos). */
export function whatsappVoluntarioUrl(v = {}) {
  const lines = [
    'Hola, quiero AYUDAR EN LA RECOLECCIÓN de productos para el Recaudo Solidario por Venezuela.',
    '',
    `Nombre: ${v.nombre ?? ''}`,
    `Contacto: ${v.telefono ?? ''}`,
    `Zona donde puede ayudar: ${v.zona ?? ''}`,
    `Disponibilidad: ${v.disponibilidad ?? ''}`,
  ];
  return `https://wa.me/${RECAUDO.whatsappProductos}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/** Lista de insumos sugeridos (espejo del flyer). */
export const PRODUCTOS_SUGERIDOS = [
  'Agua embotellada',
  'Alimentos no perecederos',
  'Leche en polvo y alimentos para bebés',
  'Artículos de higiene personal',
  'Pañales y toallitas húmedas',
  'Insumos de primeros auxilios',
  'Linternas, pilas y cargadores portátiles',
  'Mantas, colchonetas o artículos de refugio',
];
