export function getActiveRegistrationUserIds(registrations = []) {
  return new Set(
    (registrations ?? [])
      .filter((r) => ['confirmed', 'pending'].includes(r.status ?? 'confirmed'))
      .map((r) => r.user_id)
      .filter(Boolean)
  );
}

export function isActiveEventGuest(guest, registrations = []) {
  if (!guest) return false;
  if (guest.status && !['confirmed', 'pending_payment'].includes(guest.status)) return false;
  if (!guest.invited_by) return true;
  return getActiveRegistrationUserIds(registrations).has(guest.invited_by);
}

export function filterActiveEventGuests(guests = [], registrations = []) {
  const activeUserIds = getActiveRegistrationUserIds(registrations);
  return (guests ?? []).filter((guest) => {
    if (guest.status && !['confirmed', 'pending_payment'].includes(guest.status)) return false;
    return !guest.invited_by || activeUserIds.has(guest.invited_by);
  });
}

/**
 * Calcula la capacidad de un evento (total + por género si aplica) a partir
 * de las inscripciones y los guests activos.
 *
 *   event.cupos_hombres / cupos_mujeres: solo cuentan si event.genero='Mixto'
 *     y ambos están definidos. Si están null, se usa solo cupos_total.
 *
 *   regsWithGender: array de { user_id, status, users:{genero} } o similar
 *     — necesita el genero del registrante para contar por bucket.
 *   guestsActive: array filtrado por filterActiveEventGuests con { genero }
 *
 * Retorna: {
 *   hasGenderQuota: boolean,
 *   total:   { cupo, ocupados, disponible, lleno },
 *   hombres: { cupo, ocupados, disponible, lleno } | null,
 *   mujeres: { cupo, ocupados, disponible, lleno } | null,
 * }
 */
export function computeEventCapacity(event, regsWithGender = [], guestsActive = []) {
  const cupoTotal = event?.cupos_total ?? null;
  const isMixto   = event?.genero === 'Mixto';
  const hasGenderQuota = isMixto
    && event?.cupos_hombres != null
    && event?.cupos_mujeres != null;

  const countByGender = (genero) =>
    regsWithGender.filter((r) => (r.users?.genero ?? r.genero) === genero).length
    + guestsActive.filter((g) => g.genero === genero).length;

  const ocupadosTotal = regsWithGender.length + guestsActive.length;

  const result = {
    hasGenderQuota,
    total: {
      cupo:        cupoTotal,
      ocupados:    ocupadosTotal,
      disponible:  cupoTotal == null ? Infinity : Math.max(0, cupoTotal - ocupadosTotal),
      lleno:       cupoTotal != null && ocupadosTotal >= cupoTotal,
    },
    hombres: null,
    mujeres: null,
  };

  if (hasGenderQuota) {
    const ocupH = countByGender('Masculino');
    const ocupM = countByGender('Femenino');
    result.hombres = {
      cupo: event.cupos_hombres,
      ocupados: ocupH,
      disponible: Math.max(0, event.cupos_hombres - ocupH),
      lleno: ocupH >= event.cupos_hombres,
    };
    result.mujeres = {
      cupo: event.cupos_mujeres,
      ocupados: ocupM,
      disponible: Math.max(0, event.cupos_mujeres - ocupM),
      lleno: ocupM >= event.cupos_mujeres,
    };
  }

  return result;
}

/**
 * Dado el resultado de computeEventCapacity y el género del aspirante,
 * decide si tiene cupo. Para eventos con desglose, valida contra su género.
 * Para eventos sin desglose o no-Mixto, valida solo total.
 *   Retorna { allowed, reason } — reason es un mensaje listo para mostrar al user.
 */
export function checkSpotAvailable(capacity, aspiranteGenero, eventGenero) {
  if (capacity.total.cupo == null) return { allowed: true };   // ilimitado
  if (capacity.total.lleno && !capacity.hasGenderQuota) {
    return { allowed: false, reason: `Evento lleno (${capacity.total.cupo} cupos).` };
  }
  if (capacity.hasGenderQuota) {
    if (!aspiranteGenero) {
      return {
        allowed: false,
        reason: 'Necesitamos saber tu género para asignar tu cupo. Completá tu perfil antes de inscribirte.',
      };
    }
    if (aspiranteGenero === 'Masculino') {
      if (capacity.hombres.lleno) {
        return {
          allowed: false,
          reason: `No hay más cupos de hombres (${capacity.hombres.cupo}/${capacity.hombres.cupo}). Quedan ${capacity.mujeres.disponible} cupos de mujeres.`,
        };
      }
    } else if (aspiranteGenero === 'Femenino') {
      if (capacity.mujeres.lleno) {
        return {
          allowed: false,
          reason: `No hay más cupos de mujeres (${capacity.mujeres.cupo}/${capacity.mujeres.cupo}). Quedan ${capacity.hombres.disponible} cupos de hombres.`,
        };
      }
    }
  } else if (eventGenero && eventGenero !== 'Mixto' && aspiranteGenero && aspiranteGenero !== eventGenero) {
    return {
      allowed: false,
      reason: `Este evento es solo para ${eventGenero}.`,
    };
  }
  return { allowed: true };
}
