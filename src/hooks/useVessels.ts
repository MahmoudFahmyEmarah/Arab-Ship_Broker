import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { VesselAvailability, ZoneEnum } from '../types'

interface VesselFilters {
  zones?: ZoneEnum[]
  geared?: boolean
  dwtMin?: number
  dwtMax?: number
}

export const useVessels = (filters?: VesselFilters) => {
  const [vessels, setVessels] = useState<VesselAvailability[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('v_live_vessels')
      .select('*, vessel:vessels(*), matches(count)')
      .order('open_date', { ascending: true, nullsFirst: true })

    if (filters?.zones?.length) q = q.in('open_zone', filters.zones)
    if (filters?.geared !== undefined) q = q.eq('is_geared', filters.geared)

    const { data } = await q
    setVessels((data ?? []).map(row => ({
      ...row,
      match_count: row.matches?.[0]?.count ?? 0
    })))
    setLoading(false)
  }, [JSON.stringify(filters)])

  useEffect(() => { load() }, [load])

  const stats = {
    open: vessels.filter(v => v.status === 'OPEN').length,
    onSubs: vessels.filter(v => v.status === 'ON SUBS').length,
    fixed: vessels.filter(v => v.status === 'FIXED').length,
    overdue: vessels.filter(v => {
      return v.status === 'OPEN' && v.open_date && new Date(v.open_date) < new Date()
    }).length,
  }

  return { vessels, loading, refetch: load, stats }
}
