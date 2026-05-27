import React from 'react'
import type { SubscriptionTier } from '../../types'

interface Props {
  tier: SubscriptionTier
  showCargo: boolean
  showTonnage: boolean
  showZones: boolean
  onToggleCargo: () => void
  onToggleTonnage: () => void
  onToggleZones: () => void
  onOpenEstimator?: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFullscreen: () => void
}

const MapRightBar: React.FC<Props> = ({
  tier, showCargo, showTonnage, showZones,
  onToggleCargo, onToggleTonnage, onToggleZones,
  onOpenEstimator, onZoomIn, onZoomOut, onFullscreen
}) => {
  const estimatorLocked = tier === 'T1' || tier === 'T2'

  return (
    <div style={{
      position: 'absolute',
      right: '10px',
      top: '10px',
      bottom: '10px',
      width: '40px',
      background: 'rgba(13, 27, 42, 0.85)',
      border: '0.5px solid rgba(255,255,255,0.1)',
      borderRadius: '6px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '6px 0',
      gap: '4px',
      backdropFilter: 'blur(8px)',
      zIndex: 1000,
      fontFamily: 'Inter, sans-serif'
    }}>
      {/* Voy OPEX — accented or locked */}
      <BarButton
        onClick={() => !estimatorLocked && onOpenEstimator?.()}
        title={estimatorLocked ? 'Voy OPEX Estimator · Available from Subscriber tier' : 'Voy OPEX Estimator'}
        accent={!estimatorLocked}
        locked={estimatorLocked}
      >⟳</BarButton>

      <Divider />

      <BarButton onClick={onToggleCargo} active={showCargo} title="Toggle cargo markers">◎</BarButton>
      <BarButton onClick={onToggleTonnage} active={showTonnage} title="Toggle tonnage markers">▲</BarButton>
      <BarButton onClick={onToggleZones} active={showZones} title="Toggle zone overlays">⬡</BarButton>

      <Divider />

      <BarButton title="Filter" onClick={() => {}}>≡</BarButton>
      <BarButton title="Layers" onClick={() => {}}>⊞</BarButton>
      <BarButton title="Search" onClick={() => {}}>⌕</BarButton>

      <div style={{ flex: 1 }} />

      <Divider />

      <BarButton onClick={onZoomIn} title="Zoom in">+</BarButton>
      <BarButton onClick={onZoomOut} title="Zoom out">−</BarButton>
      <BarButton onClick={onFullscreen} title="Fullscreen">⛶</BarButton>
    </div>
  )
}

interface BtnProps {
  onClick?: () => void
  active?: boolean
  accent?: boolean
  locked?: boolean
  title?: string
  children: React.ReactNode
}

const BarButton: React.FC<BtnProps> = ({ onClick, active, accent, locked, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    disabled={locked}
    style={{
      width: '28px', height: '28px',
      border: locked ? '0.5px solid rgba(255,255,255,0.08)' : `0.5px solid ${accent ? '#7BB8F0' : active ? '#7BB8F0' : 'rgba(255,255,255,0.15)'}`,
      borderRadius: '4px',
      background: accent && !locked
        ? 'rgba(24,95,165,0.6)'
        : active
        ? 'rgba(255,255,255,0.15)'
        : 'transparent',
      color: locked ? 'rgba(255,255,255,0.25)' : accent ? '#fff' : active ? '#fff' : 'rgba(255,255,255,0.6)',
      cursor: locked ? 'not-allowed' : 'pointer',
      fontSize: '14px',
      fontWeight: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: locked ? 0.25 : 1,
      transition: 'all 0.15s',
      padding: 0,
    }}
    onMouseEnter={(e) => {
      if (!locked && !active && !accent) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'
    }}
    onMouseLeave={(e) => {
      if (!locked && !active && !accent) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
    }}
  >
    {children}
  </button>
)

const Divider: React.FC = () => (
  <div style={{ width: '20px', height: '0.5px', background: 'rgba(255,255,255,0.15)', margin: '2px 0' }} />
)

export default MapRightBar
