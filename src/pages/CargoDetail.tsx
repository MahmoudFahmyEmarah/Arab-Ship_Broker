import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LeafletMap from '../components/map/LeafletMap'
import {
  getScopeColor, getCategoryBadge, formatLaycan, calcVolume
} from '../lib/cargo'
import type { CargoListing, VesselAvailability, SubscriptionTier } from '../types'

interface Props { tier: SubscriptionTier; isAdmin: boolean }

const CargoDetail: React.FC<Props> = ({ tier, isAdmin }) => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [cargo, setCargo] = useState<CargoListing | null>(null)
  const [matches, setMatches] = useState<Array<VesselAvailability & { score_label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  const [liveScores, setLiveScores] = useState<Record<string, MatchResult>>({})

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('cargo_listings').select('*').eq('id', id).single(),
      supabase.from('matches').select('score_label, vessel_avail_id, vessel_availability(*, vessel:vessels(*))').eq('cargo_id', id)
    ]).then(([c, m]) => {
      const cargo = c.data
      const matchedVessels = (m.data ?? []).map((r: any) => ({ ...r.vessel_availability, score_label: r.score_label }))
      setCargo(cargo)
      setMatches(matchedVessels)

      // Compute detailed scores for each match using the live engine
      if (cargo) {
        const scores: Record<string, MatchResult> = {}
        matchedVessels.forEach(v => {
          scores[v.id] = scoreMatch(cargo, v)
        })
        setLiveScores(scores)
      }

      setLoading(false)
    })
  }, [id])

  if (loading) return <Centred text="Loading cargo..." />
  if (!cargo)  return <Centred text="Cargo not found" />

  const scopeColor = getScopeColor(cargo.status)
  const badge = getCategoryBadge(cargo.cargo_type, cargo.is_grain_cargo)
  const volume = cargo.volume_m3 ?? calcVolume(cargo.qty_max_mt, cargo.stowage_factor)
  const showPartner = cargo.for_circulation && (tier === 'T3' || tier === 'T4' || isAdmin)
  const showLocked  = cargo.for_circulation && tier === 'T2'

  return (
    <div style={{ height: '100%', overflow: 'auto', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-secondary)' }}>
      {/* HEADER */}
      <div style={{
        background: 'var(--color-background-primary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        borderLeft: `4px solid ${scopeColor}`,
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <button onClick={() => navigate(-1)} style={backBtnStyle}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            <span style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C' }}>{cargo.commodity_name}</span>
            <span style={{ ...badgeStyle, background: badge.bg, color: badge.color }}>{badge.label}</span>
            {cargo.is_wog && <span style={{ ...badgeStyle, background: '#FAEEDA', color: '#854F0B' }}>WOG</span>}
            {cargo.is_spot && <span style={{ ...badgeStyle, background: '#EAF3DE', color: '#27500A' }}>SPOT</span>}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', letterSpacing: '0.04em' }}>
            REF <span style={{ fontFamily: 'monospace', color: '#185FA5' }}>{cargo.ref}</span>
            {cargo.batch_id && <> · Batch <span style={{ fontFamily: 'monospace' }}>{cargo.batch_id}</span></>}
            {' · '}Status <span style={{ color: scopeColor, fontWeight: 600 }}>{cargo.status}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(isAdmin || tier === 'T4') && <button style={btnSecondaryStyle}>Edit</button>}
          <button style={btnPrimaryStyle}>Mark Fixed →</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', padding: '12px 16px' }}>

        {/* LEFT — Main details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Route panel */}
          <Panel title="Route">
            <RouteRow type="load"  port={cargo.load_port_name}  locode={cargo.load_port_locode}  zone={cargo.load_zone}  country={cargo.load_country} />
            {cargo.load_port_2_name && <RouteRow type="load"  port={cargo.load_port_2_name} locode={cargo.load_port_2_locode} alt />}
            {cargo.load_port_3_name && <RouteRow type="load"  port={cargo.load_port_3_name} locode={cargo.load_port_3_locode} alt />}
            <div style={{ height: '8px', borderLeft: '1px dashed var(--color-border-tertiary)', marginLeft: '11px' }} />
            <RouteRow type="disch" port={cargo.disch_port_name} locode={cargo.disch_port_locode} zone={cargo.disch_zone} country={cargo.disch_country} />
            {cargo.disch_port_2_name && <RouteRow type="disch" port={cargo.disch_port_2_name} locode={cargo.disch_port_2_locode} alt />}
            {cargo.disch_port_3_name && <RouteRow type="disch" port={cargo.disch_port_3_name} locode={cargo.disch_port_3_locode} alt />}
          </Panel>

          {/* Quantity + laycan */}
          <Panel title="Quantity & Laycan">
            <Grid2>
              <DataLine label="Quantity">
                {cargo.qty_min_mt === cargo.qty_max_mt
                  ? `${cargo.qty_max_mt.toLocaleString()} MT`
                  : `${cargo.qty_min_mt.toLocaleString()}–${cargo.qty_max_mt.toLocaleString()} MT`}
              </DataLine>
              <DataLine label="Stowage factor">{cargo.stowage_factor ? `${cargo.stowage_factor} m³/t` : 'Not declared'}</DataLine>
              <DataLine label="Volume">{volume ? <span style={{ color: '#185FA5' }}>{volume.toLocaleString()} m³</span> : '—'}</DataLine>
              <DataLine label="Laycan">{formatLaycan(cargo.laycan_from, cargo.laycan_to, cargo.is_spot)}</DataLine>
            </Grid2>
          </Panel>

          {/* Commercial terms */}
          <Panel title="Commercial Terms">
            <Grid2>
              <DataLine label="Freight idea">{cargo.freight_idea_usd_mt ? `$${cargo.freight_idea_usd_mt}/MT` : 'TBD'}</DataLine>
              <DataLine label="Commission">{cargo.commission_pct ? `${cargo.commission_pct}%` : '—'}</DataLine>
              <DataLine label="Load rate">{cargo.load_rate ?? '—'}</DataLine>
              <DataLine label="Discharge rate">{cargo.disch_rate ?? '—'}</DataLine>
              <DataLine label="Load terms">{cargo.load_terms ?? '—'}</DataLine>
              <DataLine label="Laytime">{cargo.laytime_qualifier ?? '—'}</DataLine>
              {cargo.demurrage_rate && <DataLine label="Demurrage">${cargo.demurrage_rate}/day</DataLine>}
              {cargo.despatch_rate  && <DataLine label="Despatch">${cargo.despatch_rate}/day</DataLine>}
              {cargo.nor_clause && <DataLine label="NOR" span2>{cargo.nor_clause}</DataLine>}
            </Grid2>
          </Panel>

          {/* Vessel requirements */}
          {(cargo.requires_geared !== undefined || cargo.max_vessel_age_yr || cargo.max_loa_m || cargo.max_draft_m) && (
            <Panel title="Vessel Requirements">
              <Grid2>
                {cargo.requires_geared !== undefined && <DataLine label="Gear">{cargo.requires_geared ? 'Geared required' : 'Gearless OK'}</DataLine>}
                {cargo.max_vessel_age_yr && <DataLine label="Max age">{cargo.max_vessel_age_yr} years</DataLine>}
                {cargo.max_loa_m   && <DataLine label="Max LOA">{cargo.max_loa_m} m</DataLine>}
                {cargo.max_draft_m && <DataLine label="Max draft">{cargo.max_draft_m} m</DataLine>}
              </Grid2>
            </Panel>
          )}

          {/* IMSBC / DG flags */}
          {(cargo.imsbc_category || cargo.is_dg_cargo || cargo.is_grain_cargo) && (
            <Panel title="Cargo Safety">
              <Grid2>
                <DataLine label="IMSBC group">
                  <span style={{ color: cargo.imsbc_category === 'Cat_A' ? '#854F0B' : 'inherit', fontWeight: cargo.imsbc_category === 'Cat_A' ? 600 : 400 }}>
                    {cargo.imsbc_category?.replace('Cat_', 'Group ') ?? '—'}
                    {cargo.imsbc_category === 'Cat_A' && ' ⚠ Liquefaction risk'}
                  </span>
                </DataLine>
                <DataLine label="Grain Code">{cargo.is_grain_cargo ? 'Required' : 'Not applicable'}</DataLine>
                <DataLine label="Dangerous goods">{cargo.is_dg_cargo ? 'Yes' : 'No'}</DataLine>
              </Grid2>
            </Panel>
          )}

          {/* Notes */}
          {cargo.notes && (
            <Panel title="Notes">
              <div style={{ fontSize: '12px', color: '#1B3A5C', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {cargo.notes}
              </div>
            </Panel>
          )}
        </div>

        {/* RIGHT — Match + meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Circulation + Partner */}
          <Panel title="Distribution">
            <DataLine label="Circulating in market">
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '11px', fontWeight: 600,
                color: cargo.for_circulation ? '#27500A' : 'var(--color-text-secondary)'
              }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: cargo.for_circulation ? '#97C459' : 'var(--color-border-tertiary)'
                }} />
                {cargo.for_circulation ? 'YES — visible to vetted market partners' : 'NO — Arab ShipBroker only'}
              </span>
            </DataLine>
            {showPartner && cargo.market_partner_name && (
              <DataLine label="Market partner">
                via <span style={{ color: '#185FA5', fontWeight: 500 }}>{cargo.market_partner_name}</span>
              </DataLine>
            )}
            {showLocked && (
              <DataLine label="Market partner">
                <span style={{ fontFamily: 'monospace', background: 'var(--color-background-secondary)', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>· · · · ·</span>
                <span style={{ marginLeft: '6px', fontSize: '10px', color: '#185FA5', textDecoration: 'underline', cursor: 'pointer' }}>Unlock with Subscriber tier</span>
              </DataLine>
            )}
            {cargo.broker && isAdmin && (
              <DataLine label="Posted by (admin)">{cargo.broker}</DataLine>
            )}
          </Panel>

          {/* Matches */}
          <Panel title={`Vessel Matches · ${matches.length}`}>
            {matches.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '12px 0' }}>
                No vessels currently match this cargo. Arab ShipBroker will surface candidates as they post position.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>
                {matches.map(m => {
                  const score = liveScores[m.id]
                  const isExpanded = expandedMatch === m.id
                  return (
                    <div key={m.id} style={{
                      border: '0.5px solid var(--color-border-tertiary)',
                      borderLeft: `3px solid ${matchColor(m.score_label)}`,
                      borderRadius: '4px',
                      background: 'var(--color-background-primary)',
                      overflow: 'hidden'
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '8px', padding: '8px 10px' }}>
                        <button
                          onClick={() => navigate(`/vessel/${m.id}`)}
                          style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'Inter, sans-serif', padding: 0, minWidth: 0 }}
                        >
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#1B3A5C' }}>
                            {m.vessel?.vessel_name ?? 'TBN'}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                            {(m.vessel?.dwcc ?? m.vessel?.dwt_grain)?.toLocaleString() ?? '?'} MT · Open {m.open_port_name ?? m.open_port_locode}
                          </div>
                        </button>
                        <span style={{
                          fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px',
                          background: matchBgColor(m.score_label), color: matchTextColor(m.score_label)
                        }}>
                          {m.score_label.toUpperCase()}
                        </span>
                        <button
                          onClick={() => setExpandedMatch(isExpanded ? null : m.id)}
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
            <DataLine label="Created">{new Date(cargo.created_at).toLocaleDateString()}</DataLine>
            <DataLine label="Last updated">{new Date(cargo.updated_at).toLocaleDateString()}</DataLine>
            {cargo.goes_live_at && <DataLine label="Live since">{new Date(cargo.goes_live_at).toLocaleDateString()}</DataLine>}
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '6px' }}>
    <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
      {title}
    </div>
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

const RouteRow: React.FC<{ type: 'load' | 'disch'; port?: string; locode?: string; zone?: string; country?: string; alt?: boolean }> = ({ type, port, locode, zone, country, alt }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', marginLeft: alt ? '32px' : '0' }}>
    <div style={{
      width: '20px', height: '20px', borderRadius: '50%',
      background: alt ? 'var(--color-background-secondary)' : (type === 'load' ? '#EAF3DE' : '#FCEBEB'),
      border: `0.5px solid ${type === 'load' ? '#97C459' : '#E24B4A'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '10px', fontWeight: 600,
      color: type === 'load' ? '#27500A' : '#A32D2D',
      flexShrink: 0
    }}>{alt ? '+' : type === 'load' ? 'L' : 'D'}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1B3A5C' }}>
        {port ?? '—'}{locode && <span style={{ fontFamily: 'monospace', color: '#185FA5', fontWeight: 500, marginLeft: '6px' }}>{locode}</span>}
      </div>
      {(zone || country) && (
        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
          {country}{country && zone && ' · '}{zone}
        </div>
      )}
    </div>
  </div>
)

const matchColor = (s: string) => s === 'Strong' ? '#97C459' : s === 'Good' ? '#185FA5' : s === 'Possible' ? '#EF9F27' : '#E24B4A'
const matchBgColor = (s: string) => s === 'Strong' ? '#EAF3DE' : s === 'Good' ? '#E6F1FB' : s === 'Possible' ? '#FAEEDA' : '#FCEBEB'
const matchTextColor = (s: string) => s === 'Strong' ? '#27500A' : s === 'Good' ? '#0C447C' : s === 'Possible' ? '#854F0B' : '#A32D2D'

const Centred: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>{text}</div>
)

const badgeStyle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '3px', letterSpacing: '0.04em'
}

const backBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-text-secondary)',
  fontSize: '11px', cursor: 'pointer', padding: '2px 0',
  fontFamily: 'Inter, sans-serif'
}

const btnPrimaryStyle: React.CSSProperties = {
  padding: '7px 14px', background: '#185FA5', color: '#fff',
  border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}

const btnSecondaryStyle: React.CSSProperties = {
  padding: '7px 14px', background: 'transparent', color: '#1B3A5C',
  border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
  fontSize: '11px', cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}

export default CargoDetail
