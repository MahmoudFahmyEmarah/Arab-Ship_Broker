import { supabase } from './supabase'
import type { CargoListing, ZoneEnum, CargoType, CargoStatus } from '../types'

export interface CargoFilters {
  zones?: ZoneEnum[]
  cargoType?: CargoType
  status?: CargoStatus[]
  isSpot?: boolean
  commodityCategory?: string
  qtyMinMt?: number
  qtyMaxMt?: number
}

export const fetchLiveCargo = async (filters?: CargoFilters): Promise<CargoListing[]> => {
  let query = supabase
    .from('v_live_cargo')
    .select(`
      *,
      matches(count)
    `)
    .order('created_at', { ascending: false })

  if (filters?.zones?.length) {
    query = query.in('load_zone', filters.zones)
  }
  if (filters?.cargoType) {
    query = query.eq('cargo_type', filters.cargoType)
  }
  if (filters?.status?.length) {
    query = query.in('status', filters.status)
  }
  if (filters?.isSpot !== undefined) {
    query = query.eq('is_spot', filters.isSpot)
  }
  if (filters?.commodityCategory) {
    query = query.eq('commodity_category', filters.commodityCategory)
  }

  const { data, error } = await query

  if (error) {
    console.error('fetchLiveCargo error:', error)
    return []
  }

  return (data || []).map(row => ({
    ...row,
    match_count: row.matches?.[0]?.count ?? 0
  }))
}

export const fetchCargoById = async (id: string): Promise<CargoListing | null> => {
  const { data, error } = await supabase
    .from('cargo_listings')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

// Scope from status
export const getScopeFromStatus = (status: CargoStatus): 'IN' | 'PARTIAL' | 'OUT' => {
  if (status === 'IN') return 'IN'
  if (status === 'PARTIAL') return 'PARTIAL'
  return 'OUT'
}

// Border colour by scope
export const getScopeColor = (status: CargoStatus): string => {
  if (status === 'IN') return '#97C459'
  if (status === 'PARTIAL') return '#EF9F27'
  return '#E24B4A'
}

// Category badge config
export const getCategoryBadge = (cargoType: CargoType, isGrain: boolean) => {
  if (isGrain) return { label: 'GRAIN', bg: '#EAF3DE', color: '#27500A' }
  if (cargoType === 'Break Bulk') return { label: 'BREAK BULK', bg: '#FAEEDA', color: '#854F0B' }
  return { label: 'DRY BULK', bg: '#E6F1FB', color: '#0C447C' }
}

// Laycan display
export const formatLaycan = (from?: string, to?: string, isSpot?: boolean): string => {
  if (isSpot) return 'SPOT'
  if (!from) return '—'
  const f = new Date(from)
  const t = to ? new Date(to) : null
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (!t || f.getMonth() === t.getMonth()) {
    return `${f.getDate()} / ${t ? t.getDate() : f.getDate()} ${months[f.getMonth()]}`
  }
  return `${f.getDate()} ${months[f.getMonth()]} / ${t.getDate()} ${months[t.getMonth()]}`
}

// Volume calculation
export const calcVolume = (qtyMt: number, sfM3t?: number): number | null => {
  if (!sfM3t) return null
  return Math.round(qtyMt * sfM3t)
}

// WOG detection from notes
export const detectWog = (notes?: string): boolean => {
  if (!notes) return false
  return /\bWOG\b/i.test(notes)
}
