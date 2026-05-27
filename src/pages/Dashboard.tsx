import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCargo } from '../hooks/useCargo'
import { useVessels } from '../hooks/useVessels'
import CargoCard from '../components/cargo/CargoCard'
import VesselCard from '../components/vessel/VesselCard'
import type { CargoListing, VesselAvailability, SubscriptionTier } from '../types'

interface Props { tier: SubscriptionTier }

type CargoFilter = 'all' | 'IN' | 'PARTIAL' | 'urgent'
type VesselFilter = 'all' | 'OPEN' | 'overdue'

const Dashboard: React.FC<Props> = ({ tier }) => {
  const navigate = useNavigate()
  const [cargoFilter, setCargoFilter] = useState<CargoFilter>('all')
  const [vesselFilter, setVesselFilter] = useState<VesselFilter>('all')
  const [cargoView, setCargoView] = useState<'card' | 'list'>('card')
  const [vesselView, setVesselView] = useState<'card' | 'list'>('card')
  const [selectedCargo, setSelectedCargo] = useState<CargoListing | null>(null)
  const [selectedVessel, setSelectedVessel] = useState<VesselAvailability | null>(null)

  const { cargo, loading: cl, stats: cs } = useCargo()
  const { vessels, loading: vl, stats: vs } = useVessels()

  const filteredCargo = cargo.filter(c => {
    if (cargoFilter === 'all') return true
    if (cargoFilter === 'urgent') {
      if (c.is_spot) return false
      return c.laycan_to ? (new Date(c.laycan_to).getTime() - Date.now()) / 86400000 <= 3 : false
    }
    return c.status === cargoFilter
  })

  const filteredVessels = vessels.filter(v => {
    if (vesselFilter === 'all') return true
    if (vesselFilter === 'overdue') {
      return v.status === 'OPEN' && v.open_date ? new Date(v.open_date) < new Date() : false
    }
    return v.status === vesselFilter
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0, fontFamily: 'Inter, sans-serif' }}>

      {/* CARGO POSITIONS PANEL */}
      <div style={{
        flex: 1, minHeight: 0,
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        margin: '6px 6px 3px',
      }}>
        {/* Header */}
        <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', color: '#1B3A5C', textTransform: 'uppercase' }}>Cargo Positions</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#185FA5', background: '#E6F1FB', padding: '1px 7px', borderRadius: '10px' }}>
            {cargo.length}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <ToggleBtn active={cargoView === 'list'} onClick={() => setCargoView('list')}>≡</ToggleBtn>
            <ToggleBtn active={cargoView === 'card'} onClick={() => setCargoView('card')}>⊞</ToggleBtn>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
          {[
            { key: 'all', label: 'Active', value: cs.active },
            { key: 'urgent', label: 'Urgent', value: cs.urgent, color: '#A32D2D' },
            { key: 'PARTIAL', label: 'Partial', value: cs.partial, color: '#854F0B' },
          ].map(stat => (
            <div
              key={stat.key}
              onClick={() => setCargoFilter(cargoFilter === stat.key ? 'all' : stat.key as CargoFilter)}
              style={{
                flex: 1, padding: '6px 12px', cursor: 'pointer',
                borderRight: '0.5px solid var(--color-border-tertiary)',
                background: cargoFilter === stat.key ? '#E6F1FB' : 'transparent',
                borderBottom: cargoFilter === stat.key ? '2px solid #185FA5' : '2px solid transparent',
                transition: 'background 0.12s'
              }}
            >
              <div style={{ fontSize: '16px', fontWeight: 600, color: stat.color ?? '#1B3A5C', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: '9px', fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginTop: '1px' }}>{stat.label}</div>
            </div>
          ))}
          <div style={{ flex: 1, padding: '6px 12px', borderRight: 'none' }}>
            {/* reserved — match tab removed */}
          </div>
        </div>

        {/* Cards */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '6px',
          alignContent: 'start',
          scrollbarWidth: 'thin',
        }}>
          {cl ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--color-text-secondary)', padding: '20px', fontSize: '12px' }}>Loading cargo...</div>
          ) : filteredCargo.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--color-text-secondary)', padding: '20px', fontSize: '12px' }}>No cargo positions found</div>
          ) : (
            filteredCargo.map(c => (
              <CargoCard
                key={c.id}
                cargo={c}
                viewerTier={tier}
                selected={selectedCargo?.id === c.id}
                onSelect={(c) => { setSelectedCargo(c); navigate(`/cargo/${c.id}`) }}
              />
            ))
          )}
        </div>
      </div>

      {/* OPEN TONNAGE PANEL */}
      <div style={{
        flex: 1, minHeight: 0,
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        margin: '3px 6px 6px',
      }}>
        <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', color: '#1B3A5C', textTransform: 'uppercase' }}>Open Tonnage</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#185FA5', background: '#E6F1FB', padding: '1px 7px', borderRadius: '10px' }}>{vessels.length}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <ToggleBtn active={vesselView === 'list'} onClick={() => setVesselView('list')}>≡</ToggleBtn>
            <ToggleBtn active={vesselView === 'card'} onClick={() => setVesselView('card')}>⊞</ToggleBtn>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
          {[
            { key: 'all', label: 'Open', value: vs.open },
            { key: 'overdue', label: 'Overdue', value: vs.overdue, color: '#A32D2D' },
            { key: 'OPEN', label: 'On Subs', value: vs.onSubs, color: '#854F0B' },
          ].map(stat => (
            <div
              key={stat.key}
              onClick={() => setVesselFilter(vesselFilter === stat.key ? 'all' : stat.key as VesselFilter)}
              style={{
                flex: 1, padding: '6px 12px', cursor: 'pointer',
                borderRight: '0.5px solid var(--color-border-tertiary)',
                background: vesselFilter === stat.key ? '#E6F1FB' : 'transparent',
                borderBottom: vesselFilter === stat.key ? '2px solid #185FA5' : '2px solid transparent',
              }}
            >
              <div style={{ fontSize: '16px', fontWeight: 600, color: stat.color ?? '#1B3A5C', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: '9px', fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginTop: '1px' }}>{stat.label}</div>
            </div>
          ))}
          <div style={{ flex: 1 }} />
        </div>

        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', alignContent: 'start',
          scrollbarWidth: 'thin',
        }}>
          {vl ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--color-text-secondary)', padding: '20px', fontSize: '12px' }}>Loading vessels...</div>
          ) : filteredVessels.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--color-text-secondary)', padding: '20px', fontSize: '12px' }}>No vessels found</div>
          ) : (
            filteredVessels.map(v => (
              <VesselCard
                key={v.id}
                availability={v}
                viewerTier={tier}
                selected={selectedVessel?.id === v.id}
                onSelect={(v) => { setSelectedVessel(v); navigate(`/vessel/${v.id}`) }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const ToggleBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      width: '26px', height: '26px',
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: '4px',
      background: active ? '#185FA5' : 'var(--color-background-primary)',
      color: active ? '#fff' : 'var(--color-text-secondary)',
      cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
  >{children}</button>
)

export default Dashboard
