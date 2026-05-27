import React, { useState, useEffect } from 'react'
import OpenDatePicker from '../shared/OpenDatePicker'
import { supabase } from '../../lib/supabase'
import type { Vessel, VesselType, ZoneEnum } from '../../types'

interface VesselFormData {
  // Vessel mode
  vessel_mode: 'existing' | 'new'
  existing_vessel_id: string | null

  // New vessel registration
  vessel_name: string
  imo_number: string
  vessel_type: VesselType
  flag: string
  build_year: number | null
  dwt_grain: number | null
  dwcc: number | null
  max_loa_m: number | null
  max_draft_m: number | null
  is_geared: boolean | null
  crane_count: number | null
  crane_swl_mt: number | null
  grain_cbm: number | null
  bale_cbm: number | null
  grain_certified: boolean | null
  dg_certified: boolean | null

  // Open position
  open_port_locode: string
  open_date: string | null
  open_date_range_days: number | null
  is_spot: boolean
  last_cargo: string
  preferred_zones: ZoneEnum[]

  // Bunker
  vlsfo_sea_mt_day: number | null
  lsmgo_sea_mt_day: number | null
  vlsfo_port_mt_day: number | null
  lsmgo_port_mt_day: number | null
  service_speed_kn: number | null

  // Commercial
  freight_idea_usd_mt: number | null
  commission_pct: number
  accepts_part_cargo: boolean
  for_circulation: boolean
  notes: string
}

const STEPS = ['Vessel', 'Open Position', 'Capacity & Bunker', 'Commercial', 'Review']
const ZONES: ZoneEnum[] = ['B.SEA','E.MED','W.MED','C.MED','ADRIATIC','R.SEA','AG','A.SEA']

