import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppUser, SubscriptionTier } from '../types'

interface Props { profile: AppUser | null; tier: SubscriptionTier }

type Section = 'profile' | 'security' | 'subscription' | 'preferences'

const TIER_LABELS: Record<SubscriptionTier, { name: string; desc: string; color: string }> = {
  T1: { name: 'Free',       desc: 'Vetted access · Zone-level match counts', color: 'var(--color-text-secondary)' },
  T2: { name: 'Promoted',   desc: 'Full match intelligence · Partner names locked', color: '#854F0B' },
  T3: { name: 'Subscriber', desc: 'Full access · Voyage Estimator · Live partner names', color: '#185FA5' },
  T4: { name: 'Partner',    desc: 'ASB-promoted key account · All features', color: '#27500A' },
}

const Settings: React.FC<Props> = ({ profile, tier }) => {
  const [section, setSection] = useState<Section>('profile')

  return (
    <div style={{ height: '100%', display: 'flex', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-secondary)' }}>
      <div style={{
        width: '180px', flexShrink: 0,
        background: 'var(--color-background-primary)',
        borderRight: '0.5px solid var(--color-border-tertiary)',
        padding: '16px 0',
      }}>
        <div style={{ padding: '0 16px 12px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#1B3A5C' }}>
          Settings
        </div>
        {[
          { k: 'profile',      label: 'Profile' },
          { k: 'security',     label: 'Security' },
          { k: 'subscription', label: 'Subscription' },
          { k: 'preferences',  label: 'Preferences' },
        ].map(s => (
          <button
            key={s.k}
            onClick={() => setSection(s.k as Section)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 16px',
              background: section === s.k ? '#E6F1FB' : 'transparent',
              borderLeft: section === s.k ? '2px solid #185FA5' : '2px solid transparent',
              border: 'none', color: section === s.k ? '#185FA5' : '#1B3A5C',
              fontSize: '12px', fontWeight: section === s.k ? 600 : 400,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif'
            }}
          >{s.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {section === 'profile' && <ProfileSection profile={profile} />}
        {section === 'security' && <SecuritySection />}
        {section === 'subscription' && <SubscriptionSection tier={tier} />}
        {section === 'preferences' && <PreferencesSection />}
      </div>
    </div>
  )
}

// ─── PROFILE ──────────────────────────────────────────────────
const ProfileSection: React.FC<{ profile: AppUser | null }> = ({ profile }) => {
  const [data, setData] = useState<Partial<AppUser>>({
    full_name: profile?.full_name ?? '',
    company:   profile?.company ?? '',
    role:      profile?.role ?? '',
    phone:     profile?.phone ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    setSaving(true)
    setMsg('')
    const { error } = await supabase.from('users').update(data).eq('id', profile?.id ?? '')
    setMsg(error ? `Error: ${error.message}` : 'Saved')
    setSaving(false)
  }

  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '16px' }}>Profile</div>

      <Card>
        <Field label="Full name">
          <input value={data.full_name ?? ''} onChange={e => setData(d => ({ ...d, full_name: e.target.value }))} style={inputStyle} />
        </Field>
        <Field label="Email">
          <input value={profile?.email ?? ''} disabled style={{ ...inputStyle, background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)' }} />
          <div style={{ fontSize: '9px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Email cannot be changed. Contact Arab ShipBroker to update.</div>
        </Field>
        <Field label="Company">
          <input value={data.company ?? ''} onChange={e => setData(d => ({ ...d, company: e.target.value }))} style={inputStyle} />
        </Field>
        <Field label="Role">
          <select value={data.role ?? ''} onChange={e => setData(d => ({ ...d, role: e.target.value }))} style={inputStyle}>
            <option value="">— Select —</option>
            <option value="Broker">Broker</option>
            <option value="Owner">Owner</option>
            <option value="Operator">Operator</option>
            <option value="Shipper">Shipper / Trader</option>
            <option value="Charterer">Charterer</option>
          </select>
        </Field>
        <Field label="Phone (encrypted at rest)">
          <input value={data.phone ?? ''} onChange={e => setData(d => ({ ...d, phone: e.target.value }))} placeholder="+xxx xxx xxxx" style={inputStyle} />
          <div style={{ fontSize: '9px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Visible only to Arab ShipBroker. Never shared with other users.
          </div>
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving...' : 'Save changes'}</button>
          {msg && <span style={{ fontSize: '11px', color: msg.startsWith('Error') ? '#A32D2D' : '#27500A' }}>{msg}</span>}
        </div>
      </Card>
    </div>
  )
}

// ─── SECURITY ─────────────────────────────────────────────────
const SecuritySection: React.FC = () => {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const changePw = async () => {
    if (newPw !== confirmPw) { setMsg('New passwords do not match'); return }
    if (newPw.length < 8) { setMsg('Password must be at least 8 characters'); return }
    setSaving(true); setMsg('')
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setMsg(error ? `Error: ${error.message}` : 'Password updated')
    if (!error) { setCurrentPw(''); setNewPw(''); setConfirmPw('') }
    setSaving(false)
  }

  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '6px' }}>Security</div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
        Keep your account secure. All data is encrypted end-to-end.
      </div>

      <Card>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#1B3A5C', marginBottom: '12px' }}>Change Password</div>
        <Field label="Current password">
          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="New password">
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
          <button onClick={changePw} disabled={saving || !newPw || !confirmPw} style={primaryBtn}>
            {saving ? 'Updating...' : 'Update password'}
          </button>
          {msg && <span style={{ fontSize: '11px', color: msg.startsWith('Error') || msg.includes('not match') ? '#A32D2D' : '#27500A' }}>{msg}</span>}
        </div>
      </Card>

      <Card style={{ marginTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1B3A5C' }}>Two-factor authentication</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Coming soon — adds a second verification step on login.</div>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', padding: '3px 8px', background: 'var(--color-background-secondary)', borderRadius: '4px' }}>
            Not enabled
          </span>
        </div>
      </Card>
    </div>
  )
}

// ─── SUBSCRIPTION ─────────────────────────────────────────────
const SubscriptionSection: React.FC<{ tier: SubscriptionTier }> = ({ tier }) => {
  const current = TIER_LABELS[tier]
  return (
    <div style={{ maxWidth: '720px' }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '6px' }}>Subscription</div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
        Your current access tier and what's available at each level.
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Current tier</div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: current.color, marginTop: '4px' }}>{tier} · {current.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{current.desc}</div>
          </div>
          {(tier === 'T1' || tier === 'T2') && (
            <button style={primaryBtn}>Upgrade to Subscriber →</button>
          )}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '16px' }}>
        {(['T1','T2','T3','T4'] as SubscriptionTier[]).map(t => {
          const cfg = TIER_LABELS[t]
          const isCurrent = t === tier
          return (
            <div key={t} style={{
              padding: '12px',
              background: isCurrent ? '#E6F1FB' : 'var(--color-background-primary)',
              border: isCurrent ? '1px solid #185FA5' : '0.5px solid var(--color-border-tertiary)',
              borderRadius: '6px',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: cfg.color }}>{t} · {cfg.name}</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px', lineHeight: 1.5 }}>{cfg.desc}</div>
              {isCurrent && <div style={{ fontSize: '9px', color: '#185FA5', fontWeight: 600, marginTop: '6px' }}>● CURRENT</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PREFERENCES ──────────────────────────────────────────────
const PreferencesSection: React.FC = () => {
  const [prefs, setPrefs] = useState({
    showWogBanner: true,
    autoSpotDetection: true,
    showCommissionOnCards: true,
    defaultLandingPage: 'dashboard',
  })
  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '16px' }}>Preferences</div>
      <Card>
        <Toggle
          label="Show WOG warning banner on cards"
          desc="Recommended ON — flags cargo offered without guarantee"
          value={prefs.showWogBanner}
          onChange={v => setPrefs(p => ({ ...p, showWogBanner: v }))}
        />
        <Toggle
          label="Auto-detect SPOT in pasted circulars"
          desc="AI parser treats missing laycan as SPOT"
          value={prefs.autoSpotDetection}
          onChange={v => setPrefs(p => ({ ...p, autoSpotDetection: v }))}
        />
        <Toggle
          label="Show commission rates on cargo cards"
          desc="Display 2.5% / 3.75% in card footer"
          value={prefs.showCommissionOnCards}
          onChange={v => setPrefs(p => ({ ...p, showCommissionOnCards: v }))}
        />
      </Card>
    </div>
  )
}

const Toggle: React.FC<{ label: string; desc: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, desc, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
    <div>
      <div style={{ fontSize: '12px', fontWeight: 500, color: '#1B3A5C' }}>{label}</div>
      <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{desc}</div>
    </div>
    <button onClick={() => onChange(!value)} style={{
      width: '32px', height: '18px', borderRadius: '10px',
      background: value ? '#185FA5' : 'var(--color-border-tertiary)',
      border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.15s'
    }}>
      <span style={{
        position: 'absolute', top: '2px', left: value ? '16px' : '2px',
        width: '14px', height: '14px', borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s'
      }} />
    </button>
  </div>
)

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '6px', padding: '16px', ...style }}>
    {children}
  </div>
)

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{label}</div>
    {children}
  </div>
)

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
  fontSize: '12px', fontFamily: 'Inter, sans-serif', color: '#1B3A5C',
  background: 'var(--color-background-primary)'
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 14px', background: '#185FA5', color: '#fff',
  border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}

export default Settings
