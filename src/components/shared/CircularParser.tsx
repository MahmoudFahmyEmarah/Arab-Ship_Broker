import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'

interface ParseResult {
  kind: 'cargo' | 'vessel' | 'unknown'
  confidence: number
  extracted: Record<string, any>
  warnings: string[]
  raw_intent: string
}

interface Props {
  onCargoExtracted?: (data: any) => void
  onVesselExtracted?: (data: any) => void
}

const CircularParser: React.FC<Props> = ({ onCargoExtracted, onVesselExtracted }) => {
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [error, setError] = useState('')

  const handleParse = async () => {
    if (!text.trim()) return
    setParsing(true)
    setError('')
    setResult(null)

    try {
      const { data, error: fnError } = await supabase.functions.invoke('parse-circular', {
        body: { text }
      })
      if (fnError) {
        setError(fnError.message)
      } else if (data.error) {
        setError(data.error + (data.details ? ` — ${data.details}` : ''))
      } else {
        setResult(data as ParseResult)
      }
    } catch (e: any) {
      setError(e.message ?? 'Parser request failed')
    } finally {
      setParsing(false)
    }
  }

  const handleUseExtracted = () => {
    if (!result) return
    if (result.kind === 'cargo' && onCargoExtracted) onCargoExtracted(result.extracted)
    if (result.kind === 'vessel' && onVesselExtracted) onVesselExtracted(result.extracted)
  }

  const confidenceColor = (c: number) =>
    c >= 0.85 ? '#27500A' : c >= 0.6 ? '#854F0B' : '#A32D2D'
  const confidenceBg = (c: number) =>
    c >= 0.85 ? '#EAF3DE' : c >= 0.6 ? '#FAEEDA' : '#FCEBEB'

  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
          Paste circular text
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder="Paste any email or WhatsApp circular here. Examples:&#10;&#10;CARGO:&#10;3000 mt Wheat. POL Alexandria EGALY. POD Jeddah SAJED. L/C 1-5 Jun. FIOST SSHEX. Frt $45/mt. 2.5% comm. SF 1.30. WOG.&#10;&#10;VESSEL:&#10;MV ATLAS STAR. 8200 DWT / 7500 DWCC. Built 2008 Panama flag. Gearless. Open Aegean SPOT. 23.5 MT VLSFO sea. Nia DNR."
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: '5px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#1B3A5C',
            background: 'var(--color-background-primary)',
            resize: 'vertical',
            minHeight: '120px',
            lineHeight: 1.5,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={handleParse}
          disabled={parsing || !text.trim()}
          style={{
            padding: '8px 18px',
            background: '#185FA5', color: '#fff',
            border: 'none', borderRadius: '5px',
            fontSize: '12px', fontWeight: 600,
            cursor: parsing ? 'wait' : 'pointer',
            opacity: !text.trim() ? 0.5 : 1,
            fontFamily: 'Inter, sans-serif'
          }}
        >
          {parsing ? '⟳ Parsing...' : 'Parse with AI'}
        </button>
        {text && !parsing && (
          <button
            onClick={() => { setText(''); setResult(null); setError('') }}
            style={{
              padding: '8px 14px', background: 'transparent', color: '#1B3A5C',
              border: '0.5px solid var(--color-border-tertiary)', borderRadius: '5px',
              fontSize: '12px', cursor: 'pointer', fontFamily: 'Inter, sans-serif'
            }}
          >Clear</button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          Powered by Anthropic Claude
        </span>
      </div>

      {error && (
        <div style={{ marginTop: '12px', background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: '4px', fontSize: '11px' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '16px', background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{
            padding: '10px 14px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            background: 'var(--color-background-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{
                fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '3px',
                background: result.kind === 'cargo' ? '#E6F1FB' : result.kind === 'vessel' ? '#EAF3DE' : '#F1EFE8',
                color: result.kind === 'cargo' ? '#0C447C' : result.kind === 'vessel' ? '#27500A' : '#5F5E5A',
                letterSpacing: '0.05em'
              }}>
                {result.kind.toUpperCase()}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '3px',
                background: confidenceBg(result.confidence), color: confidenceColor(result.confidence)
              }}>
                Confidence {(result.confidence * 100).toFixed(0)}%
              </span>
              {result.raw_intent && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                  {result.raw_intent}
                </span>
              )}
            </div>
            {result.kind !== 'unknown' && (onCargoExtracted || onVesselExtracted) && (
              <button
                onClick={handleUseExtracted}
                style={{
                  padding: '5px 12px', background: '#185FA5', color: '#fff',
                  border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                }}
              >
                Pre-fill form →
              </button>
            )}
          </div>

          {result.warnings.length > 0 && (
            <div style={{ padding: '8px 14px', background: '#FAEEDA', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#854F0B', marginBottom: '4px' }}>
                ⚠ Warnings
              </div>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '11px', color: '#854F0B', padding: '1px 0' }}>· {w}</div>
              ))}
            </div>
          )}

          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
              Extracted fields
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 12px', fontSize: '11px' }}>
              {Object.entries(result.extracted).map(([k, v]) => (
                <React.Fragment key={k}>
                  <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{k}</span>
                  <span style={{ color: '#1B3A5C', fontWeight: 500 }}>
                    {v === null || v === undefined ? '—' :
                     typeof v === 'boolean' ? (v ? '✓ true' : '✗ false') :
                     Array.isArray(v) ? v.join(', ') :
                     String(v)}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CircularParser
