import React, { useState } from 'react'
import LaycanPicker from '../shared/LaycanPicker'
import { supabase } from '../../lib/supabase'
import type { CargoType, LoadTerms } from '../../types'

interface FormData {
  cargo_type: CargoType
  commodity_name: string
  qty_min_mt: number
  qty_max_mt: number
  load_port_locode: string
  disch_port_locode: string
  laycan_from: string | null
  laycan_to: string | null
  is_spot: boolean
  load_rate: string
  disch_rate: string
  load_terms: LoadTerms | ''
  laytime_qualifier: string
  freight_idea_usd_mt: number | null
  commission_pct: number
  is_wog: boolean
  for_circulation: boolean
  notes: string
}

const STEPS = ['Cargo', 'Ports & Quantity', 'Laycan & Terms', 'Safety', 'Review']

const PostCargoForm: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<FormData>({
    cargo_type: 'Dry Bulk',
    commodity_name: '',
    qty_min_mt: 0, qty_max_mt: 0,
    load_port_locode: '', disch_port_locode: '',
    laycan_from: null, laycan_to: null, is_spot: false,
    load_rate: '', disch_rate: '',
    load_terms: '', laytime_qualifier: '',
    freight_idea_usd_mt: null, commission_pct: 2.5,
    is_wog: false, for_circulation: true,
    notes: ''
  })

  const update = <K extends keyof FormData>(k: K, v: FormData[K]) => setData(d => ({ ...d, [k]: v }))

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    const { error: e } = await supabase.from('cargo_listings').insert({
      ...data,
      review_status: 'PENDING',
      status: 'IN'
    })
    if (e) {
      setError(e.message)
      setSubmitting(false)
    } else {
      onComplete?.()
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '720px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ fontSize: '20px', fontWeight: 600, color: '#1B3A5C', marginBottom: '4px' }}>Post Cargo</div>
      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: '3px', borderRadius: '2px',
            background: i <= step ? '#185FA5' : 'var(--color-border-tertiary)'
          }} />
        ))}
      </div>

      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', padding: '20px' }}>
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="Cargo type">
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['Dry Bulk', 'Break Bulk'] as CargoType[]).map(t => (
                  <ChipBtn key={t} active={data.cargo_type === t} onClick={() => update('cargo_type', t)}>{t}</ChipBtn>
                ))}
              </div>
            </Field>
            <Field label="Commodity">
              <input value={data.commodity_name} onChange={e => update('commodity_name', e.target.value)} placeholder="e.g. Wheat" style={inputStyle} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Load port (LOCODE)">
                <input value={data.load_port_locode} onChange={e => update('load_port_locode', e.target.value.toUpperCase())} placeholder="EGALY" maxLength={5} style={inputStyle} />
              </Field>
              <Field label="Discharge port (LOCODE)">
                <input value={data.disch_port_locode} onChange={e => update('disch_port_locode', e.target.value.toUpperCase())} placeholder="SAJED" maxLength={5} style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Quantity min (MT)">
                <input type="number" value={data.qty_min_mt || ''} onChange={e => update('qty_min_mt', parseInt(e.target.value) || 0)} style={inputStyle} />
              </Field>
              <Field label="Quantity max (MT)">
                <input type="number" value={data.qty_max_mt || ''} onChange={e => update('qty_max_mt', parseInt(e.target.value) || 0)} style={inputStyle} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="Laycan">
              <LaycanPicker
                fromDate={data.laycan_from || undefined}
                toDate={data.laycan_to || undefined}
                isSpot={data.is_spot}
                onChange={(from, to, isSpot) => {
                  update('laycan_from', from); update('laycan_to', to); update('is_spot', isSpot)
                }}
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Load rate"><input value={data.load_rate} onChange={e => update('load_rate', e.target.value)} placeholder="3,000 MT/day" style={inputStyle} /></Field>
              <Field label="Discharge rate"><input value={data.disch_rate} onChange={e => update('disch_rate', e.target.value)} placeholder="2,500 MT/day" style={inputStyle} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Load terms">
                <select value={data.load_terms} onChange={e => update('load_terms', e.target.value as LoadTerms)} style={inputStyle}>
                  <option value="">—</option>
                  <option value="FIO">FIO</option>
                  <option value="FIOT">FIOT</option>
                  <option value="FIOST">FIOST</option>
                  <option value="FIOS">FIOS</option>
                  <option value="Liner Terms">Liner Terms</option>
                </select>
              </Field>
              <Field label="Laytime qualifier">
                <input value={data.laytime_qualifier} onChange={e => update('laytime_qualifier', e.target.value.toUpperCase())} placeholder="SHINC, SSHEX, BENDS" style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <Field label="Freight idea ($/MT)">
                <input type="number" value={data.freight_idea_usd_mt || ''} onChange={e => update('freight_idea_usd_mt', parseFloat(e.target.value) || null)} style={inputStyle} />
              </Field>
              <Field label="Commission (%)">
                <input type="number" step="0.25" value={data.commission_pct} onChange={e => update('commission_pct', parseFloat(e.target.value) || 0)} style={inputStyle} />
              </Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                <input type="checkbox" checked={data.is_wog} onChange={e => update('is_wog', e.target.checked)} />
                <span>This cargo is offered WOG (Without Guarantee)</span>
              </label>
            </Field>
            <Field label="">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                <input type="checkbox" checked={data.for_circulation} onChange={e => update('for_circulation', e.target.checked)} />
                <span>Circulate this cargo to vetted market partners</span>
              </label>
            </Field>
            <Field label="Notes (any extra details, restrictions, terms)">
              <textarea value={data.notes} onChange={e => update('notes', e.target.value)} rows={4}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '80px', fontFamily: 'Inter, sans-serif' }}
                placeholder="SF, vessel restrictions, fumigation, etc." />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div style={{ fontSize: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B3A5C', marginBottom: '12px' }}>Review & Submit</div>
            <ReviewRow label="Type">{data.cargo_type} · {data.commodity_name}</ReviewRow>
            <ReviewRow label="Quantity">{data.qty_min_mt.toLocaleString()}–{data.qty_max_mt.toLocaleString()} MT</ReviewRow>
            <ReviewRow label="Route">{data.load_port_locode} → {data.disch_port_locode}</ReviewRow>
            <ReviewRow label="Laycan">{data.is_spot ? 'SPOT' : `${data.laycan_from} / ${data.laycan_to}`}</ReviewRow>
            <ReviewRow label="L/D rate">{data.load_rate || '—'} / {data.disch_rate || '—'}</ReviewRow>
            <ReviewRow label="Terms">{data.load_terms || '—'} {data.laytime_qualifier}</ReviewRow>
            <ReviewRow label="Freight idea">{data.freight_idea_usd_mt ? `$${data.freight_idea_usd_mt}/MT` : '—'} · {data.commission_pct}% comm</ReviewRow>
            <ReviewRow label="WOG">{data.is_wog ? 'Yes' : 'No'}</ReviewRow>
            <ReviewRow label="Circulate">{data.for_circulation ? 'Yes — visible to vetted partners' : 'No — Arab ShipBroker only'}</ReviewRow>
            {error && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: '4px', fontSize: '11px', marginTop: '12px' }}>{error}</div>}
          </div>
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          style={{
            padding: '8px 18px', border: '0.5px solid var(--color-border-tertiary)',
            background: 'transparent', borderRadius: '5px', fontSize: '12px',
            cursor: step === 0 ? 'not-allowed' : 'pointer', opacity: step === 0 ? 0.4 : 1,
            fontFamily: 'Inter, sans-serif', color: '#1B3A5C'
          }}>
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            style={{
              padding: '8px 18px', background: '#185FA5', color: '#fff',
              border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif'
            }}>
            Next →
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '8px 18px', background: '#97C459', color: '#fff',
              border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer', fontFamily: 'Inter, sans-serif'
            }}>
            {submitting ? 'Submitting...' : 'Submit Cargo →'}
          </button>
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
  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', padding: '5px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</span>
    <span style={{ color: '#1B3A5C' }}>{children}</span>
  </div>
)

export default PostCargoForm
