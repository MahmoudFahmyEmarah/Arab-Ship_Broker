import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CircularParser from '../components/shared/CircularParser'

const CircularInbox: React.FC = () => {
  const navigate = useNavigate()
  const [extracted, setExtracted] = useState<{ kind: 'cargo' | 'vessel'; data: any } | null>(null)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px', fontFamily: 'Inter, sans-serif', background: 'var(--color-background-secondary)' }}>
      <div style={{ maxWidth: '780px', margin: '0 auto' }}>
        <div style={{ fontSize: '22px', fontWeight: 600, color: '#1B3A5C', marginBottom: '4px' }}>Circular Inbox</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
          Paste any email or WhatsApp circular. AI extracts the structured data — you confirm and submit.
        </div>

        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: '8px', padding: '20px' }}>
          <CircularParser
            onCargoExtracted={(d) => setExtracted({ kind: 'cargo', data: d })}
            onVesselExtracted={(d) => setExtracted({ kind: 'vessel', data: d })}
          />
        </div>

        {extracted && (
          <div style={{
            marginTop: '16px', padding: '14px 18px',
            background: '#E6F1FB', border: '0.5px solid #185FA5', borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#0C447C' }}>
                Ready to submit this {extracted.kind}?
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                Fields will be pre-filled in the {extracted.kind === 'cargo' ? 'Post Cargo' : 'Post Position'} form. You can edit anything before submitting.
              </div>
            </div>
            <button
              onClick={() => {
                // Pass data via sessionStorage so the form can pick it up
                sessionStorage.setItem('prefill_' + extracted.kind, JSON.stringify(extracted.data))
                navigate(extracted.kind === 'cargo' ? '/post-cargo' : '/post-position')
              }}
              style={{
                padding: '8px 16px', background: '#185FA5', color: '#fff',
                border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif'
              }}
            >
              Continue to form →
            </button>
          </div>
        )}

        <div style={{ marginTop: '24px', fontSize: '11px', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: '#1B3A5C', marginBottom: '6px' }}>What the parser understands</div>
          <div>
            Maritime shorthand: MOLOO/MOLOA, FIO/FIOT/FIOST/FIOS, SSHEX/SHEX/SHINC/BENDS/EIU/PWWD, WOG, INOO, DNR, AOH, SF (m³/t),
            DWT vs DWCC, SID/BUG/Box/Non-Box. Zones: B.SEA, E.MED, R.SEA, AG, A.SEA, C.MED, W.MED, ADRIATIC, NCONT, WCAF, F.EAST.
            LOCODE format (EGALY, SAJED, ROCND...). Dates in various formats. Liquefaction warnings for IMSBC Cat A cargoes.
          </div>
        </div>
      </div>
    </div>
  )
}

export default CircularInbox
