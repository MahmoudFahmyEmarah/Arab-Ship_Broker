import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import CargoCard from '../components/cargo/CargoCard'
import type { CargoListing, SubscriptionTier } from '../types'

interface Props { tier: SubscriptionTier }

type FilterTab = 'all' | 'live' | 'review' | 'fixed'

const MyCargo: React.FC<Props> = ({ tier }) => {
  const navigate = useNavigate()
  const [cargo, setCargo] = useState<CargoListing[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')

  const load = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Fetch cargo owned by current user via listing_ownership
    const { data } = await supabase
      .from('cargo_listings')
      .select('*, listing_ownership!inner(owner_user_id)')
      .eq('listing_ownership.owner_user_id', user.id)
      .order('created_at', { ascending: false })

    setCargo((data ?? []) as CargoListing[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = cargo.filter(c => {
    if (filter === 'all') return true
    if (filter === 'live')   return c.review_status === 'APPROVED' && (c.status === 'IN' || c.status === 'PARTIAL')
    if (filter === 'review') return c.review_status === 'PENDING'
    if (filter === 'fixed')  return c.status === 'CLOSED'
    return true
  })

  const counts = {
    all: cargo.length,
    live: cargo.filter(c => c.review_status === 'APPROVED' && (c.status === 'IN' || c.status === 'PARTIAL')).length,
    review: cargo.filter(c => c.review_status === 'PENDING').length,
    fixed: cargo.filter(c => c.status === 'CLOSED').length,
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-secondary)' }}>
      <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C' }}>My Cargo</div>
          <div style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
            Positions you've posted · most recent first
          </div>
        </div>
        <button onClick={() => navigate('/post-cargo')} style={{
          padding: '8px 16px', background: '#185FA5', color: '#fff',
          border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
          cursor: 'pointer', fontFamily: 'Inter, sans-serif'
        }}>+ Post Cargo</button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-primary)' }}>
        {[
          { k: 'all',    label: 'All' },
          { k: 'live',   label: 'Live', color: '#27500A' },
          { k: 'review', label: 'Under Review', color: '#854F0B' },
          { k: 'fixed',  label: 'Fixed', color: 'var(--color-text-secondary)' },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setFilter(t.k as FilterTab)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none',
              borderBottom: filter === t.k ? '2px solid #185FA5' : '2px solid transparent',
              color: filter === t.k ? '#185FA5' : 'var(--color-text-secondary)',
              fontSize: '12px', fontWeight: filter === t.k ? 600 : 500,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <span>{t.label}</span>
            <span style={{ fontSize: '10px', background: 'var(--color-background-secondary)', padding: '1px 6px', borderRadius: '8px', fontWeight: 500 }}>
              {counts[t.k as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      {/* Cards */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px', alignContent: 'start'
      }}>
        {loading ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            Loading your cargo...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
            {filter === 'all' ? 'You haven\'t posted any cargo yet.' : `No cargo with ${filter} status.`}
            <div style={{ marginTop: '12px' }}>
              <button onClick={() => navigate('/post-cargo')} style={{
                padding: '8px 16px', background: '#185FA5', color: '#fff',
                border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif'
              }}>Post your first cargo →</button>
            </div>
          </div>
        ) : (
          filtered.map(c => (
            <CargoCard
              key={c.id}
              cargo={c}
              viewerTier={tier}
              onSelect={(cc) => navigate(`/cargo/${cc.id}`)}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default MyCargo
