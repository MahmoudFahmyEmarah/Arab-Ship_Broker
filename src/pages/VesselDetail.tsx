import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import MatchExplainer from '../components/shared/MatchExplainer'
import { scoreMatch, type MatchResult } from '../lib/matching'
import type { VesselAvailability, CargoListing, SubscriptionTier } from '../types'

interface Props { tier: SubscriptionTier; isAdmin: boolean }

const VesselDetail: React.FC<Props> = ({ tier, isAdmin }) => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [va, setVa] = useState<VesselAvailability | null>(null)
  const [matches, setMatches] = useState<Array<CargoListing & { score_label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  const [liveScores, setLiveScores] = useState<Record<string, MatchResult>>({})

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('vessel_availability').select('*, vessel:vessels(*)').eq('id', id).single(),
      supabase.from('matches').select('score_label, cargo_id, cargo_listings(*)').eq('vessel_avail_id', id)
    ]).then(([v, m]) => {
      const va = v.data
      const matchedCargo = (m.data ?? []).map((r: any) => ({ ...r.cargo_listings, score_label: r.score_label }))
      setVa(va)
      setMatches(matchedCargo)

      if (va) {
        const scores: Record<string, MatchResult> = {}
        matchedCargo.forEach(c => {
          scores[c.id] = scoreMatch(c, va)
        })
        setLiveScores(scores)
      }

      setLoading(false)
    })
  }, [id])

  if (loading) return <Centred text="Loading vessel..." />
  if (!va || !va.vessel) return <Centred text="Vessel not found" />

  const vessel = va.vessel
  const isOverdue = va.open_date && new Date(va.open_date) < new Date() && va.status === 'OPEN'
  const showPartner = va.for_circulation && (tier === 'T3' || tier === 'T4' || isAdmin)
  const showLocked  = va.for_circulation && tier === 'T2'

  return (
    <div style={{ height: '100%', overflow: 'auto', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-secondary)' }}>
      {/* HEADER */}
      <div style={{
        background: 'var(--color-background-primary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        borderLeft: `4px solid ${isOverdue ? '#E24B4A' : va.status === 'OPEN' ? '#97C459' : '#EF9F27'}`,
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <button onClick={() => navigate(-1)} style={backBtnStyle}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            <span style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C' }}>{vessel.vessel_name}</span>
            <span style={{ ...badgeStyle, background: isOverdue ? '#FCEBEB' : va.status === 'OPEN' ? '#EAF3DE' : '#FAEEDA', color: isOverdue ? '#A32D2D' : va.status === 'OPEN' ? '#27500A' : '#854F0B' }}>
              {isOverdue ? 'OVERDUE' : va.status}
            </span>
            {vessel.is_sanctioned && <span style={{ ...badgeStyle, background: '#FCEBEB', color: '#A32D2D' }}>SANCTIONED ⚠</span>}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', letterSpacing: '0.04em' }}>
            {vessel.imo_number && <>IMO <span style={{ fontFamily: 'monospace', color: '#185FA5' }}>{vessel.imo_number}</span> · </>}
            {vessel.vessel_type} · {vessel.flag ?? 'Flag TBN'}
            {vessel.build_year && <> · Built {vessel.build_year}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(isAdmin || tier === 'T4') && <button style={btnSecondaryStyle}>Edit</button>}
          <button style={btnPrimaryStyle}>Mark Fixed →</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', padding: '12px 16px' }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Open position */}
          <Panel title="Open Position">
            <Grid2>
              <DataLine label="Open port">{va.open_port_name ?? va.open_port_locode ?? '—'}</DataLine>
              <DataLine label="Zone">{va.open_zone ?? '—'}</DataLine>
              <DataLine label="Open date">
                <span style={{ color: isOverdue ? '#A32D2D' : 'inherit', fontWeight: isOverdue ? 600 : 400 }}>
                  {va.open_date ? new Date(va.open_date).toLocaleDateString() : 'SPOT'}
                </span>
              </DataLine>
              <DataLine label="Flex window">{va.open_date_range_days ? `± ${va.open_date_range_days} days` : '—'}</DataLine>
              {va.last_cargo && <DataLine label="Last cargo" span2>{va.last_cargo}</DataLine>}
            </Grid2>
          </Panel>

          {/* Vessel specs */}
          <Panel title="Vessel Specs">
            <Grid2>
              <DataLine label="DWT">{vessel.dwt_grain?.toLocaleString() ?? '—'} MT</DataLine>
              <DataLine label="DWCC">
                <span style={{ color: '#185FA5', fontWeight: 600 }}>
                  {vessel.dwcc?.toLocaleString() ?? '—'} {vessel.dwcc ? 'MT' : ''}
                </span>
              </DataLine>
              <DataLine label="Bale">{vessel.dwt_bale?.toLocaleString() ?? '—'}</DataLine>
              <DataLine label="LOA">{vessel.max_loa_m ? `${vessel.max_loa_m} m` : '—'}</DataLine>
              <DataLine label="Max draft">{vessel.max_draft_m ? `${vessel.max_draft_m} m` : '—'}</DataLine>
              <DataLine label="Grain cap.">{vessel.grain_cbm ? `${vessel.grain_cbm.toLocaleString()} m³` : '—'}</DataLine>
              <DataLine label="Gear">{vessel.is_geared ? 'Geared' : vessel.is_geared === false ? 'Gearless' : '—'}</DataLine>
              {vessel.crane_count && <DataLine label="Cranes">{vessel.crane_count} × {vessel.crane_swl_mt ?? '?'} MT SWL</DataLine>}
            </Grid2>
          </Panel>

          {/* Bunker consumption */}
          {(va.vlsfo_sea_mt_day || va.lsmgo_sea_mt_day || va.vlsfo_port_mt_day || va.lsmgo_port_mt_day) && (
            <Panel title="Bunker Consumption">
              <Grid2>
                <DataLine label="VLSFO at sea">{va.vlsfo_sea_mt_day ? `${va.vlsfo_sea_mt_day} MT/day` : '—'}</DataLine>
                <DataLine label="VLSFO in port">{va.vlsfo_port_mt_day ? `${va.vlsfo_port_mt_day} MT/day` : '—'}</DataLine>
                <DataLine label="LSMGO at sea">{va.lsmgo_sea_mt_day ? `${va.lsmgo_sea_mt_day} MT/day` : '—'}</DataLine>
                <DataLine label="LSMGO in port">{va.lsmgo_port_mt_day ? `${va.lsmgo_port_mt_day} MT/day` : '—'}</DataLine>
              </Grid2>
            </Panel>
          )}

          {/* Compliance */}
          <Panel title="Compliance">
            <Grid2>
              <DataLine label="Grain certified">{vessel.grain_certified ? '✓ Yes' : vessel.grain_certified === false ? '✗ No' : 'Not declared'}</DataLine>
              <DataLine label="DG certified">{vessel.dg_certified ? '✓ Yes' : vessel.dg_certified === false ? '✗ No' : 'Not declared'}</DataLine>
              <DataLine label="Scope">{vessel.scope}</DataLine>
              <DataLine label="Accepts part cargo">{va.accepts_part_cargo ? 'Yes' : 'No'}</DataLine>
            </Grid2>
          </Panel>

          {/* Commercial */}
          {(va.freight_idea_usd_mt || va.commission_pct) && (
            <Panel title="Commercial">
              <Grid2>
                {va.freight_idea_usd_mt && <DataLine label="Freight idea">${va.freight_idea_usd_mt}/MT</DataLine>}
                {va.commission_pct && <DataLine label="Commission">{va.commission_pct}%</DataLine>}
              </Grid2>
            </Panel>
          )}

          {/* Notes */}
          {va.notes && (
            <Panel title="Notes">
              <div style={{ fontSize: '12px', color: '#1B3A5C', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{va.notes}</div>
            </Panel>
          )}
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Distribution */}
          <Panel title="Distribution">
            <DataLine label="Circulating in market">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: va.for_circulation ? '#27500A' : 'var(--color-text-secondary)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: va.for_circulation ? '#97C459' : 'var(--color-border-tertiary)' }} />
                {va.for_circulation ? 'YES — visible to vetted market partners' : 'NO — Arab ShipBroker only'}
              </span>
            </DataLine>
            {showPartner && va.market_partner_name && (
              <DataLine label="Market partner">via <span style={{ color: '#185FA5', fontWeight: 500 }}>{va.market_partner_name}</span></DataLine>
            )}
            {showLocked && (
              <DataLine label="Market partner">
                <span style={{ fontFamily: 'monospace', background: 'var(--color-background-secondary)', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>· · · · ·</span>
                <span style={{ marginLeft: '6px', fontSize: '10px', color: '#185FA5', textDecoration: 'underline', cursor: 'pointer' }}>Unlock with Subscriber tier</span>
              </DataLine>
            )}
            {va.broker && isAdmin && <DataLine label="Posted by (admin)">{va.broker}</DataLine>}
          </Panel>

          {/* Owner contact — ADMIN ONLY */}
          {isAdmin && (
            <Panel title="Owner Contact (Admin)">
              <div style={{ background: '#FAEEDA', color: '#854F0B', padding: '6px 10px', fontSize: '10px', borderRadius: '4px', marginBottom: '8px', lineHeight: 1.5 }}>
                ⚠ Encrypted PII — admin view only. Never displayed to users.
              </div>
              <DataLine label="Owner company">{vessel.owner_company ?? '—'}</DataLine>
              <DataLine label="Manager">{vessel.manager_company ?? '—'}</DataLine>
              <DataLine label="Point of contact">{vessel.pic_name ?? '—'}</DataLine>
              <DataLine label="Phone">{vessel.phone ?? '—'}</DataLine>
              <DataLine label="Email">{vessel.email_chartering ?? vessel.email_general ?? '—'}</DataLine>
            </Panel>
          )}

          {/* Matches */}
          <Panel title={`Cargo Matches · ${matches.length}`}>
            {matches.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '12px 0' }}>
                No cargo currently matches this vessel. Arab ShipBroker surfaces candidates as new cargo posts.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>
                {matches.map(c => {
                  const score = liveScores[c.id]
                  const isExpanded = expandedMatch === c.id
                  return (
                    <div key={c.id} style={{
                      border: '0.5px solid var(--color-border-tertiary)',
                      borderLeft: `3px solid ${matchColor(c.score_label)}`,
                      borderRadius: '4px',
                      background: 'var(--color-background-primary)',
                      overflow: 'hidden'
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '8px', padding: '8px 10px' }}>
                        <button
                          onClick={() => navigate(`/cargo/${c.id}`)}
                          style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'Inter, sans-serif', padding: 0, minWidth: 0 }}
                        >
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#1B3A5C' }}>{c.commodity_name}</div>
                          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                            {c.qty_max_mt.toLocaleString()} MT · {c.load_port_locode} → {c.disch_port_locode}
                          </div>
                        </button>
                        <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px', background: matchBgColor(c.score_label), color: matchTextColor(c.score_label) }}>
                          {c.score_label.toUpperCase()}
                        </span>
                        <button
                          onClick={() => setExpandedMatch(isExpanded ? null : c.id)}
                          title="Show match breakdown"
                          style={{
                            width: '20px', height: '20px', border: '0.5px solid var(--color-border-tertiary)',
                            borderRadius: '3px', background: isExpanded ? '#E6F1FB' : 'transparent',
                            color: isExpanded ? '#185FA5' : 'var(--color-text-secondary)',
                            cursor: 'pointer', fontSize: '11px', padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                        >{isExpanded ? '−' : '?'}</button>
                      </div>
                      {isExpanded && score && (
                        <div style={{ padding: '0 8px 8px' }}>
                          <MatchExplainer result={score} compact />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          {/* Meta */}
          <Panel title="Record">
            <DataLine label="Created">{new Date(va.created_at).toLocaleDateString()}</DataLine>
            <DataLine label="Last updated">{new Date(va.updated_at).toLocaleDateString()}</DataLine>
            {va.goes_live_at && <DataLine label="Live since">{new Date(va.goes_live_at).toLocaleDateString()}</DataLine>}
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers (same as CargoDetail) ──────────────────────────────

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '6px' }}>
    <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{title}</div>
    <div style={{ padding: '12px 14px' }}>{children}</div>
  </div>
)

const Grid2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>{children}</div>
)

const DataLine: React.FC<{ label: string; span2?: boolean; children: React.ReactNode }> = ({ label, span2, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', gridColumn: span2 ? '1 / -1' : 'auto', padding: '4px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
    <span style={{ fontSize: '9px', fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</span>
    <span style={{ fontSize: '12px', fontWeight: 500, color: '#1B3A5C' }}>{children}</span>
  </div>
)

const matchColor = (s: string) => s === 'Strong' ? '#97C459' : s === 'Good' ? '#185FA5' : s === 'Possible' ? '#EF9F27' : '#E24B4A'
const matchBgColor = (s: string) => s === 'Strong' ? '#EAF3DE' : s === 'Good' ? '#E6F1FB' : s === 'Possible' ? '#FAEEDA' : '#FCEBEB'
const matchTextColor = (s: string) => s === 'Strong' ? '#27500A' : s === 'Good' ? '#0C447C' : s === 'Possible' ? '#854F0B' : '#A32D2D'

const Centred: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>{text}</div>
)

const badgeStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '3px', letterSpacing: '0.04em' }
const backBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '11px', cursor: 'pointer', padding: '2px 0', fontFamily: 'Inter, sans-serif' }
const btnPrimaryStyle: React.CSSProperties = { padding: '7px 14px', background: '#185FA5', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }
const btnSecondaryStyle: React.CSSProperties = { padding: '7px 14px', background: 'transparent', color: '#1B3A5C', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }

export default VesselDetail
