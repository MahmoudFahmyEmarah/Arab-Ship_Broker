import React, { useState, useRef } from 'react'
import { useCargo } from '../hooks/useCargo'
import { useVessels } from '../hooks/useVessels'
import CargoCard from '../components/cargo/CargoCard'
import LeafletMap from '../components/map/LeafletMap'
import MapRightBar from '../components/map/MapRightBar'
import type { CargoListing, VesselAvailability, SubscriptionTier } from '../types'

interface Props { tier: SubscriptionTier }

const CargoMarket: React.FC<Props> = ({ tier }) => {
  const [selectedCargo, setSelectedCargo] = useState<CargoListing | null>(null)
  const [showCargo, setShowCargo] = useState(true)
  const [showTonnage, setShowTonnage] = useState(true)
  const [showZones, setShowZones] = useState(false)

  const { cargo } = useCargo()
  const { vessels } = useVessels()

  const mapWrapRef = useRef<HTMLDivElement>(null)

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0, fontFamily: 'Inter, sans-serif' }}>

      {/* MAP — 50% */}
      <div ref={mapWrapRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <LeafletMap
          cargo={cargo}
          vessels={vessels}
          selectedCargo={selectedCargo}
          tier={tier}
          showCargo={showCargo}
          showTonnage={showTonnage}
          onCargoClick={setSelectedCargo}
        />
        <MapRightBar
          tier={tier}
          showCargo={showCargo}
          showTonnage={showTonnage}
          showZones={showZones}
          onToggleCargo={() => setShowCargo(!showCargo)}
          onToggleTonnage={() => setShowTonnage(!showTonnage)}
          onToggleZones={() => setShowZones(!showZones)}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          onFullscreen={() => mapWrapRef.current?.requestFullscreen?.()}
        />
      </div>

      {/* CARDS — 50% */}
      <div style={{
        flex: 1, minWidth: 0,
        borderLeft: '0.5px solid var(--color-border-tertiary)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-background-primary)'
      }}>
        <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B3A5C' }}>Cargo Market</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            {cargo.length} positions
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
          alignContent: 'start',
          scrollbarWidth: 'thin'
        }}>
          {cargo.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
              No cargo positions loaded. Run the data migration to populate.
            </div>
          ) : (
            cargo.map(c => (
              <CargoCard
                key={c.id}
                cargo={c}
                viewerTier={tier}
                selected={selectedCargo?.id === c.id}
                onSelect={setSelectedCargo}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default CargoMarket
