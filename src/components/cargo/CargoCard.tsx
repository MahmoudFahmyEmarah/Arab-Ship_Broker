import React from 'react'
import type { CargoListing, SubscriptionTier } from '../../types'
import {
  getScopeColor,
  getCategoryBadge,
  formatLaycan,
  calcVolume
} from '../../lib/cargo'

interface Props {
  cargo: CargoListing
  viewerTier: SubscriptionTier
  onSelect?: (cargo: CargoListing) => void
  selected?: boolean
}

const CargoCard: React.FC<Props> = ({ cargo, viewerTier, onSelect, selected }) => {
  const scopeColor = getScopeColor(cargo.status)
  const badge = getCategoryBadge(cargo.cargo_type, cargo.is_grain_cargo)
  const laycan = formatLaycan(cargo.laycan_from, cargo.laycan_to, cargo.is_spot)
  const volume = cargo.volume_m3 ?? calcVolume(cargo.qty_max_mt, cargo.stowage_factor)
  const isLaycanUrgent = !cargo.is_spot && cargo.laycan_to
    ? (new Date(cargo.laycan_to).getTime() - Date.now()) / 86400000 <= 3
    : false

  const showPartner = cargo.for_circulation && (viewerTier === 'T3' || viewerTier === 'T4')
  const showLocked = cargo.for_circulation && viewerTier === 'T2'

  return (
    <div
      onClick={() => onSelect?.(cargo)}
      style={{
        background: 'var(--color-background-primary)',
        border: selected ? `1.5px solid #185FA5` : `0.5px solid var(--color-border-tertiary)`,
        borderLeft: `3px solid ${scopeColor}`,
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
      {/* LINE 1 — Name + Category */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
        <span style={{
          fontSize: '12px', fontWeight: 600, color: '#1B3A5C',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1
        }}>
          {cargo.commodity_name}
        </span>
        {cargo.is_wog && (
          <span style={{
            fontSize: '8px', fontWeight: 600, background: '#FAEEDA', color: '#854F0B',
            padding: '2px 5px', borderRadius: '3px', flexShrink: 0
          }}>WOG</span>
        )}
        <span style={{
          fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px',
          background: badge.bg, color: badge.color, flexShrink: 0, letterSpacing: '0.04em'
        }}>{badge.label}</span>
      </div>

      {/* LINE 2 — Route + Zone */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
        <span style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          <span style={{ fontWeight: 600, color: '#1B3A5C' }}>
            {cargo.load_port_locode} → {cargo.disch_port_locode}
          </span>
          <span style={{ color: 'var(--color-text-secondary)', margin: '0 4px' }}>·</span>
          <span style={{ fontSize: '9px', color: 'var(--color-text-secondary)' }}>
            {cargo.load_zone} → {cargo.disch_zone}
          </span>
        </span>
      </div>

      {/* DATA GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px', marginTop: '2px' }}>
        <DataCell label="QTY / VOL">
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {cargo.qty_min_mt === cargo.qty_max_mt
              ? `${cargo.qty_max_mt.toLocaleString()} MT`
              : `${cargo.qty_min_mt.toLocaleString()}–${cargo.qty_max_mt.toLocaleString()} MT`}
          </span>
          {volume && (
            <span style={{ color: '#185FA5', fontSize: '10px', display: 'block' }}>
              {volume.toLocaleString()} m³
            </span>
          )}
        </DataCell>

        <DataCell label="LAYCAN">
          {cargo.is_spot
            ? <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '9px', fontWeight: 600, padding: '1px 5px', borderRadius: '3px' }}>SPOT</span>
            : <span style={{ color: isLaycanUrgent ? '#A32D2D' : 'inherit', fontWeight: isLaycanUrgent ? 600 : 400 }}>{laycan}</span>
          }
        </DataCell>

        <DataCell label="TERMS">
          {cargo.load_terms || '—'}
        </DataCell>

        <DataCell label="SF">
          {cargo.stowage_factor ? `${cargo.stowage_factor} m³/t` : <span style={{ color: 'var(--color-text-secondary)' }}>—</span>}
        </DataCell>

        <DataCell label="L/D RATE">
          {cargo.load_rate && cargo.disch_rate
            ? <span style={{ fontSize: '10px' }}>{cargo.load_rate} / {cargo.disch_rate}</span>
            : <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>Rate TBD</span>}
        </DataCell>

        <DataCell label="IMSBC">
          <span style={{ color: cargo.imsbc_category === 'Cat_A' ? '#854F0B' : 'inherit' }}>
            {cargo.imsbc_category?.replace('Cat_', 'Group ') ?? '—'}
            {cargo.imsbc_category === 'Cat_A' && ' ⚠'}
          </span>
        </DataCell>
      </div>

      {/* FOOTER BAR */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto auto',
        alignItems: 'center', gap: '8px',
        borderTop: '0.5px solid var(--color-border-tertiary)',
        padding: '5px 0 7px', marginTop: '3px'
      }}>
        {/* Col 1 — Freight + Partner */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <span style={{ fontSize: '9px', fontWeight: 500, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cargo.freight_idea_usd_mt ? `$${cargo.freight_idea_usd_mt}/MT` : '—'}
            {cargo.commission_pct ? ` · ${cargo.commission_pct}% comm` : ''}
          </span>
          <div style={{ minHeight: '13px', display: 'flex', alignItems: 'center' }}>
            {showPartner && cargo.market_partner_name && (
              <span style={{ fontSize: '9px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                via <span style={{ color: '#185FA5', fontStyle: 'normal', fontWeight: 500 }}>{cargo.market_partner_name}</span>
              </span>
            )}
            {showLocked && cargo.for_circulation && (
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
            background: cargo.for_circulation ? '#97C459' : 'var(--color-background-secondary)',
            border: cargo.for_circulation ? '0.5px solid #3B6D11' : '0.5px solid var(--color-border-tertiary)'
          }} title={cargo.for_circulation ? 'Circulating in market' : 'Not circulating'} />
        </div>

        {/* Col 3 — Match */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', borderLeft: '0.5px solid var(--color-border-tertiary)', paddingLeft: '8px' }}>
          <span style={{ fontSize: '7.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-secondary)' }}>Match</span>
          <div
            title={`${cargo.match_count ?? 0} vessels proposed by the Arab ShipBroker matching engine`}
            style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: (cargo.match_count ?? 0) > 0 ? '#E6F1FB' : '#F1EFE8',
              color: (cargo.match_count ?? 0) > 0 ? '#185FA5' : '#888780',
              border: `0.5px solid ${(cargo.match_count ?? 0) > 0 ? '#B5D4F4' : '#D3D1C7'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums'
            }}
          >
            {cargo.match_count ?? 0}
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper component
const DataCell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '8px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
      {label}
    </div>
    <div style={{ fontSize: '11px', fontWeight: 500, color: '#1B3A5C', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {children}
    </div>
  </div>
)

export default CargoCard
