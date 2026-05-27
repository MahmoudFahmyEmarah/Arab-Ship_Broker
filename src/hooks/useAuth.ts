import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { AppUser, SubscriptionTier } from '../types'
import type { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  profile: AppUser | null
  tier: SubscriptionTier
  isAdmin: boolean
  loading: boolean
}

export const useAuth = (): AuthState => {
  const [state, setState] = useState<AuthState>({
    user: null, profile: null, tier: 'T1', isAdmin: false, loading: true
  })

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setState(s => ({ ...s, loading: false }))
        return
      }
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single()

      const isAdmin = session.user.app_metadata?.role === 'admin'

      setState({
        user: session.user,
        profile: profile ?? null,
        tier: (profile?.subscription_tier as SubscriptionTier) ?? 'T1',
        isAdmin,
        loading: false
      })
    }
    load()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setState({ user: null, profile: null, tier: 'T1', isAdmin: false, loading: false })
      } else {
        load()
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return state
}
