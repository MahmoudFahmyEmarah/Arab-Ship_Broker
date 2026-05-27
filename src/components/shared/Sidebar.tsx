import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { AppUser, SubscriptionTier } from '../../types'

interface Props {
  profile: AppUser | null
  tier: SubscriptionTier
  isAdmin: boolean
  onSignOut: () => void
}

const NAV_ITEMS = [
  { section: 'OVERVIEW', items: [
    { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
  ]},
  { section: 'WORKSPACE', items: [
    { path: '/my-cargo', label: 'My Cargo', icon: '□' },
    { path: '/post-cargo', label: 'Post Cargo', icon: '+' },
    { path: '/my-vessels', label: 'My Vessels', icon: '▲' },
    { path: '/post-position', label: 'Post Position', icon: '+' },
  ]},
  { section: 'DISCOVER', items: [
    { path: '/cargo-market', label: 'Cargo Market', icon: '◎' },
    { path: '/tonnage-market', label: 'Tonnage Market', icon: '△' },
  ]},
  { section: 'VOYAGE TOOLS', items: [
    { path: '/voyage-estimator', label: 'Voyage Estimator', icon: '⟳', requiresTier: 'T3' as SubscriptionTier },
  ]},
]

const TIER_LABELS: Record<SubscriptionTier, string> = {
  T1: 'Free', T2: 'Promoted', T3: 'Subscriber', T4: 'Partner'
}

const Sidebar: React.FC<Props> = ({ profile, tier, isAdmin, onSignOut }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  const canAccess = (requiresTier?: SubscriptionTier) => {
    if (!requiresTier) return true
    const tierNum = { T1: 1, T2: 2, T3: 3, T4: 4 }
    return tierNum[tier] >= tierNum[requiresTier]
  }

  return (
    <nav style={{
      width: collapsed ? '52px' : '168px',
      flexShrink: 0,
      background: '#1B3A5C',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      transition: 'width 0.2s ease',
      overflow: 'hidden',
      fontFamily: 'Inter, -apple-system, sans-serif',
    }}>
      {/* Brand */}
      <div style={{
        padding: '12px',
        borderBottom: '0.5px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Arab ShipBroker</div>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Portal</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '14px', padding: '4px' }}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Nav sections */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {NAV_ITEMS.map(section => (
          <div key={section.section} style={{ marginBottom: '16px' }}>
            {!collapsed && (
              <div style={{
                fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.35)', padding: '0 12px 4px',
                textTransform: 'uppercase'
              }}>
                {section.section}
              </div>
            )}
            {section.items.map(item => {
              const active = location.pathname === item.path
              const accessible = canAccess(item.requiresTier)
              return (
                <button
                  key={item.path}
                  onClick={() => accessible && navigate(item.path)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: collapsed ? '8px 0' : '7px 12px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background: active ? 'rgba(255,255,255,0.12)' : 'none',
                    border: 'none',
                    borderLeft: active ? '2px solid #97C459' : '2px solid transparent',
                    color: accessible ? (active ? '#fff' : 'rgba(255,255,255,0.65)') : 'rgba(255,255,255,0.2)',
                    cursor: accessible ? 'pointer' : 'not-allowed',
                    fontSize: '12px',
                    fontWeight: active ? 500 : 400,
                    fontFamily: 'Inter, -apple-system, sans-serif',
                    textAlign: 'left',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (accessible && !active) (e.currentTarget).style.background = 'rgba(255,255,255,0.06)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget).style.background = 'none' }}
                >
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
                  {!collapsed && !accessible && <span style={{ marginLeft: 'auto', fontSize: '10px' }}>🔒</span>}
                </button>
              )
            })}
          </div>
        ))}

        {/* Admin zone */}
        {isAdmin && (
          <div style={{ marginTop: '8px', borderTop: '0.5px solid rgba(239,159,39,0.3)', paddingTop: '8px' }}>
            {!collapsed && (
              <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em', color: '#EF9F27', padding: '0 12px 4px', textTransform: 'uppercase' }}>
                Admin Zone
              </div>
            )}
            {[
              { path: '/admin', label: 'Admin Panel', icon: '⚙' },
            ].map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: collapsed ? '8px 0' : '7px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: location.pathname.startsWith('/admin') ? 'rgba(239,159,39,0.15)' : 'none',
                  border: 'none', borderLeft: location.pathname.startsWith('/admin') ? '2px solid #EF9F27' : '2px solid transparent',
                  color: '#EF9F27', cursor: 'pointer', fontSize: '12px',
                  fontFamily: 'Inter, -apple-system, sans-serif', textAlign: 'left'
                }}
              >
                <span style={{ fontSize: '14px' }}>{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Account footer */}
      <div style={{
        borderTop: '0.5px solid rgba(255,255,255,0.1)',
        padding: '10px 12px',
        flexShrink: 0,
      }}>
        {!collapsed && profile && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile.full_name ?? profile.email ?? 'User'}
            </div>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>
              {profile.role ?? 'Broker'} · {TIER_LABELS[tier]}
            </div>
          </div>
        )}
        <button
          onClick={() => navigate('/settings')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer', fontSize: '11px', padding: '4px 0', marginBottom: '4px',
            fontFamily: 'Inter, sans-serif', justifyContent: collapsed ? 'center' : 'flex-start'
          }}
        >
          <span>⚙</span>{!collapsed && 'Settings'}
        </button>
        <button
          onClick={onSignOut}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer', fontSize: '11px', padding: '4px 0',
            fontFamily: 'Inter, sans-serif', justifyContent: collapsed ? 'center' : 'flex-start'
          }}
        >
          <span>↩</span>{!collapsed && 'Sign out'}
        </button>
        {!collapsed && (
          <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)', marginTop: '6px', lineHeight: 1.4 }}>
            Encrypted end-to-end. Visible only to Arab ShipBroker until your listing is matched.
          </div>
        )}
      </div>
    </nav>
  )
}

export default Sidebar
