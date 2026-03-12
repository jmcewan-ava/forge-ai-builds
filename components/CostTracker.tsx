'use client'

import { useState, useEffect } from 'react'

interface CostStats {
  session_total_usd: number
  project_total_usd: number
  session_limit_usd: number
  project_limit_usd: number
  session_remaining_usd: number
  project_remaining_usd: number
  within_limits: boolean
  breakdown?: Record<string, {
    calls: number
    input_tokens: number
    output_tokens: number
    cost_usd: number
  }>
}

interface Props {
  projectId: string
  refreshInterval?: number
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100)
  const isWarning = pct > 80
  const barColor = isWarning ? '#EF4444' : color

  return (
    <div style={{ position: 'relative' as const }}>
      <div style={{
        height: 4, background: 'rgba(255,255,255,0.06)',
        borderRadius: 2, overflow: 'hidden'
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: barColor, borderRadius: 2,
          transition: 'width 0.5s ease',
          boxShadow: isWarning ? `0 0 6px ${barColor}` : 'none'
        }} />
      </div>
    </div>
  )
}

function formatUsd(amount: number): string {
  if (amount < 0.01) return '<$0.01'
  return `$${(amount ?? 0).toFixed(2)}`
}

export function CostTracker({ projectId, refreshInterval = 5000 }: Props) {
  const [stats, setStats] = useState<CostStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/cost?project_id=${projectId}`)
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch {
        // silent fail — cost tracker is non-critical
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, refreshInterval)
    return () => clearInterval(interval)
  }, [projectId, refreshInterval])

  if (loading || !stats) {
    return (
      <div style={{
        padding: '12px 14px', borderRadius: 10,
        background: 'var(--surface)', border: '1px solid var(--border)'
      }}>
        <div style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
          Loading cost data...
        </div>
      </div>
    )
  }

  const isOverLimit = !stats.within_limits
  const sessionPct = (stats.session_total_usd / stats.session_limit_usd) * 100
  const projectPct = (stats.project_total_usd / stats.project_limit_usd) * 100

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 10,
      background: isOverLimit ? 'rgba(239,68,68,0.05)' : 'var(--surface)',
      border: `1px solid ${isOverLimit ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
      transition: 'all 0.3s ease'
    }}>
      {/* Header */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: '#64748B', letterSpacing: '0.08em' }}>
          API COST
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isOverLimit && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(239,68,68,0.2)', color: '#EF4444',
              fontWeight: 800, letterSpacing: '0.06em'
            }}>LIMIT HIT</span>
          )}
          <span style={{ fontSize: 11, color: '#6366F1', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {formatUsd(stats.session_total_usd)}
          </span>
          <span style={{ fontSize: 10, color: '#4B5563' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Session bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#64748B' }}>Session</span>
          <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
            {formatUsd(stats.session_total_usd)} / {formatUsd(stats.session_limit_usd)}
          </span>
        </div>
        <MiniBar value={stats.session_total_usd} max={stats.session_limit_usd} color="#6366F1" />
      </div>

      {/* Project bar */}
      <div style={{ marginBottom: expanded ? 12 : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#64748B' }}>Project total</span>
          <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
            {formatUsd(stats.project_total_usd)} / {formatUsd(stats.project_limit_usd)}
          </span>
        </div>
        <MiniBar value={stats.project_total_usd} max={stats.project_limit_usd} color="#A78BFA" />
      </div>

      {/* Expanded breakdown */}
      {expanded && stats.breakdown && (
        <div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' }} />
          <p style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6, letterSpacing: '0.08em' }}>
            BREAKDOWN
          </p>
          {Object.entries(stats.breakdown).map(([key, data]) => (
            <div key={key} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)'
            }}>
              <span style={{ fontSize: 11, color: '#64748B' }}>{key}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                  {data.calls}×
                </span>
                <span style={{ fontSize: 11, color: '#A78BFA', fontFamily: 'var(--font-mono)' }}>
                  {formatUsd(data.cost_usd)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Over limit warning */}
      {isOverLimit && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)'
        }}>
          <p style={{ fontSize: 11, color: '#EF4444', margin: 0 }}>
            Build paused. Answer the open question in the Questions tab to continue.
          </p>
        </div>
      )}

      {/* Warning approaching limit */}
      {!isOverLimit && (sessionPct > 70 || projectPct > 70) && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)'
        }}>
          <p style={{ fontSize: 11, color: '#F59E0B', margin: 0 }}>
            Approaching {sessionPct > projectPct ? 'session' : 'project'} limit
          </p>
        </div>
      )}
    </div>
  )
}
