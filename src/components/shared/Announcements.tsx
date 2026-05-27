import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { Announcement, SubscriptionTier } from '../../types'

interface Props { tier: SubscriptionTier }

const CATEGORY_CONFIG: Record<string, { icon: string; accent: string }> = {
  general:  { icon: '📢', accent: 'var(--color-border-tertiary)' },
  port_da:  { icon: '⚓', accent: '#185FA5' },
  bunker:   { icon: '🔥', accent: '#EF9F27' },
  version:  { icon: '✨', accent: '#97C459' },
  security: { icon: '🛡',  accent: '#E24B4A' },
  notice:   { icon: '⚠',  accent: '#EF9F27' },
}

const Announcements: React.FC<Props> = ({ tier }) => {
  const [items, setItems] = useState<Announcement[]>([])
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    supabase
      .from('announcements')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const filtered = (data ?? []).filter(a =>
          a.target_tiers.includes(tier) || a.target_tiers.length === 0
        )
        setItems(filtered)
      })
  }, [tier])

  useEffect(() => {
    if (items.length <= 1) return
    const t = setInterval(() => {
      setActiveIdx(i => (i + 1) % items.length)
    }, 6000)
    return () => clearInterval(t)
  }, [items.length])

  if (items.length === 0) return null
  const item = items[activeIdx]
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.general

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '360px' }}>
      <div
        onClick={() => item.link_url && window.open(item.link_url, '_blank')}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '4px 12px', background: 'var(--color-background-secondary)',
          border: `0.5px solid var(--color-border-tertiary)`,
          borderLeft: `3px solid ${cfg.accent}`, borderRadius: '6px',
          fontSize: '11px', color: 'var(--color-text-secondary)',
          cursor: item.link_url ? 'pointer' : 'default',
          transition: 'border-color 0.12s',
          fontFamily: 'Inter, sans-serif',
        }}
        onMouseEnter={e => { if (item.link_url) (e.currentTarget as HTMLDivElement).style.borderRightColor = '#185FA5' }}
      >
        <span style={{ fontSize: '13px', flexShrink: 0 }}>{cfg.icon}</span>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
          {item.title}
        </span>
        {item.link_url && (
          <span style={{ fontSize: '10px', color: '#185FA5', fontWeight: 600, flexShrink: 0 }}>
            {item.link_label ?? 'View →'}
          </span>
        )}
      </div>
      {items.length > 1 && (
        <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }}>
          {items.map((_, i) => (
            <div key={i} style={{
              width: '4px', height: '4px', borderRadius: '50%',
              background: i === activeIdx ? '#185FA5' : 'var(--color-border-tertiary)'
            }} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Announcements
