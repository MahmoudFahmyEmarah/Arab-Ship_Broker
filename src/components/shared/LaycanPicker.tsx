import React, { useState, useRef, useEffect } from 'react'

interface Props {
  fromDate?: string
  toDate?: string
  isSpot?: boolean
  onChange: (from: string | null, to: string | null, isSpot: boolean) => void
  placeholder?: string
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su']

const formatDisplay = (from?: string, to?: string, isSpot?: boolean): string => {
  if (isSpot) return 'SPOT'
  if (!from) return '—'
  const f = new Date(from)
  const t = to ? new Date(to) : null
  if (!t || f.getMonth() === t.getMonth()) {
    return `${f.getDate()} / ${t ? t.getDate() : f.getDate()} ${MONTHS[f.getMonth()]}`
  }
  return `${f.getDate()} ${MONTHS[f.getMonth()]} / ${t.getDate()} ${MONTHS[t.getMonth()]}`
}

const LaycanPicker: React.FC<Props> = ({ fromDate, toDate, isSpot, onChange, placeholder = 'Laycan' }) => {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'range' | 'spot'>(isSpot ? 'spot' : 'range')
  const [tempFrom, setTempFrom] = useState<Date | null>(fromDate ? new Date(fromDate) : null)
  const [tempTo, setTempTo] = useState<Date | null>(toDate ? new Date(toDate) : null)
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleApply = () => {
    if (mode === 'spot') {
      onChange(null, null, true)
    } else {
      let from = tempFrom, to = tempTo
      if (from && to && from > to) { [from, to] = [to, from] }
      onChange(
        from ? from.toISOString().split('T')[0] : null,
        to ? to.toISOString().split('T')[0] : null,
        false
      )
    }
    setOpen(false)
  }

  const handleDayClick = (day: number) => {
    const clicked = new Date(viewYear, viewMonth, day)
    if (!tempFrom || (tempFrom && tempTo)) {
      setTempFrom(clicked); setTempTo(null)
    } else {
      setTempTo(clicked)
    }
  }

  const isDayInRange = (day: number): 'from' | 'to' | 'between' | null => {
    if (!tempFrom) return null
    const d = new Date(viewYear, viewMonth, day)
    if (tempFrom.toDateString() === d.toDateString()) return 'from'
    if (tempTo && tempTo.toDateString() === d.toDateString()) return 'to'
    if (tempTo && d > tempFrom && d < tempTo) return 'between'
    return null
  }

  const renderCalendar = () => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay()
    const offset = firstDay === 0 ? 6 : firstDay - 1
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: React.ReactNode[] = []

    for (let i = 0; i < offset; i++) cells.push(<div key={`e-${i}`} />)
    for (let d = 1; d <= daysInMonth; d++) {
      const state = isDayInRange(d)
      cells.push(
        <button
          key={d}
          onClick={() => handleDayClick(d)}
          style={{
            width: '28px', height: '24px', border: 'none', borderRadius: '3px',
            background: state === 'from' || state === 'to' ? '#185FA5'
                       : state === 'between' ? '#EBF4FD' : 'transparent',
            color: state === 'from' || state === 'to' ? '#fff' : '#1B3A5C',
            cursor: 'pointer', fontSize: '11px', fontWeight: state ? 600 : 400,
            fontFamily: 'Inter, sans-serif',
            transition: 'background 0.1s'
          }}
          onMouseEnter={e => { if (!state) (e.currentTarget as HTMLButtonElement).style.background = '#F5F7FA' }}
          onMouseLeave={e => { if (!state) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >{d}</button>
      )
    }
    return cells
  }

  const windowDays = tempFrom && tempTo ? Math.ceil((tempTo.getTime() - tempFrom.getTime()) / 86400000) + 1 : 0
  const tooLong = windowDays > 30

  return (
    <div ref={pickerRef} style={{ position: 'relative', fontFamily: 'Inter, sans-serif' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '6px 10px', width: '100%',
          border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px',
          background: 'var(--color-background-primary)',
          fontSize: '12px', textAlign: 'left', cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          color: (fromDate || isSpot) ? '#1B3A5C' : 'var(--color-text-secondary)',
        }}
      >
        {formatDisplay(fromDate, toDate, isSpot) !== '—' ? formatDisplay(fromDate, toDate, isSpot) : placeholder}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          width: '300px', background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          zIndex: 50, overflow: 'hidden'
        }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: '8px', padding: '10px 12px 8px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            <ModeBtn active={mode === 'range'} onClick={() => setMode('range')}>○ Date range</ModeBtn>
            <ModeBtn active={mode === 'spot'} onClick={() => setMode('spot')}>● SPOT</ModeBtn>
          </div>

          {mode === 'range' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', padding: '10px 12px 8px' }}>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>From</div>
                  <div style={{ padding: '6px 10px', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px', fontSize: '12px', fontWeight: 500, background: tempFrom ? '#E6F1FB' : 'transparent' }}>
                    {tempFrom ? `${tempFrom.getDate()} ${MONTHS[tempFrom.getMonth()]}` : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>To</div>
                  <div style={{ padding: '6px 10px', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '4px', fontSize: '12px', fontWeight: 500, background: tempTo ? '#E6F1FB' : 'transparent' }}>
                    {tempTo ? `${tempTo.getDate()} ${MONTHS[tempTo.getMonth()]}` : '—'}
                  </div>
                </div>
              </div>

              <div style={{ padding: '4px 12px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <button onClick={() => { setViewMonth(m => m === 0 ? 11 : m - 1); if (viewMonth === 0) setViewYear(y => y - 1) }} style={navBtnStyle}>‹</button>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#1B3A5C' }}>{MONTHS[viewMonth]} {viewYear}</span>
                  <button onClick={() => { setViewMonth(m => m === 11 ? 0 : m + 1); if (viewMonth === 11) setViewYear(y => y + 1) }} style={navBtnStyle}>›</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
                  {DAYS.map(d => <div key={d} style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'center', textTransform: 'uppercase' }}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                  {renderCalendar()}
                </div>
                {tooLong && (
                  <div style={{ marginTop: '6px', fontSize: '10px', color: '#854F0B', textAlign: 'center' }}>
                    ⚠ Laycan window exceeds 30 days — please confirm
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: '20px 12px', fontSize: '12px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              This cargo is available immediately (SPOT)
            </div>
          )}

          <button
            onClick={handleApply}
            disabled={mode === 'range' && (!tempFrom || !tempTo)}
            style={{
              width: 'calc(100% - 24px)', margin: '0 12px 12px',
              padding: '8px 0', background: '#185FA5', color: '#fff',
              border: 'none', borderRadius: '5px',
              fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              opacity: (mode === 'range' && (!tempFrom || !tempTo)) ? 0.5 : 1
            }}
          >Apply</button>
        </div>
      )}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px',
  color: '#1B3A5C', padding: '0 6px', fontFamily: 'Inter, sans-serif'
}

const ModeBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: active ? 600 : 500,
      color: active ? '#185FA5' : 'var(--color-text-secondary)',
      cursor: 'pointer',
      padding: '4px 10px', borderRadius: '4px',
      border: `0.5px solid ${active ? '#185FA5' : 'var(--color-border-tertiary)'}`,
      background: active ? '#E6F1FB' : 'transparent',
      fontFamily: 'Inter, sans-serif'
    }}
  >{children}</button>
)

export default LaycanPicker