const PostPositionForm: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [myVessels, setMyVessels] = useState<Vessel[]>([])
  const [data, setData] = useState<VesselFormData>({
    vessel_mode: 'existing', existing_vessel_id: null,
    vessel_name: '', imo_number: '', vessel_type: 'General Cargo', flag: '',
    build_year: null, dwt_grain: null, dwcc: null, max_loa_m: null, max_draft_m: null,
    is_geared: null, crane_count: null, crane_swl_mt: null,
    grain_cbm: null, bale_cbm: null,
    grain_certified: null, dg_certified: null,
    open_port_locode: '', open_date: null, open_date_range_days: null, is_spot: false,
    last_cargo: '', preferred_zones: [],
    vlsfo_sea_mt_day: null, lsmgo_sea_mt_day: null, vlsfo_port_mt_day: null, lsmgo_port_mt_day: null,
    service_speed_kn: null,
    freight_idea_usd_mt: null, commission_pct: 2.5,
    accepts_part_cargo: false, for_circulation: true,
    notes: ''
  })

  useEffect(() => {
    supabase.from('vessels').select('*').order('vessel_name').then(({ data }) => {
      setMyVessels((data ?? []) as Vessel[])
    })
  }, [])

  const update = <K extends keyof VesselFormData>(k: K, v: VesselFormData[K]) =>
    setData(d => ({ ...d, [k]: v }))

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')

    try {
      let vesselId: string

      if (data.vessel_mode === 'existing' && data.existing_vessel_id) {
        vesselId = data.existing_vessel_id
      } else {
        // Register new vessel
        const vesselRecord: any = {
          vessel_name: data.vessel_name,
          imo_number: data.imo_number || null,
          vessel_type: data.vessel_type,
          flag: data.flag || null,
          build_year: data.build_year,
          dwt_grain: data.dwt_grain,
          dwcc: data.dwcc,
          max_loa_m: data.max_loa_m,
          max_draft_m: data.max_draft_m,
          is_geared: data.is_geared,
          crane_count: data.crane_count,
          crane_swl_mt: data.crane_swl_mt,
          grain_cbm: data.grain_cbm,
          bale_cbm: data.bale_cbm,
          grain_certified: data.grain_certified,
          dg_certified: data.dg_certified,
          scope: 'In Scope',
          is_sanctioned: false,
        }
        Object.keys(vesselRecord).forEach(k => (vesselRecord[k] === null || vesselRecord[k] === '') && delete vesselRecord[k])

        const { data: vData, error: vErr } = await supabase
          .from('vessels')
          .insert(vesselRecord)
          .select('id')
          .single()
        if (vErr) throw vErr
        vesselId = vData!.id
      }

      // Insert availability
      const availRecord: any = {
        vessel_id: vesselId,
        open_port_locode: data.open_port_locode || null,
        open_date: data.is_spot ? null : data.open_date,
        open_date_range_days: data.open_date_range_days,
        last_cargo: data.last_cargo || null,
        vlsfo_sea_mt_day: data.vlsfo_sea_mt_day,
        lsmgo_sea_mt_day: data.lsmgo_sea_mt_day,
        vlsfo_port_mt_day: data.vlsfo_port_mt_day,
        lsmgo_port_mt_day: data.lsmgo_port_mt_day,
        service_speed_kn: data.service_speed_kn,
        freight_idea_usd_mt: data.freight_idea_usd_mt,
        commission_pct: data.commission_pct,
        accepts_part_cargo: data.accepts_part_cargo,
        for_circulation: data.for_circulation,
        notes: data.notes || null,
        status: 'OPEN',
        review_status: 'PENDING',
      }
      Object.keys(availRecord).forEach(k => (availRecord[k] === null || availRecord[k] === '') && delete availRecord[k])

      const { error: aErr } = await supabase.from('vessel_availability').insert(availRecord)
      if (aErr) throw aErr

      onComplete?.()
    } catch (e: any) {
      setError(e.message ?? 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '720px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C', marginBottom: '4px' }}>Post Position</div>
      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: '3px', borderRadius: '2px',
            background: i <= step ? '#185FA5' : 'var(--color-border-tertiary)'
          }} />
        ))}
      </div>

      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', padding: '20px' }}>

        {/* STEP 1 — VESSEL */}
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="Vessel">
              <div style={{ display: 'flex', gap: '8px' }}>
                <ChipBtn active={data.vessel_mode === 'existing'} onClick={() => update('vessel_mode', 'existing')}>From my registered fleet</ChipBtn>
                <ChipBtn active={data.vessel_mode === 'new'} onClick={() => update('vessel_mode', 'new')}>Register new vessel</ChipBtn>
              </div>
            </Field>

            {data.vessel_mode === 'existing' ? (
              <Field label="Select vessel">
                <select value={data.existing_vessel_id ?? ''} onChange={e => update('existing_vessel_id', e.target.value || null)} style={inputStyle}>
                  <option value="">— Choose a vessel —</option>
                  {myVessels.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.vessel_name} — {v.dwt_grain ?? '?'} DWT {v.imo_number && `· IMO ${v.imo_number}`}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '14px' }}>
                  <Field label="Vessel name">
                    <input value={data.vessel_name} onChange={e => update('vessel_name', e.target.value)} placeholder="MV ATLAS STAR" style={inputStyle} />
                  </Field>
                  <Field label="IMO number">
                    <input value={data.imo_number} onChange={e => update('imo_number', e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="9876543" maxLength={7} style={inputStyle} />
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                  <Field label="Type">
                    <select value={data.vessel_type} onChange={e => update('vessel_type', e.target.value as VesselType)} style={inputStyle}>
                      <option value="General Cargo">General Cargo</option>
                      <option value="Bulk Carrier">Bulk Carrier</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  <Field label="Flag">
                    <input value={data.flag} onChange={e => update('flag', e.target.value)} placeholder="Panama" style={inputStyle} />
                  </Field>
                  <Field label="Built">
                    <input type="number" value={data.build_year ?? ''} onChange={e => update('build_year', parseInt(e.target.value) || null)} placeholder="2008" style={inputStyle} />
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px' }}>
                  <Field label="DWT"><input type="number" value={data.dwt_grain ?? ''} onChange={e => update('dwt_grain', parseInt(e.target.value) || null)} style={inputStyle} /></Field>
                  <Field label="DWCC"><input type="number" value={data.dwcc ?? ''} onChange={e => update('dwcc', parseInt(e.target.value) || null)} style={inputStyle} /></Field>
                  <Field label="LOA (m)"><input type="number" step="0.1" value={data.max_loa_m ?? ''} onChange={e => update('max_loa_m', parseFloat(e.target.value) || null)} style={inputStyle} /></Field>
                  <Field label="Draft (m)"><input type="number" step="0.01" value={data.max_draft_m ?? ''} onChange={e => update('max_draft_m', parseFloat(e.target.value) || null)} style={inputStyle} /></Field>
                </div>
                <Field label="Gear">
                  <div style={{ display: 'flex', gap: '8px', marginBottom: data.is_geared ? '10px' : 0 }}>
                    <ChipBtn active={data.is_geared === false} onClick={() => { update('is_geared', false); update('crane_count', null); update('crane_swl_mt', null) }}>Gearless</ChipBtn>
                    <ChipBtn active={data.is_geared === true} onClick={() => update('is_geared', true)}>Geared</ChipBtn>
                  </div>
                  {data.is_geared && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <Field label="Crane count">
                        <input type="number" value={data.crane_count ?? ''} onChange={e => update('crane_count', parseInt(e.target.value) || null)} style={inputStyle} />
                      </Field>
                      <Field label="SWL per crane (MT)">
                        <input type="number" step="0.5" value={data.crane_swl_mt ?? ''} onChange={e => update('crane_swl_mt', parseFloat(e.target.value) || null)} style={inputStyle} />
                      </Field>
                    </div>
                  )}
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <Field label="Grain capacity (m³)"><input type="number" value={data.grain_cbm ?? ''} onChange={e => update('grain_cbm', parseFloat(e.target.value) || null)} style={inputStyle} /></Field>
                  <Field label="Bale capacity (m³)"><input type="number" value={data.bale_cbm ?? ''} onChange={e => update('bale_cbm', parseFloat(e.target.value) || null)} style={inputStyle} /></Field>
                </div>
                <Field label="">
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={checkboxStyle}><input type="checkbox" checked={data.grain_certified === true} onChange={e => update('grain_certified', e.target.checked || null)} /> Grain certified</label>
                    <label style={checkboxStyle}><input type="checkbox" checked={data.dg_certified === true} onChange={e => update('dg_certified', e.target.checked || null)} /> DG certified</label>
                  </div>
                </Field>
              </>
            )}
          </div>
        )}

        {/* STEP 2 — OPEN POSITION */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Open port (LOCODE)">
                <input value={data.open_port_locode} onChange={e => update('open_port_locode', e.target.value.toUpperCase())} placeholder="OMSOH" maxLength={5} style={inputStyle} />
              </Field>
              <Field label="Open date">
                <OpenDatePicker
                  openDate={data.open_date ?? undefined}
                  flexDays={data.open_date_range_days ?? undefined}
                  isSpot={data.is_spot}
                  onChange={(d, flex, spot) => {
                    update('open_date', d); update('open_date_range_days', flex); update('is_spot', spot)
                  }}
                />
              </Field>
            </div>
            <Field label="Last cargo">
              <input value={data.last_cargo} onChange={e => update('last_cargo', e.target.value)} placeholder="e.g. Wheat, Steel coils" style={inputStyle} />
            </Field>
            <Field label="Preferred zones for next cargo">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {ZONES.map(z => {
                  const sel = data.preferred_zones.includes(z)
                  return (
                    <button
                      key={z}
                      onClick={() => {
                        const cur = data.preferred_zones
                        update('preferred_zones', sel ? cur.filter(x => x !== z) : [...cur, z])
                      }}
                      style={{
                        padding: '5px 11px', borderRadius: '12px',
                        border: `0.5px solid ${sel ? '#185FA5' : 'var(--color-border-tertiary)'}`,
                        background: sel ? '#E6F1FB' : 'transparent',
                        color: sel ? '#185FA5' : '#1B3A5C',
                        fontSize: '11px', fontWeight: sel ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                      }}
                    >{z}</button>
                  )
                })}
              </div>
            </Field>
          </div>
        )}

        {/* STEP 3 — CAPACITY & BUNKER */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Service speed (kn)">
                <input type="number" step="0.1" value={data.service_speed_kn ?? ''} onChange={e => update('service_speed_kn', parseFloat(e.target.value) || null)} placeholder="12.5" style={inputStyle} />
              </Field>
              <Field label="Accepts part cargo">
                <div style={{ display: 'flex', gap: '8px' }}>
                  <ChipBtn active={data.accepts_part_cargo === false} onClick={() => update('accepts_part_cargo', false)}>Full only</ChipBtn>
                  <ChipBtn active={data.accepts_part_cargo === true} onClick={() => update('accepts_part_cargo', true)}>Part OK</ChipBtn>
                </div>
              </Field>
            </div>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginTop: '8px', paddingBottom: '4px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              Bunker consumption (MT/day)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="VLSFO at sea"><input type="number" step="0.1" value={data.vlsfo_sea_mt_day ?? ''} onChange={e => update('vlsfo_sea_mt_day', parseFloat(e.target.value) || null)} placeholder="23.5" style={inputStyle} /></Field>
              <Field label="VLSFO in port"><input type="number" step="0.1" value={data.vlsfo_port_mt_day ?? ''} onChange={e => update('vlsfo_port_mt_day', parseFloat(e.target.value) || null)} placeholder="3.5" style={inputStyle} /></Field>
              <Field label="LSMGO at sea"><input type="number" step="0.1" value={data.lsmgo_sea_mt_day ?? ''} onChange={e => update('lsmgo_sea_mt_day', parseFloat(e.target.value) || null)} placeholder="0.45" style={inputStyle} /></Field>
              <Field label="LSMGO in port"><input type="number" step="0.1" value={data.lsmgo_port_mt_day ?? ''} onChange={e => update('lsmgo_port_mt_day', parseFloat(e.target.value) || null)} placeholder="0.3" style={inputStyle} /></Field>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              Bunker figures feed the Voyage Estimator. Leave blank if not declared.
            </div>
          </div>
        )}

        {/* STEP 4 — COMMERCIAL */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Freight idea ($/MT)">
                <input type="number" value={data.freight_idea_usd_mt ?? ''} onChange={e => update('freight_idea_usd_mt', parseFloat(e.target.value) || null)} placeholder="45" style={inputStyle} />
              </Field>
              <Field label="Commission (%)">
                <input type="number" step="0.25" value={data.commission_pct} onChange={e => update('commission_pct', parseFloat(e.target.value) || 0)} style={inputStyle} />
              </Field>
            </div>
            <Field label="">
              <label style={checkboxStyle}>
                <input type="checkbox" checked={data.for_circulation} onChange={e => update('for_circulation', e.target.checked)} />
                <span>Circulate this position to vetted market partners</span>
              </label>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px', paddingLeft: '22px', lineHeight: 1.5 }}>
                When OFF, only Arab ShipBroker sees this position. Recommended for sensitive vessels.
              </div>
            </Field>
            <Field label="Notes / restrictions">
              <textarea value={data.notes} onChange={e => update('notes', e.target.value)} rows={4}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '80px', fontFamily: 'Inter, sans-serif' }}
                placeholder="DNR list, owner preferences, restricted ports, etc." />
            </Field>
          </div>
        )}

        {/* STEP 5 — REVIEW */}
        {step === 4 && (
          <div style={{ fontSize: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B3A5C', marginBottom: '12px' }}>Review & Submit</div>

            {data.vessel_mode === 'existing'
              ? <ReviewRow label="Vessel">{myVessels.find(v => v.id === data.existing_vessel_id)?.vessel_name ?? '—'} (from fleet)</ReviewRow>
              : <>
                  <ReviewRow label="Vessel">{data.vessel_name} {data.imo_number && `· IMO ${data.imo_number}`}</ReviewRow>
                  <ReviewRow label="Specs">{data.vessel_type} · {data.flag} · Built {data.build_year} · {data.dwt_grain?.toLocaleString() ?? '?'} DWT</ReviewRow>
                  {data.is_geared && <ReviewRow label="Gear">{data.crane_count} × {data.crane_swl_mt} MT cranes</ReviewRow>}
                </>
            }
            <ReviewRow label="Open port">{data.open_port_locode || '—'}</ReviewRow>
            <ReviewRow label="Open date">{data.is_spot ? 'SPOT' : data.open_date}{data.open_date_range_days ? ` ± ${data.open_date_range_days}d` : ''}</ReviewRow>
            {data.last_cargo && <ReviewRow label="Last cargo">{data.last_cargo}</ReviewRow>}
            {data.preferred_zones.length > 0 && <ReviewRow label="Preferred zones">{data.preferred_zones.join(' · ')}</ReviewRow>}
            <ReviewRow label="Bunker (sea)">
              VLSFO {data.vlsfo_sea_mt_day ?? '—'} · LSMGO {data.lsmgo_sea_mt_day ?? '—'}
            </ReviewRow>
            <ReviewRow label="Freight idea">
              {data.freight_idea_usd_mt ? `$${data.freight_idea_usd_mt}/MT` : '—'} · {data.commission_pct}% comm
            </ReviewRow>
            <ReviewRow label="Part cargo">{data.accepts_part_cargo ? 'Accepted' : 'Full only'}</ReviewRow>
            <ReviewRow label="Circulate">{data.for_circulation ? 'Yes — visible to partners' : 'No — Arab ShipBroker only'}</ReviewRow>
            {error && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: '4px', fontSize: '11px', marginTop: '12px' }}>{error}</div>}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
        <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{
          padding: '8px 18px', border: '0.5px solid var(--color-border-tertiary)',
          background: 'transparent', borderRadius: '5px', fontSize: '12px',
          cursor: step === 0 ? 'not-allowed' : 'pointer', opacity: step === 0 ? 0.4 : 1,
          fontFamily: 'Inter, sans-serif', color: '#1B3A5C'
        }}>← Back</button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(s => s + 1)} style={{
            padding: '8px 18px', background: '#185FA5', color: '#fff',
            border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif'
          }}>Next →</button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting} style={{
            padding: '8px 18px', background: '#97C459', color: '#fff',
            border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
            cursor: submitting ? 'wait' : 'pointer', fontFamily: 'Inter, sans-serif'
          }}>{submitting ? 'Submitting...' : 'Submit Position →'}</button>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
  fontSize: '12px', fontFamily: 'Inter, sans-serif', color: '#1B3A5C',
  background: 'var(--color-background-primary)'
}
const checkboxStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#1B3A5C'
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    {label && <div style={{ fontSize: '10px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', marginBottom: '5px' }}>{label}</div>}
    {children}
  </div>
)

const ChipBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    padding: '6px 14px', borderRadius: '14px',
    border: `0.5px solid ${active ? '#185FA5' : 'var(--color-border-tertiary)'}`,
    background: active ? '#E6F1FB' : 'transparent',
    color: active ? '#185FA5' : '#1B3A5C',
    fontSize: '12px', fontWeight: active ? 600 : 400,
    cursor: 'pointer', fontFamily: 'Inter, sans-serif'
  }}>{children}</button>
)

const ReviewRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', padding: '5px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</span>
    <span style={{ color: '#1B3A5C' }}>{children}</span>
  </div>
)

export default PostPositionForm
