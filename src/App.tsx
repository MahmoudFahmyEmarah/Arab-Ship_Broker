import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Sidebar from './components/shared/Sidebar'
import BunkerTicker from './components/shared/BunkerTicker'
import Dashboard from './pages/Dashboard'
import { signOut } from './lib/supabase'

const App: React.FC = () => {
  const { user, profile, tier, isAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Inter, sans-serif', color: '#1B3A5C', background: '#F5F7FA'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Arab ShipBroker</div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>Loading...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, -apple-system, sans-serif' }}>
        <Sidebar
          profile={profile}
          tier={tier}
          isAdmin={isAdmin}
          onSignOut={() => signOut().then(() => window.location.reload())}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <BunkerTicker />
          <div style={{ flex: 1, overflow: 'hidden', background: '#F5F7FA' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard tier={tier} />} />
              <Route path="/cargo-market" element={<PlaceholderPage title="Cargo Market" />} />
              <Route path="/tonnage-market" element={<PlaceholderPage title="Tonnage Market" />} />
              <Route path="/voyage-estimator" element={
                (tier === 'T3' || tier === 'T4' || isAdmin)
                  ? <PlaceholderPage title="Voyage Estimator" />
                  : <LockedPage feature="Voyage Estimator" />
              } />
              <Route path="/my-cargo" element={<PlaceholderPage title="My Cargo" />} />
              <Route path="/my-vessels" element={<PlaceholderPage title="My Vessels" />} />
              <Route path="/post-cargo" element={<PlaceholderPage title="Post Cargo" />} />
              <Route path="/post-position" element={<PlaceholderPage title="Post Position" />} />
              <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
              {isAdmin && <Route path="/admin" element={<PlaceholderPage title="Admin Panel" />} />}
            </Routes>
          </div>
        </div>
      </div>
    </BrowserRouter>
  )
}

const LoginPage: React.FC = () => {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const { signIn } = require('./lib/supabase')

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    const { error: e } = await signIn(email, password)
    if (e) { setError(e.message); setLoading(false) }
    else window.location.reload()
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F5F7FA', fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        background: '#fff', border: '0.5px solid #DDE2EA', borderRadius: '8px',
        padding: '40px', width: '360px',
      }}>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C' }}>Arab ShipBroker</div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>Sign in to your account</div>
        </div>
        {error && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: '4px', fontSize: '12px', marginBottom: '16px' }}>{error}</div>}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '11px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '4px' }}>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email"
            style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #DDE2EA', borderRadius: '4px', fontSize: '13px', fontFamily: 'Inter, sans-serif' }} />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '11px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '4px' }}>Password</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password"
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '8px 10px', border: '0.5px solid #DDE2EA', borderRadius: '4px', fontSize: '13px', fontFamily: 'Inter, sans-serif' }} />
        </div>
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%', padding: '10px', background: '#185FA5', color: '#fff',
            border: 'none', borderRadius: '5px', fontSize: '13px', fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', fontFamily: 'Inter, sans-serif'
          }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <div style={{ fontSize: '10px', color: '#9CA3AF', textAlign: 'center', marginTop: '16px', lineHeight: 1.4 }}>
          All data is encrypted end-to-end and handled per the Arab ShipBroker Data Policy.
        </div>
      </div>
    </div>
  )
}

const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ padding: '24px', fontFamily: 'Inter, sans-serif' }}>
    <div style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C', marginBottom: '4px' }}>{title}</div>
    <div style={{ fontSize: '12px', color: '#6B7280' }}>This page is being built. Check back soon.</div>
  </div>
)

const LockedPage: React.FC<{ feature: string }> = ({ feature }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'Inter, sans-serif' }}>
    <div style={{ textAlign: 'center', maxWidth: '340px' }}>
      <div style={{ fontSize: '32px', marginBottom: '16px', opacity: 0.4 }}>🔒</div>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '8px' }}>{feature}</div>
      <div style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, marginBottom: '20px' }}>
        Full voyage P&L · Port disbursements<br />
        Suez Canal toll · Documentation tips<br /><br />
        Available from Subscriber tier (T3+)
      </div>
      <button style={{
        padding: '10px 24px', background: '#185FA5', color: '#fff',
        border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif'
      }}>
        Upgrade to Subscriber →
      </button>
    </div>
  </div>
)

export default App
