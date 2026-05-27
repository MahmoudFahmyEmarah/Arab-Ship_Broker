import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface QueueItem {
  id: string
  listing_type: 'cargo' | 'vessel_availability'
  listing_id: string
  submitter_name?: string
  submitter_company?: string
  trust_tier: string
  review_reason: string
  is_random_sample: boolean
  submitted_at: string
  status: string
  listing?: any
}

const ReviewQueue: React.FC = () => {
  const navigate = useNavigate()
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'cargo' | 'vessel_availability'>('all')
  const [actioning, setActioning] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('v_admin_queue')
      .select('*')
      .order('submitted_at', { ascending: true })

    if (data) {
      const hydrated = await Promise.all(data.map(async (r: any) => {
        const table = r.listing_type === 'cargo' ? 'cargo_listings' : 'vessel_availability'
        const select = r.listing_type === 'cargo' ? '*' : '*, vessel:vessels(*)'
        const { data: listing } = await supabase.from(table).select(select).eq('id', r.listing_id).single()
        return { ...r, listing }
      }))
      setItems(hydrated as QueueItem[])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = items.filter(i => filter === 'all' || i.listing_type === filter)

  const action = async (item: QueueItem, status: 'APPROVED' | 'REJECTED', taken: 'approved' | 'rejected', note?: string) => {
    setActioning(item.id)
    await supabase.from('review_queue').update({
      status, action_taken: taken, admin_note: note
    }).eq('id', item.id)
    setActioning(null)
    load()
  }

  return (
    <div>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1B3A5C', marginBottom: '4px' }}>Review Queue</div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
        Pending submissions from NEW and FLAGGED users plus random samples of VERIFIED posts.
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[
          { k: 'all', label: 'All' },
          { k: 'cargo', label: 'Cargo' },
          { k: 'vessel_availability', label: 'Vessels' }
        ].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k as any)} style={{
            padding: '5px 12px', borderRadius: '12px',
            border: `0.5px solid ${filter === t.k ? '#185FA5' : 'var(--color-border-tertiary)'}`,
            background: filter === t.k ? '#E6F1FB' : 'transparent',
            color: filter === t.k ? '#185FA5' : '#1B3A5C',
            fontSize: '11px', fontWeight: filter === t.k ? 600 : 400,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif'
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-secondary)' }}>Loading queue...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-secondary)', background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '6px' }}>
          Queue is clear. No pending submissions.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(item => (
            <div key={item.id} style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: `3px solid ${item.is_random_sample ? '#185FA5' : '#EF9F27'}`,
              borderRadius: '6px',
              padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '3px',
                      background: item.listing_type === 'cargo' ? '#E6F1FB' : '#EAF3DE',
                      color: item.listing_type === 'cargo' ? '#0C447C' : '#27500A',
                    }}>{item.listing_type === 'cargo' ? 'CARGO' : 'VESSEL'}</span>
                    {item.is_random_sample && (
                      <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px', background: '#E6F1FB', color: '#185FA5' }}>
                        RANDOM SAMPLE
                      </span>
                    )}
                    <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                      {new Date(item.submitted_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1B3A5C' }}>
                    {item.listing_type === 'cargo'
                      ? `${item.listing?.commodity_name ?? '?'} · ${item.listing?.qty_max_mt?.toLocaleString() ?? '?'} MT · ${item.listing?.load_port_locode} → ${item.listing?.disch_port_locode}`
                      : `${item.listing?.vessel?.vessel_name ?? 'TBN'} · ${(item.listing?.vessel?.dwcc ?? item.listing?.vessel?.dwt_grain)?.toLocaleString() ?? '?'} MT · Open ${item.listing?.open_port_locode}`}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                    Submitted by <span style={{ color: '#1B3A5C', fontWeight: 500 }}>{item.submitter_name ?? '?'}</span>
                    {item.submitter_company && <> · {item.submitter_company}</>}
                    {' · '}<span style={{ color: item.trust_tier === 'NEW' ? '#854F0B' : item.trust_tier === 'FLAGGED' ? '#A32D2D' : '#27500A' }}>
                      Trust: {item.trust_tier}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px', fontStyle: 'italic' }}>
                    Reason: {item.review_reason}
                  </div>
                </div>
                <button
                  onClick={() => navigate(item.listing_type === 'cargo' ? `/cargo/${item.listing_id}` : `/vessel/${item.listing_id}`)}
                  style={{
                    padding: '5px 10px', background: 'transparent',
                    border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
                    fontSize: '10px', color: '#1B3A5C', cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif'
                  }}
                >Open →</button>
              </div>

              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <button
                  onClick={() => action(item, 'APPROVED', 'approved')}
                  disabled={actioning === item.id}
                  style={{
                    padding: '5px 12px', background: '#97C459', color: '#fff',
                    border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                  }}
                >✓ Approve</button>
                <button
                  onClick={() => action(item, 'REJECTED', 'rejected', prompt('Reason for rejection?') ?? undefined)}
                  disabled={actioning === item.id}
                  style={{
                    padding: '5px 12px', background: '#E24B4A', color: '#fff',
                    border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                  }}
                >✗ Reject</button>
                <button
                  onClick={() => action(item, 'APPROVED', 'approved', 'Amended by admin')}
                  disabled={actioning === item.id}
                  style={{
                    padding: '5px 12px', background: 'transparent', color: '#854F0B',
                    border: '0.5px solid #EF9F27', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                  }}
                >Amend & Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReviewQueue
