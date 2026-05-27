import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = (import.meta.env.VITE_SUPABASE_URL     as string) || ''
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[ArabShipBroker] Supabase env vars missing:\n' +
    '  VITE_SUPABASE_URL:      ' + (supabaseUrl     ? '✓' : '✗ MISSING') + '\n' +
    '  VITE_SUPABASE_ANON_KEY: ' + (supabaseAnonKey ? '✓' : '✗ MISSING') + '\n' +
    'Add these in Vercel → Environment Variables and redeploy.'
  )
}

// Use placeholders so app renders the login page even if misconfigured
// (login will fail with a visible message rather than a blank page)
export const supabase = createClient(
  supabaseUrl     || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key-replace-in-vercel'
)

export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password })

export const signOut = () => supabase.auth.signOut()

export const getSession = () => supabase.auth.getSession()

export const isAdmin = async (): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return false
  return session.user?.app_metadata?.role === 'admin'
}
