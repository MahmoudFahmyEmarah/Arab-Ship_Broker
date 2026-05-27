import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { AppUser, SubscriptionTier, TrustTier } from '../../types'

const TIER_COLORS: Record<SubscriptionTier, string> = {
  T1: 'var(--color-text-secondary)', T2: '#854F0B', T3: '#185FA5', T4: '#27500A'
}
const TRUST_COLORS: Record<TrustTier, string> = {
  NEW: '#854F0B', VERIFIED: '#27500A', FLAGGED: '#A32D2D'
}

const UsersManager: React.FC = () => {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false })
    setUsers((data ?? []) as AppUser[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const updateTier = async (id: string, tier: SubscriptionTier) => {
    await supabase.from('users').update({ subscription_tier: tier }).eq('id', id)
    load()
  }
  const updateTrust = async (id: string, trust: TrustTier) => {
    await supabase.from('users').update({ trust_tier: trust }).eq('id', id)
    load()
  }
  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from('users').update({ is_active: !active }).eq('id', id)
    load()
  }

  const filtered = users.filter(u =>
    !search ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.company?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C' }}>Users & Tiers</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            Manage subscription tier (T1-T4 commercial access) and trust tier (NEW / VERIFIED / FLAGGED moderation).
          </div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, company..."
          style={{
            padding: '7px 12px', width: '260px',
            border: '0.5px solid var(--color-border-tertiary)', borderRadius: '5px',
            fontSize: '12px', fontFamily: 'Inter, sans-serif', color: '#1B3A5C'
          }}
        />
      </div>

      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '6px', overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', fontFamily: 'Inter, sans-serif' }}>
          <thead style={{ background: 'var(--color-background-secondary)' }}>
            <tr>
              <th style={th}>User</th>
              <th style={th}>Role / Company</th>
              <th style={{ ...th, textAlign: 'center' }}>Tier</th>
              <th style={{ ...th, textAlign: 'center' }}>Trust</th>
              <th style={{ ...th, textAlign: 'center' }}>Posts / Strikes</th>
              <th style={{ ...th, textAlign: 'center' }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading users...</td></tr>
            ) : filtered.map(u => (
              <tr key={u.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <td style={td}>
                  <div style={{ fontWeight: 500, color: '#1B3A5C' }}>{u.full_name ?? '—'}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{u.email}</div>
                </td>
                <td style={td}>
                  <div>{u.role ?? '—'}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{u.company ?? '—'}</div>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <select
                    value={u.subscription_tier}
                    onChange={e => updateTier(u.id, e.target.value as SubscriptionTier)}
                    style={{
                      padding: '2px 6px', borderRadius: '3px',
                      border: '0.5px solid var(--color-border-tertiary)',
                      fontSize: '11px', fontWeight: 600,
                      color: TIER_COLORS[u.subscription_tier],
                      fontFamily: 'Inter, sans-serif', cursor: 'pointer'
                    }}
                  >
                    {(['T1','T2','T3','T4'] as SubscriptionTier[]).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <select
                    value={u.trust_tier}
                    onChange={e => updateTrust(u.id, e.target.value as TrustTier)}
                    style={{
                      padding: '2px 6px', borderRadius: '3px',
                      border: '0.5px solid var(--color-border-tertiary)',
                      fontSize: '10px', fontWeight: 600,
                      color: TRUST_COLORS[u.trust_tier],
                      fontFamily: 'Inter, sans-serif', cursor: 'pointer'
                    }}
                  >
                    <option value="NEW">NEW</option>
                    <option value="VERIFIED">VERIFIED</option>
                    <option value="FLAGGED">FLAGGED</option>
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <span style={{ color: '#27500A', fontWeight: 500 }}>{u.clean_posts}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}> / </span>
                  <span style={{ color: u.strike_count > 0 ? '#A32D2D' : 'var(--color-text-secondary)', fontWeight: u.strike_count > 0 ? 600 : 400 }}>{u.strike_count}</span>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button onClick={() => toggleActive(u.id, u.is_active)} style={{
                    padding: '2px 8px', borderRadius: '3px',
                    background: u.is_active ? '#EAF3DE' : '#FCEBEB',
                    color: u.is_active ? '#27500A' : '#A32D2D',
                    border: 'none', fontSize: '9px', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif'
                  }}>
                    {u.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        <strong>Subscription tier</strong> (T1-T4): commercial access level. Drives Voyage Estimator gating and partner name visibility.<br />
        <strong>Trust tier</strong>: moderation tier. NEW = posts auto-routed to review queue. VERIFIED = posts go live immediately (10% random sampling). FLAGGED = posts always gated.
      </div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }
const td: React.CSSProperties = { padding: '8px 12px', color: '#1B3A5C' }

export default UsersManager
