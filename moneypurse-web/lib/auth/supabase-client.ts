import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser Supabase client, built from public env. Supabase is the add-on identity layer for
 * customer sign-up/login; the banking core still owns roles, data and the audit chain. When the
 * env is not set the app still builds and runs - the Supabase paths simply report "not configured".
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

let cached: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const config = getSupabaseConfig();
  cached = config
    ? createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;
  return cached;
}
