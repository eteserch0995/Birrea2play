import { supabase } from './supabase';

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
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

export async function uploadAvatar(userId, uri) {
  const ext      = uri.split('.').pop().toLowerCase().replace(/\?.*$/, '');
  const path     = `${userId}.${ext}`;
  const response = await fetch(uri);
  const blob     = await response.blob();
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: `image/${ext}` });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}
