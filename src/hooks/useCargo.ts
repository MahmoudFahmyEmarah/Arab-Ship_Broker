import { useState, useEffect, useCallback } from 'react'
import { fetchLiveCargo, type CargoFilters } from '../lib/cargo'
import type { CargoListing } from '../types'

export const useCargo = (filters?: CargoFilters) => {
  const [cargo, setCargo] = useState<CargoListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const data = await fetchLiveCargo(filters)
    setCargo(data)
    setLoading(false)
  }, [JSON.stringify(filters)])

  useEffect(() => { load() }, [load])

  const stats = {
    active: cargo.filter(c => c.status === 'IN').length,
    partial: cargo.filter(c => c.status === 'PARTIAL').length,
    out: cargo.filter(c => c.status === 'OUT').length,
    urgent: cargo.filter(c => {
      if (c.is_spot) return false
      if (!c.laycan_to) return false
      return (new Date(c.laycan_to).getTime() - Date.now()) / 86400000 <= 3
    }).length,
  }

  return { cargo, loading, error, refetch: load, stats }
}
