import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Warn but don't crash — blank page is harder to debug than a console warning
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[ArabShipBroker] Missing Supabase env vars.\n' +
    'VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗ MISSING',
    '\nVITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✓' : '✗ MISSING'
  )
}

export const supabase = createClient(
  supabaseUrl  ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder'
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
