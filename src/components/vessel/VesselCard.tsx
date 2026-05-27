import React from 'react'
import type { VesselAvailability, SubscriptionTier } from '../../types'

interface Props {
  availability: VesselAvailability
  viewerTier: SubscriptionTier
  onSelect?: (va: VesselAvailability) => void
  selected?: boolean
}

const STATUS_CONFIG = {
  OPEN:      { bg: '#EAF3DE', color: '#27500A', border: '#97C459' },
  'ON SUBS': { bg: '#FAEEDA', color: '#854F0B', border: '#EF9F27' },
  FIXED:     { bg: '#F1EFE8', color: '#5F5E5A', border: 'rgba(0,0,0,0.15)' },
  INACTIVE:  { bg: '#F1EFE8', color: '#888780', border: 'rgba(0,0,0,0.1)' },
}

const VesselCard: React.FC<Props> = ({ availability: va, viewerTier, onSelect, selected }) => {
  const vessel = va.vessel
  const statusCfg = STATUS_CONFIG[va.status] ?? STATUS_CONFIG.OPEN
  const isOverdue = va.open_date && new Date(va.open_date) < new Date() && va.status === 'OPEN'
  const borderColor = isOverdue ? '#E24B4A' : statusCfg.border
  const displayDwt = vessel?.dwcc ?? vessel?.dwt_grain

  const showPartner = va.for_circulation && (viewerTier === 'T3' || viewerTier === 'T4')
  const showLocked  = va.for_circulation && viewerTier === 'T2'

  const formatDate = (d?: string) => {
    if (!d) return '—'
    const dt = new Date(d)
    return `${dt.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]} ${dt.getFullYear()}`
  }

  return (
    <div
      onClick={() => onSelect?.(va)}
      style={{
        background: 'var(--color-background-primary)',
        border: selected ? '1.5px solid #185FA5' : '0.5px solid var(--color-border-tertiary)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '6px',
        padding: '9px 9px 0',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        transition: 'border-color 0.15s, transform 0.15s',
        fontFamily: 'Inter, -apple-system, sans-serif',
      }}
      onMouseEnter={e => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#185FA5'
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border-tertiary)'
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
      }}
    >
      {/* LINE 1 — Vessel name + Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
        <span style={{
          fontSize: '12px', fontWeight: 600, color: '#1B3A5C',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1
        }}>
          {vessel?.vessel_name ?? 'TBN'}
        </span>
        <span style={{
          fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px',
          background: isOverdue ? '#FCEBEB' : statusCfg.bg,
          color: isOverdue ? '#A32D2D' : statusCfg.color,
          flexShrink: 0
        }}>
          {isOverdue ? 'OVERDUE' : va.status}
        </span>
      </div>

      {/* LINE 2 — Flag · Type · Gear */}
      <div style={{ fontSize: '9px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {[vessel?.flag, vessel?.vessel_type, vessel?.is_geared ? 'Geared' : vessel?.is_geared === false ? 'Gearless' : null]
          .filter(Boolean).join(' · ')}
      </div>

      {/* DATA GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px', marginTop: '2px' }}>
        <DataCell label="DWT">
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {vessel?.dwt_grain?.toLocaleString() ?? '—'}
          </span>
        </DataCell>
        <DataCell label={vessel?.dwcc ? 'DWCC' : 'DWT'}>
          <span style={{ color: '#185FA5', fontVariantNumeric: 'tabular-nums' }}>
            {displayDwt?.toLocaleString() ?? '—'}
          </span>
        </DataCell>
        <DataCell label="OPEN PORT">
          {va.open_port_name ?? va.open_port_locode ?? '—'}
        </DataCell>
        <DataCell label="OPEN DATE">
          <span style={{ color: isOverdue ? '#A32D2D' : 'inherit', fontWeight: isOverdue ? 600 : 400 }}>
            {va.open_date ? formatDate(va.open_date) : <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '9px', fontWeight: 600, padding: '1px 5px', borderRadius: '3px' }}>SPOT</span>}
          </span>
        </DataCell>
      </div>

      {/* FOOTER */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto auto',
        alignItems: 'center', gap: '8px',
        borderTop: '0.5px solid var(--color-border-tertiary)',
        padding: '5px 0 7px', marginTop: '3px'
      }}>
        {/* Col 1 — Consumption + Partner */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <span style={{ fontSize: '9px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {va.vlsfo_sea_mt_day && <><span style={{ color: '#185FA5', fontWeight: 600 }}>VLSFO {va.vlsfo_sea_mt_day}</span> · </>}
            {va.lsmgo_sea_mt_day && <span style={{ color: '#185FA5', fontWeight: 600 }}>LSMGO {va.lsmgo_sea_mt_day}</span>}
            {!va.vlsfo_sea_mt_day && !va.lsmgo_sea_mt_day && <span>—</span>}
          </span>
          <div style={{ minHeight: '13px', display: 'flex', alignItems: 'center' }}>
            {showPartner && va.market_partner_name && (
              <span style={{ fontSize: '9px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                via <span style={{ color: '#185FA5', fontStyle: 'normal', fontWeight: 500 }}>{va.market_partner_name}</span>
              </span>
            )}
            {showLocked && va.for_circulation && (
              <span style={{ fontSize: '9px', color: 'var(--color-text-secondary)' }}>
                via <span style={{ fontFamily: 'monospace', background: 'var(--color-background-secondary)', padding: '1px 4px', borderRadius: '2px' }}>· · · · ·</span>
              </span>
            )}
          </div>
        </div>

        {/* Col 2 — Circ */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', borderLeft: '0.5px solid var(--color-border-tertiary)', paddingLeft: '8px' }}>
          <span style={{ fontSize: '7.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-secondary)' }}>Circ</span>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: va.for_circulation ? '#97C459' : 'var(--color-background-secondary)',
            border: va.for_circulation ? '0.5px solid #3B6D11' : '0.5px solid var(--color-border-tertiary)'
          }} />
        </div>

        {/* Col 3 — Match */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', borderLeft: '0.5px solid var(--color-border-tertiary)', paddingLeft: '8px' }}>
          <span style={{ fontSize: '7.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-secondary)' }}>Match</span>
          <div
            title={`${va.match_count ?? 0} cargo positions proposed by the Arab ShipBroker matching engine`}
            style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: (va.match_count ?? 0) > 0 ? '#E6F1FB' : '#F1EFE8',
              color: (va.match_count ?? 0) > 0 ? '#185FA5' : '#888780',
              border: `0.5px solid ${(va.match_count ?? 0) > 0 ? '#B5D4F4' : '#D3D1C7'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums'
            }}
          >
            {va.match_count ?? 0}
          </div>
        </div>
      </div>
    </div>
  )
}

const DataCell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '8px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</div>
    <div style={{ fontSize: '11px', fontWeight: 500, color: '#1B3A5C', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>
  </div>
)

export default VesselCard
