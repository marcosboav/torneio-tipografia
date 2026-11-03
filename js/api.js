// Escolhe a fonte de dados: Supabase quando configurado, senão modo demonstração.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let apiPromise;

export function getApi() {
  if (!apiPromise) {
    apiPromise = SUPABASE_URL && SUPABASE_ANON_KEY
      ? import('./api-supabase.js').then((m) => m.createSupabaseApi(SUPABASE_URL, SUPABASE_ANON_KEY))
      : import('./api-demo.js').then((m) => m.createDemoApi());
  }
  return apiPromise;
}
