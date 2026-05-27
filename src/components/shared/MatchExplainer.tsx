import React from 'react'
import type { MatchResult } from '../../lib/matching'

interface Props {
  result: MatchResult
  compact?: boolean
}

const LABEL_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  Strong:   { bg: '#EAF3DE', color: '#27500A', border: '#97C459' },
  Good:     { bg: '#E6F1FB', color: '#0C447C', border: '#185FA5' },
  Possible: { bg: '#FAEEDA', color: '#854F0B', border: '#EF9F27' },
  Weak:     { bg: '#FCEBEB', color: '#A32D2D', border: '#E24B4A' },
  BLOCKED:  { bg: '#F1EFE8', color: '#5F5E5A', border: 'rgba(0,0,0,0.2)' }
}

const DIMENSION_LABELS = {
  dwcc:   'DWCC fit',
  volume: 'Volume',
  zone:   'Zone',
  timing: 'Timing',
  type:   'Vessel type',
}

const MatchExplainer: React.FC<Props> = ({ result, compact }) => {
  const style = LABEL_STYLE[result.label] ?? LABEL_STYLE.Possible

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: `0.5px solid var(--color-border-tertiary)`,
      borderLeft: `3px solid ${style.border}`,
      borderRadius: '6px',
      padding: compact ? '8px 10px' : '12px 14px',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: compact ? '8px' : '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 600, padding: '3px 8px',
          background: style.bg, color: style.color, borderRadius: '3px',
          letterSpacing: '0.04em'
        }}>{result.label.toUpperCase()}</span>
        {result.label !== 'BLOCKED' && (
          <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            Score: {(result.raw_score * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Hard blockers */}
      {result.blockers.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#A32D2D', marginBottom: '4px' }}>
            ⊘ Hard blocks
          </div>
          {result.blockers.map((b, i) => (
            <div key={i} style={{ fontSize: '11px', color: '#A32D2D', padding: '2px 0' }}>
              · {b}
            </div>
          ))}
        </div>
      )}

      {/* Score breakdown */}
      {result.label !== 'BLOCKED' && !compact && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
            Breakdown
          </div>
          {Object.entries(result.breakdown).map(([key, val]) => (
            <BreakdownBar key={key} label={DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS]} value={val} />
          ))}
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div>
          <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#854F0B', marginBottom: '4px' }}>
            ⚠ Warnings
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '11px', color: '#854F0B', padding: '2px 0' }}>
              · {w}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const BreakdownBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const pct = Math.round(value * 100)
  const color = value >= 0.85 ? '#97C459' : value >= 0.70 ? '#185FA5' : value >= 0.50 ? '#EF9F27' : '#E24B4A'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 32px', gap: '8px', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{label}</span>
      <div style={{ height: '5px', background: '#F5F7FA', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '10px', fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#1B3A5C' }}>{pct}%</span>
    </div>
  )
}

export default MatchExplainer
