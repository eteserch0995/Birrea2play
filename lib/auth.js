import { supabase } from './supabase';

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: 'birrea2play://auth/callback' },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function createUserProfile(authId, profileData) {
  // Usamos función SECURITY DEFINER para bypasear RLS en el registro
  const { data, error } = await supabase.rpc('create_user_profile', {
    p_auth_id: authId,
    p_nombre: profileData.nombre,
    p_correo: profileData.correo,
    p_telefono: profileData.telefono ?? null,
    p_residencia: profileData.residencia ?? null,
    p_cedula: profileData.cedula ?? null,
    p_contacto_emergencia: profileData.contacto_emergencia ?? null,
    p_deporte: profileData.deporte ?? 'Fútbol 7',
    p_nivel: profileData.nivel ?? 'Recreativo',
    p_posicion: profileData.posicion ?? null,
    p_foto_url: profileData.foto_url ?? null,
    p_genero: profileData.genero ?? null,
  });
  if (error) throw error;
  return data;
}

export async function getUserProfile(authId) {
  const { data, error } = await supabase
    .from('users')
    .select('*, wallets(id, balance)')
    .eq('auth_id', authId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateUserProfile(userId, updates) {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadAvatar(userId, source) {
  // `source` puede ser string (uri en native) u objeto asset { uri, file } (en web).
  // Antes asumía string y rompía con TypeError ".split is not a function" cuando
  // EditProfileScreen pasaba el asset entero, silenciado por un catch upstream.
  const refUri = typeof source === 'string' ? source : source?.uri ?? '';
  const ext = (refUri.split('.').pop() ?? 'jpg').toLowerCase().replace(/\?.*$/, '');
  const safeExt = ['jpg','jpeg','png','webp','heic'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
  const path = `${userId}.${safeExt}`;
  const { uploadImage } = await import('./uploadImage');
  const url = await uploadImage('avatars', path, source);
  return `${url}?t=${Date.now()}`;
}
