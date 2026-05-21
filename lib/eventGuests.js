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
