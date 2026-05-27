import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCargo } from '../hooks/useCargo'
import { useVessels } from '../hooks/useVessels'
import VesselCard from '../components/vessel/VesselCard'
import LeafletMap from '../components/map/LeafletMap'
import MapRightBar from '../components/map/MapRightBar'
import type { VesselAvailability, SubscriptionTier } from '../types'

interface Props { tier: SubscriptionTier }

const TonnageMarket: React.FC<Props> = ({ tier }) => {
  const navigate = useNavigate()
  const [selectedVessel, setSelectedVessel] = useState<VesselAvailability | null>(null)
  const [showCargo, setShowCargo] = useState(false)
  const [showTonnage, setShowTonnage] = useState(true)
  const [showZones, setShowZones] = useState(false)

  const { cargo } = useCargo()
  const { vessels } = useVessels()
  const mapWrapRef = useRef<HTMLDivElement>(null)

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter, sans-serif' }}>
      <div ref={mapWrapRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <LeafletMap
          cargo={cargo}
          vessels={vessels}
          selectedVessel={selectedVessel}
          tier={tier}
          showCargo={showCargo}
          showTonnage={showTonnage}
          onVesselClick={setSelectedVessel}
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

      <div style={{
        flex: 1, minWidth: 0,
        borderLeft: '0.5px solid var(--color-border-tertiary)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-background-primary)'
      }}>
        <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B3A5C' }}>Tonnage Market</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            {vessels.length} vessels open
          </div>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', padding: '8px',
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', alignContent: 'start',
          scrollbarWidth: 'thin'
        }}>
          {vessels.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
              No vessels loaded. Run the data migration to populate.
            </div>
          ) : (
            vessels.map(v => (
              <VesselCard
                key={v.id}
                availability={v}
                viewerTier={tier}
                selected={selectedVessel?.id === v.id}
                onSelect={(vv) => navigate(`/vessel/${vv.id}`)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default TonnageMarket
