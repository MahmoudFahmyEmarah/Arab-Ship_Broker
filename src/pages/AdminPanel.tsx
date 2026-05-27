import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Announcement, SubscriptionTier } from '../types'

type Section = 'announcements' | 'review' | 'users' | 'fuel'

const AdminPanel: React.FC = () => {
  const [section, setSection] = useState<Section>('announcements')

  return (
    <div style={{ height: '100%', display: 'flex', fontFamily: 'Inter, sans-serif' }}>
      <div style={{
        width: '180px', flexShrink: 0,
        background: 'var(--color-background-primary)',
        borderRight: '0.5px solid var(--color-border-tertiary)',
        padding: '16px 0'
      }}>
        <div style={{ padding: '0 16px 8px', fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#EF9F27' }}>
          Admin Panel
        </div>
        {[
          { k: 'announcements', label: 'Announcements' },
          { k: 'review',        label: 'Review Queue' },
          { k: 'users',         label: 'Users & Tiers' },
          { k: 'fuel',          label: 'Fuel Prices' },
        ].map(s => (
          <button
            key={s.k}
            onClick={() => setSection(s.k as Section)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 16px',
              background: section === s.k ? '#FAEEDA' : 'transparent',
              borderLeft: section === s.k ? '2px solid #EF9F27' : '2px solid transparent',
              border: 'none',
              color: section === s.k ? '#854F0B' : '#1B3A5C',
              fontSize: '12px',
              fontWeight: section === s.k ? 600 : 400,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif'
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {section === 'announcements' && <AnnouncementsAdmin />}
        {section === 'review'        && <PlaceholderAdmin title="Review Queue" />}
        {section === 'users'         && <PlaceholderAdmin title="Users & Tiers" />}
        {section === 'fuel'          && <FuelPricesAdmin />}
      </div>
    </div>
  )
}

// ─── Announcements Admin ───────────────────────────────────────
const AnnouncementsAdmin: React.FC = () => {
  const [items, setItems] = useState<Announcement[]>([])
  const [editing, setEditing] = useState<Partial<Announcement> | null>(null)

  const load = async () => {
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false })
    setItems(data ?? [])
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    if (editing.id) {
      await supabase.from('announcements').update(editing).eq('id', editing.id)
    } else {
      await supabase.from('announcements').insert(editing as any)
    }
    setEditing(null)
    load()
  }

  const toggle = async (id: string, active: boolean) => {
    await supabase.from('announcements').update({ active: !active }).eq('id', id)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C' }}>Announcements</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Manage platform-wide notices visible to users.</div>
        </div>
        <button onClick={() => setEditing({
          title: '', category: 'general', active: true,
          target_tiers: ['T1','T2','T3','T4']
        })} style={btnPrimaryStyle}>
          + New announcement
        </button>
      </div>

      {editing && (
        <div style={{ background: '#fff', border: '0.5px solid #185FA5', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '12px', marginBottom: '12px' }}>
            <div>
              <Lbl>Title (max 60 chars)</Lbl>
              <input value={editing.title ?? ''} onChange={e => setEditing({ ...editing, title: e.target.value })} maxLength={60} style={inputStyle} />
            </div>
            <div>
              <Lbl>Category</Lbl>
              <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value as any })} style={inputStyle}>
                <option value="general">General 📢</option>
                <option value="port_da">Port / DA ⚓</option>
                <option value="bunker">Bunker prices 🔥</option>
                <option value="version">Version / Feature ✨</option>
                <option value="security">Security / 2FA 🛡</option>
                <option value="notice">Notice ⚠</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '12px', marginBottom: '12px' }}>
            <div>
              <Lbl>Link URL (optional)</Lbl>
              <input value={editing.link_url ?? ''} onChange={e => setEditing({ ...editing, link_url: e.target.value })} placeholder="https://" style={inputStyle} />
            </div>
            <div>
              <Lbl>Link label</Lbl>
              <input value={editing.link_label ?? ''} onChange={e => setEditing({ ...editing, link_label: e.target.value })} placeholder="View →" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <Lbl>Target tiers</Lbl>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['T1','T2','T3','T4'] as SubscriptionTier[]).map(t => {
                const checked = editing.target_tiers?.includes(t)
                return (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px' }}>
                    <input
                      type="checkbox"
                      checked={checked ?? false}
                      onChange={e => {
                        const cur = editing.target_tiers ?? []
                        setEditing({
                          ...editing,
                          target_tiers: e.target.checked ? [...cur, t] : cur.filter(x => x !== t)
                        })
                      }}
                    />
                    <span>{t}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={save} style={btnPrimaryStyle}>Save</button>
            <button onClick={() => setEditing(null)} style={btnSecondaryStyle}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            No announcements yet.
          </div>
        ) : items.map(a => (
          <div key={a.id} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto',
            gap: '12px', padding: '10px 14px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            alignItems: 'center', opacity: a.active ? 1 : 0.5
          }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 500, color: '#1B3A5C' }}>{a.title}</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                {a.category} · {a.target_tiers.join(', ')}
              </div>
            </div>
            <button onClick={() => toggle(a.id, a.active)} style={{
              padding: '3px 10px', borderRadius: '4px',
              background: a.active ? '#EAF3DE' : '#F1EFE8',
              color: a.active ? '#27500A' : 'var(--color-text-secondary)',
              border: 'none', fontSize: '10px', fontWeight: 600, cursor: 'pointer'
            }}>{a.active ? 'ACTIVE' : 'INACTIVE'}</button>
            <button onClick={() => setEditing(a)} style={btnSecondaryStyle}>Edit</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Fuel Prices Admin ────────────────────────────────────────
const FuelPricesAdmin: React.FC = () => {
  const [prices, setPrices] = useState<any[]>([])
  const load = async () => {
    const { data } = await supabase.from('fuel_prices').select('*').order('updated_at', { ascending: false })
    setPrices(data ?? [])
  }
  useEffect(() => { load() }, [])

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C' }}>Fuel Prices</div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Manage bunker prices shown in the ticker and Voyage Estimator.</div>
      </div>
      <div style={{ background: '#fff', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--color-background-secondary)' }}>
            <tr>
              <th style={thStyle}>Sponsor</th>
              <th style={thStyle}>Area</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>VLSFO</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>LSMGO</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>MGO</th>
              <th style={thStyle}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {prices.map(p => (
              <tr key={p.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <td style={tdStyle}>{p.sponsor_name}</td>
                <td style={tdStyle}>{p.port_area}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>${p.vlsfo_usd_mt}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>${p.lsmgo_usd_mt}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{p.mgo_usd_mt ? `$${p.mgo_usd_mt}` : '—'}</td>
                <td style={{ ...tdStyle, fontSize: '10px', color: 'var(--color-text-secondary)' }}>{new Date(p.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PlaceholderAdmin: React.FC<{ title: string }> = ({ title }) => (
  <div>
    <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '4px' }}>{title}</div>
    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>This admin section is being built.</div>
  </div>
)

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px',
  border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
  fontSize: '11px', fontFamily: 'Inter, sans-serif', color: '#1B3A5C',
  background: 'var(--color-background-primary)'
}

const btnPrimaryStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#185FA5', color: '#fff',
  border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}

const btnSecondaryStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', color: '#1B3A5C',
  border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
  fontSize: '11px', cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}

const Lbl: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{children}</div>
)

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#1B3A5C' }

export default AdminPanel
