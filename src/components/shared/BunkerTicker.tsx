import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { FuelPrice } from '../../types'

const FRESHNESS = (updatedAt: string): 'current' | 'stale' | 'expired' => {
  const days = (Date.now() - new Date(updatedAt).getTime()) / 86400000
  if (days <= 7) return 'current'
  if (days <= 14) return 'stale'
  return 'expired'
}

const DIRECTION_ARROW = (d?: string) => {
  if (d === 'up') return { symbol: '▲', color: '#97C459' }
  if (d === 'down') return { symbol: '▼', color: '#E24B4A' }
  return { symbol: '—', color: 'rgba(255,255,255,0.4)' }
}

const BunkerTicker: React.FC = () => {
  const [prices, setPrices] = useState<FuelPrice[]>([])
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<Animation | null>(null)

  useEffect(() => {
    supabase
      .from('fuel_prices')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          const sorted = data.sort((a, b) => {
            const order = { current: 0, stale: 1, expired: 2 }
            return order[FRESHNESS(a.updated_at)] - order[FRESHNESS(b.updated_at)]
          })
          setPrices(sorted)
        }
      })
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track || prices.length === 0) return
    const totalWidth = track.scrollWidth / 2
    animRef.current = track.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${totalWidth}px)` }],
      { duration: totalWidth * 16, iterations: Infinity, easing: 'linear' }
    )
  }, [prices])

  useEffect(() => {
    if (animRef.current) {
      paused ? animRef.current.pause() : animRef.current.play()
    }
  }, [paused])

  const now = new Date().toUTCString().slice(17, 22)

  const renderSegment = (p: FuelPrice) => {
    const freshness = FRESHNESS(p.updated_at)
    const opacity = freshness === 'current' ? 1 : freshness === 'stale' ? 0.75 : 0.5
    const days = Math.floor((Date.now() - new Date(p.updated_at).getTime()) / 86400000)

    return (
      <span key={p.id} style={{ opacity, display: 'inline-flex', alignItems: 'center', gap: '0', whiteSpace: 'nowrap' }}>
        {freshness === 'expired' && (
          <span style={{ fontSize: '9px', color: '#EF9F27', fontWeight: 500, marginRight: '6px' }}>Outdated</span>
        )}
        <span
          style={{
            fontSize: '10px', fontWeight: 500,
            color: freshness === 'current' ? '#7BB8F0' : 'rgba(255,255,255,0.4)',
            cursor: 'pointer', marginRight: '2px'
          }}
        >
          {p.sponsor_name}
        </span>
        {freshness === 'stale' && (
          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginRight: '4px' }}>· {days}d</span>
        )}
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)', margin: '0 4px' }}>
          {p.port_area}
        </span>
        {p.vlsfo_usd_mt && <>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)', marginRight: '3px' }}>VLSFO</span>
          <span style={{ fontSize: '10px', fontWeight: 500, color: '#fff' }}>${p.vlsfo_usd_mt}/MT</span>
          <span style={{ fontSize: '9px', marginLeft: '2px', ...DIRECTION_ARROW(p.vlsfo_direction) }}>
            {DIRECTION_ARROW(p.vlsfo_direction).symbol}
          </span>
          {' '}
        </>}
        {p.lsmgo_usd_mt && <>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)', marginRight: '3px' }}>LSMGO</span>
          <span style={{ fontSize: '10px', fontWeight: 500, color: '#fff' }}>${p.lsmgo_usd_mt}/MT</span>
          <span style={{ fontSize: '9px', marginLeft: '2px', color: DIRECTION_ARROW(p.lsmgo_direction).color }}>
            {DIRECTION_ARROW(p.lsmgo_direction).symbol}
          </span>
          {' '}
        </>}
        {p.mgo_usd_mt && <>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)', marginRight: '3px' }}>MGO</span>
          <span style={{ fontSize: '10px', fontWeight: 500, color: '#fff' }}>${p.mgo_usd_mt}/MT</span>
          <span style={{ fontSize: '9px', marginLeft: '2px', color: DIRECTION_ARROW(p.mgo_direction).color }}>
            {DIRECTION_ARROW(p.mgo_direction).symbol}
          </span>
        </>}
        <span style={{ display: 'inline-block', width: '1px', height: '14px', background: 'rgba(255,255,255,0.15)', margin: '0 12px', verticalAlign: 'middle' }} />
      </span>
    )
  }

  if (prices.length === 0) return null

  return (
    <div
      style={{
        background: '#243F60',
        height: '28px',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        flexShrink: 0,
        userSelect: 'none',
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div ref={trackRef} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        {prices.map(renderSegment)}
        {prices.map(p => ({ ...p, id: p.id + '_dup' })).map(renderSegment)}
      </div>
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        width: '160px',
        background: 'linear-gradient(to right, transparent, #243F60 40%)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        paddingRight: '10px'
      }}>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
          Updated {now} UTC
        </span>
      </div>
    </div>
  )
}

export default BunkerTicker
