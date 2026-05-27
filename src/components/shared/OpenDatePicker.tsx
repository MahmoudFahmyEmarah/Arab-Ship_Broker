import React, { useState, useRef, useEffect } from 'react'

interface Props {
  openDate?: string
  flexDays?: number
  isSpot?: boolean
  onChange: (openDate: string | null, flexDays: number | null, isSpot: boolean) => void
  placeholder?: string
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su']

const formatDisplay = (d?: string, flex?: number, isSpot?: boolean): string => {
  if (isSpot) return 'SPOT'
  if (!d) return '—'
  const date = new Date(d)
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
  return flex ? `${base} ± ${flex}d` : base
}

const OpenDatePicker: React.FC<Props> = ({ openDate, flexDays, isSpot, onChange, placeholder = 'Open date' }) => {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'date' | 'spot'>(isSpot ? 'spot' : 'date')
  const [tempDate, setTempDate] = useState<Date | null>(openDate ? new Date(openDate) : null)
  const [tempFlex, setTempFlex] = useState<number>(flexDays ?? 0)
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleApply = () => {
    if (mode === 'spot') {
      onChange(null, null, true)
    } else {
      onChange(
        tempDate ? tempDate.toISOString().split('T')[0] : null,
        tempFlex > 0 ? tempFlex : null,
        false
      )
    }
    setOpen(false)
  }

  const handleDayClick = (day: number) => {
    setTempDate(new Date(viewYear, viewMonth, day))
  }

  const renderCal = () => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay()
    const offset = firstDay === 0 ? 6 : firstDay - 1
    const days = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: React.ReactNode[] = []
    for (let i = 0; i < offset; i++) cells.push(<div key={`e-${i}`} />)
    for (let d = 1; d <= days; d++) {
      const selected = tempDate && tempDate.toDateString() === new Date(viewYear, viewMonth, d).toDateString()
      cells.push(
        <button key={d} onClick={() => handleDayClick(d)} style={{
          width: '28px', height: '24px', border: 'none', borderRadius: '3px',
          background: selected ? '#185FA5' : 'transparent',
          color: selected ? '#fff' : '#1B3A5C',
          cursor: 'pointer', fontSize: '11px', fontWeight: selected ? 600 : 400,
          fontFamily: 'Inter, sans-serif'
        }}
        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#F5F7FA' }}
        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >{d}</button>
      )
    }
    return cells
  }

  return (
    <div ref={ref} style={{ position: 'relative', fontFamily: 'Inter, sans-serif' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '6px 10px', width: '100%',
          border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
          background: 'var(--color-background-primary)',
          fontSize: '12px', textAlign: 'left', cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          color: (openDate || isSpot) ? '#1B3A5C' : 'var(--color-text-secondary)'
        }}
      >
        {formatDisplay(openDate, flexDays, isSpot) !== '—' ? formatDisplay(openDate, flexDays, isSpot) : placeholder}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          width: '280px', background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          zIndex: 50, overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', gap: '8px', padding: '10px 12px 8px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            <ModeBtn active={mode === 'date'} onClick={() => setMode('date')}>○ Specific date</ModeBtn>
            <ModeBtn active={mode === 'spot'} onClick={() => setMode('spot')}>● SPOT</ModeBtn>
          </div>

          {mode === 'date' ? (
            <>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <button onClick={() => { setViewMonth(m => m === 0 ? 11 : m - 1); if (viewMonth === 0) setViewYear(y => y - 1) }} style={navBtn}>‹</button>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#1B3A5C' }}>{MONTHS[viewMonth]} {viewYear}</span>
                  <button onClick={() => { setViewMonth(m => m === 11 ? 0 : m + 1); if (viewMonth === 11) setViewYear(y => y + 1) }} style={navBtn}>›</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
                  {DAYS.map(d => <div key={d} style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'center', textTransform: 'uppercase' }}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>{renderCal()}</div>
              </div>
              <div style={{ padding: '0 12px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)' }}>Flex window</span>
                <input
                  type="number" min={0} max={14} value={tempFlex}
                  onChange={e => setTempFlex(parseInt(e.target.value) || 0)}
                  style={{ width: '54px', padding: '4px 6px', fontSize: '11px', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '3px', fontFamily: 'Inter, sans-serif' }}
                />
                <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>± days</span>
              </div>
            </>
          ) : (
            <div style={{ padding: '20px 12px', fontSize: '12px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              Vessel is available immediately (SPOT)
            </div>
          )}

          <button onClick={handleApply} disabled={mode === 'date' && !tempDate} style={{
            width: 'calc(100% - 24px)', margin: '0 12px 12px',
            padding: '8px 0', background: '#185FA5', color: '#fff',
            border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            opacity: (mode === 'date' && !tempDate) ? 0.5 : 1
          }}>Apply</button>
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#1B3A5C', padding: '0 6px', fontFamily: 'Inter, sans-serif' }
const ModeBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', fontWeight: active ? 600 : 500,
    color: active ? '#185FA5' : 'var(--color-text-secondary)',
    cursor: 'pointer', padding: '4px 10px', borderRadius: '4px',
    border: `0.5px solid ${active ? '#185FA5' : 'var(--color-border-tertiary)'}`,
    background: active ? '#E6F1FB' : 'transparent',
    fontFamily: 'Inter, sans-serif'
  }}>{children}</button>
)

export default OpenDatePicker
