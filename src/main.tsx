import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif',
          background: '#F5F7FA', padding: '24px'
        }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#1B3A5C', marginBottom: '8px' }}>
            Arab ShipBroker — startup error
          </div>
          <div style={{
            background: '#FCEBEB', color: '#A32D2D', padding: '12px 16px',
            borderRadius: '6px', fontSize: '12px', maxWidth: '600px',
            fontFamily: 'monospace', whiteSpace: 'pre-wrap'
          }}>
            {this.state.error.message}
          </div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '12px' }}>
            Check Vercel environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px', padding: '8px 16px', background: '#185FA5',
              color: '#fff', border: 'none', borderRadius: '4px',
              fontSize: '12px', cursor: 'pointer'
            }}
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
