import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// Server-side Supabase client backed by the SERVICE ROLE key. Bypasses RLS.
// Use only in server contexts (Route Handlers, Server Actions). Never ship
// the service role key to the browser.
//
// RLS isn't enabled yet, but lobby routes still use the admin client so that
// when RLS lands they keep working without rewrites.
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
