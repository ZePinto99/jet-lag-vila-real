import { createServerClient, type CookieOptions } from '@supabase/ssr'

// Stub cookie store. Auth is not yet wired; once we add auth, swap this for
// next/headers `cookies()` and a proper read/write adapter.
export function createClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(_name: string) {
          return undefined
        },
        set(_name: string, _value: string, _options: CookieOptions) {
          // no-op until auth is wired
        },
        remove(_name: string, _options: CookieOptions) {
          // no-op until auth is wired
        },
      },
    },
  )
}
