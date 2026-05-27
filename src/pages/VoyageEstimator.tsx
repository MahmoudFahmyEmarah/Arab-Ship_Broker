import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCargo } from '../hooks/useCargo'
import { useVessels } from '../hooks/useVessels'
import type { CargoListing, VesselAvailability, SubscriptionTier } from '../types'

interface Props { tier?: SubscriptionTier }

type Tab = 'economics' | 'das' | 'suez' | 'docs'

const VoyageEstimator: React.FC<Props> = ({ tier: _tier }) => {
  const { cargo } = useCargo()
  const { vessels } = useVessels()
  const [selectedVessel, setSelectedVessel] = useState<VesselAvailability | null>(null)
  const [selectedCargo, setSelectedCargo] = useState<CargoListing | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('economics')
  const [livePrices, setLivePrices] = useState<{ vlsfo: number; lsmgo: number; updatedAt?: string } | null>(null)

  useEffect(() => {
    supabase
      .from('fuel_prices')
      .select('vlsfo_usd_mt, lsmgo_usd_mt, updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setLivePrices({
          vlsfo: data.vlsfo_usd_mt ?? 0,
          lsmgo: data.lsmgo_usd_mt ?? 0,
          updatedAt: data.updated_at
        })
      })
  }, [])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 24px', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C' }}>Voyage Estimator</div>
          <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
            Complete voyage P&L · Port DAs · Suez Canal toll · Documentation
          </div>
        </div>
        <button style={{
          padding: '6px 14px', border: '0.5px solid var(--color-border-tertiary)',
          background: 'transparent', borderRadius: '5px', fontSize: '11px',
          cursor: 'pointer', fontFamily: 'Inter, sans-serif', color: '#1B3A5C'
        }}>
          Export estimate ↗
        </button>
      </div>

      {/* Vessel + Cargo selectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', marginBottom: '16px', alignItems: 'end' }}>
        <Field label="Vessel">
          <select
            value={selectedVessel?.id ?? ''}
            onChange={e => setSelectedVessel(vessels.find(v => v.id === e.target.value) ?? null)}
            style={selectStyle}
          >
            <option value="">— Select vessel from registered fleet —</option>
            {vessels.map(v => (
              <option key={v.id} value={v.id}>
                {v.vessel?.vessel_name ?? 'TBN'} — {v.vessel?.imo_number ? `IMO ${v.vessel.imo_number}` : `${v.vessel?.dwt_grain ?? '?'} DWT`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cargo">
          <select
            value={selectedCargo?.id ?? ''}
            onChange={e => setSelectedCargo(cargo.find(c => c.id === e.target.value) ?? null)}
            style={selectStyle}
          >
            <option value="">— Select cargo position —</option>
            {cargo.map(c => (
              <option key={c.id} value={c.id}>
                {c.ref} · {c.commodity_name} · {c.load_port_locode} → {c.disch_port_locode}
              </option>
            ))}
          </select>
        </Field>
        {livePrices && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ padding: '3px 8px', background: '#E6F1FB', color: '#185FA5', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                VLSFO ${livePrices.vlsfo}/MT
              </span>
              <span style={{ padding: '3px 8px', background: '#EAF3DE', color: '#27500A', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                LSMGO ${livePrices.lsmgo}/MT
              </span>
            </div>
            <div style={{ fontSize: '9px', color: 'var(--color-text-secondary)', textAlign: 'right' }}>
              <span style={{ color: '#97C459' }}>● Live</span> · Singapore
            </div>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '0.5px solid var(--color-border-tertiary)', marginBottom: '16px' }}>
        {[
          { k: 'economics', label: 'Voyage Economics' },
          { k: 'das',       label: 'Port Disbursements' },
          { k: 'suez',      label: 'Suez Canal' },
          { k: 'docs',      label: 'Documentation Tips' }
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setActiveTab(t.k as Tab)}
            style={{
              padding: '10px 16px', background: 'none', border: 'none',
              borderBottom: activeTab === t.k ? '2px solid #185FA5' : '2px solid transparent',
              color: activeTab === t.k ? '#185FA5' : 'var(--color-text-secondary)',
              fontSize: '12px', fontWeight: activeTab === t.k ? 600 : 500,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'economics' && <VoyageEconomicsTab vessel={selectedVessel} cargo={selectedCargo} livePrices={livePrices} />}
      {activeTab === 'das'       && <PlaceholderTab title="Port Disbursements" />}
      {activeTab === 'suez'      && <PlaceholderTab title="Suez Canal Toll" />}
      {activeTab === 'docs'      && <PlaceholderTab title="Documentation Tips" />}
    </div>
  )
}

// ─── Voyage Economics Tab ──────────────────────────────────────
const VoyageEconomicsTab: React.FC<{
  vessel: VesselAvailability | null
  cargo: CargoListing | null
  livePrices: { vlsfo: number; lsmgo: number } | null
}> = ({ vessel, cargo, livePrices: _livePrices }) => {
  const v = vessel?.vessel

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      {/* Vessel snapshot */}
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', padding: '16px' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
          Vessel — from registration
        </div>
        <DataRow label="Vessel name">{v?.vessel_name ?? '—'}</DataRow>
        <DataRow label="Type / Flag">{v?.vessel_type ?? '—'} · {v?.flag ?? '—'}</DataRow>
        <DataRow label="DWT (MT)" numeric>{v?.dwt_grain?.toLocaleString() ?? '—'}</DataRow>
        <DataRow label="DWCC (MT)" numeric>{v?.dwcc?.toLocaleString() ?? '—'}</DataRow>
        <DataRow label="VLSFO sea (MT/day)" numeric>{vessel?.vlsfo_sea_mt_day ?? '—'}</DataRow>
        <DataRow label="VLSFO port (MT/day)" numeric>{vessel?.vlsfo_port_mt_day ?? '—'}</DataRow>
        <DataRow label="LSMGO sea (MT/day)" numeric>{vessel?.lsmgo_sea_mt_day ?? '—'}</DataRow>
        <DataRow label="LSMGO port (MT/day)" numeric>{vessel?.lsmgo_port_mt_day ?? '—'}</DataRow>
      </div>

      {/* Cargo snapshot */}
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', padding: '16px' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
          Cargo — from listing
        </div>
        <DataRow label="Cargo">{cargo?.commodity_name ?? '—'} {cargo && `(${cargo.cargo_type})`}</DataRow>
        <DataRow label="Quantity (MT)" numeric>{cargo ? `${cargo.qty_min_mt.toLocaleString()}–${cargo.qty_max_mt.toLocaleString()}` : '—'}</DataRow>
        <DataRow label="Freight rate ($/MT)" numeric editable>{cargo?.freight_idea_usd_mt ?? '—'}</DataRow>
        <DataRow label="Commission (%)" numeric editable>{cargo?.commission_pct ?? '—'}</DataRow>
        <DataRow label="Load rate (MT/day)" numeric>{cargo?.load_rate ?? '—'}</DataRow>
        <DataRow label="Discharge rate (MT/day)" numeric>{cargo?.disch_rate ?? '—'}</DataRow>
      </div>

      <div style={{ gridColumn: '1 / -1', fontSize: '10px', color: 'var(--color-text-secondary)', padding: '4px 0' }}>
        Green = auto-retrieved from database · Blue underline = editable for this estimate · All calculations run in the backend.
      </div>

      {/* Voyage legs */}
      <div style={{ gridColumn: '1 / -1', background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'Inter, sans-serif' }}>
          <thead style={{ background: '#1B3A5C', color: '#fff' }}>
            <tr>
              <th style={thStyle}>LEG</th>
              <th style={thStyle}>FROM → TO</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>NM</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>DAYS</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>VLSFO (MT)</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>LSMGO (MT)</th>
              <th style={thStyle}>NOTE</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={tdStyle}>1 — Ballast leg</td><td style={tdStyle}>{vessel?.open_port_name ?? '—'} → {cargo?.load_port_name ?? '—'}</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={{ ...tdStyle, fontSize: '10px', color: 'var(--color-text-secondary)' }}>Manual entry — distance not in Phase 1 table.</td></tr>
            <tr><td style={tdStyle}>2 — Laden leg</td><td style={tdStyle}>{cargo?.load_port_name ?? '—'} → {cargo?.disch_port_name ?? '—'}</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={{ ...tdStyle, fontSize: '10px', color: 'var(--color-text-secondary)' }}>Auto from distance table.</td></tr>
            <tr><td style={tdStyle}>3 — Port: Loading</td><td style={tdStyle}>{cargo?.load_port_name ?? '—'}</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={{ ...tdStyle, fontSize: '10px', color: 'var(--color-text-secondary)' }}>Qty ÷ Load rate.</td></tr>
            <tr><td style={tdStyle}>4 — Port: Discharging</td><td style={tdStyle}>{cargo?.disch_port_name ?? '—'}</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={{ ...tdStyle, fontSize: '10px', color: 'var(--color-text-secondary)' }}>Qty ÷ Discharge rate.</td></tr>
            <tr style={{ borderTop: '1px solid var(--color-border-tertiary)', fontWeight: 600 }}>
              <td style={tdStyle}>Totals</td><td style={tdStyle}></td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdNum}>—</td><td style={tdStyle}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PlaceholderTab: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', padding: '40px', textAlign: 'center' }}>
    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B3A5C', marginBottom: '6px' }}>{title}</div>
    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>This tab is being built. Check back soon.</div>
  </div>
)

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{label}</div>
    {children}
  </div>
)

const DataRow: React.FC<{ label: string; numeric?: boolean; editable?: boolean; children: React.ReactNode }> = ({ label, numeric, editable, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '6px 0', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: '12px' }}>
    <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
    <span style={{
      color: '#1B3A5C',
      fontWeight: 500,
      fontVariantNumeric: numeric ? 'tabular-nums' : 'normal',
      textDecoration: editable ? 'underline' : 'none',
      textDecorationColor: editable ? '#185FA5' : 'transparent',
      cursor: editable ? 'pointer' : 'default'
    }}>{children}</span>
  </div>
)

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '0.5px solid var(--color-border-tertiary)', borderRadius: '5px',
  fontSize: '12px', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-primary)', color: '#1B3A5C'
}

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderTop: '0.5px solid var(--color-border-tertiary)', color: '#1B3A5C' }
const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

export default VoyageEstimator
