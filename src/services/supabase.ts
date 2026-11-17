import { createClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase. Solo se activa si existen las variables de entorno
 * VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver .env.example).
 * Sin ellas, el juego funciona igual en modo offline.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const isSupabaseEnabled = supabase !== null;

/** Guarda una puntuación en la tabla `scores` (ver supabase/schema.sql). */
export async function saveScore({ level, strokes }: { level: number; strokes: number }) {
  if (!supabase) {
    console.info('[supabase] no configurado, puntuación no guardada', { level, strokes });
    return null;
  }
  const { data, error } = await supabase.from('scores').insert({ level, strokes }).select().single();
  if (error) console.error('[supabase] error guardando puntuación', error);
  return data;
}

/** Devuelve las mejores puntuaciones de un nivel. */
export async function getTopScores(level: number, limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('level', level)
    .order('strokes', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[supabase] error leyendo puntuaciones', error);
    return [];
  }
  return data;
}
