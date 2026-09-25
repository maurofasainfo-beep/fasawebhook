import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { config } from '@/lib/config';

export function supabaseServer() {
  const env = config();
  return createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000), cache: 'no-store' }) },
  });
}
