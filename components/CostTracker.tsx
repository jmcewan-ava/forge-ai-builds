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
  daily?: Array<{ date: string; cost_usd: number }>
}

interface Props {
  projectId: string
  refreshInterval?: number
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100)
  const barColor = pct > 90 ? '#EF4444' : pct > 70 ? '#F59E0B' : color
  return (
    <div style={{ position: 'relative' as const }}>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.5s ease', boxShadow: pct > 70 ? `0 0 6px ${barColor}` : 'none' }} />
      </div>
    </div>
  )
}

function DailyChart({ daily }: { daily: Array<{ date: string; cost_usd: number }> }) {
  if (!daily || daily.length === 0) return null
  const max = Math.max(...daily.map(d => d.cost_usd), 0.01)
  const last14 = daily.slice(-14)
  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 8, letterSpacing: '0.08em' }}>DAILY SPEND (14 DAYS)</p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
        {last14.map((d, i) => {
          const heightPct = (d.cost_usd / max) * 100
          const isToday = i === last14.length - 1
          return (
            <div key={d.date} title={`${d.date}: $${d.cost_usd.toFixed(4)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ height: `${Math.max(heightPct, 4)}%`, background: isToday ? '#6366F1' : 'rgba(99,102,241,0.3)', borderRadius: '2px 2px 0 0', minHeight: 2, transition: 'height 0.3s ease' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 9, color: '#374151', fontFamily: 'var(--font-mono)' }}>{last14[0]?.date?.slice(5)}</span>
        <span style={{ fontSize: 9, color: '#475569', fontFamily: 'var(--font-mono)' }}>today</span>
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
        if (res.ok) setStats(await res.json())
      } catch {}
      finally { setLoading(false) }
    }
    fetchStats()
    const interval = setInterval(fetchStats, refreshInterval)
    return () => clearInterval(interval)
  }, [projectId, refreshInterval])

  if (loading || !stats) {
    return (
      <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>Loading cost data...</div>
      </div>
    )
  }

  const isOverLimit = !stats.within_limits
  const sessionPct = (stats.session_total_usd / stats.session_limit_usd) * 100
  const projectPct = (stats.project_total_usd / stats.project_limit_usd) * 100

  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: isOverLimit ? 'rgba(239,68,68,0.05)' : 'var(--surface)', border: `1px solid ${isOverLimit ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, transition: 'all 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#64748B', letterSpacing: '0.08em' }}>API COST</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isOverLimit && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(239,68,68,0.2)', color: '#EF4444', fontWeight: 800 }}>LIMIT HIT</span>}
          <span style={{ fontSize: 11, color: '#6366F1', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatUsd(stats.session_total_usd)}</span>
          <span style={{ fontSize: 10, color: '#4B5563' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: sessionPct > 90 ? '#EF4444' : sessionPct > 70 ? '#F59E0B' : '#64748B' }}>Session</span>
          <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>{formatUsd(stats.session_total_usd)} / {formatUsd(stats.session_limit_usd)}</span>
        </div>
        <MiniBar value={stats.session_total_usd} max={stats.session_limit_usd} color="#6366F1" />
      </div>

      <div style={{ marginBottom: expanded ? 12 : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: projectPct > 90 ? '#EF4444' : projectPct > 70 ? '#F59E0B' : '#64748B' }}>Project total</span>
          <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>{formatUsd(stats.project_total_usd)} / {formatUsd(stats.project_limit_usd)}</span>
        </div>
        <MiniBar value={stats.project_total_usd} max={stats.project_limit_usd} color="#A78BFA" />
      </div>

      {expanded && (
        <div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' }} />
          {stats.daily && stats.daily.length > 0 && <DailyChart daily={stats.daily} />}
          {stats.breakdown && Object.keys(stats.breakdown).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6, letterSpacing: '0.08em' }}>BY AGENT</p>
              {Object.entries(stats.breakdown).map(([key, data]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <div>
                    <span style={{ fontSize: 11, color: '#64748B' }}>{key}</span>
                    <span style={{ fontSize: 10, color: '#374151', fontFamily: 'var(--font-mono)', marginLeft: 6 }}>{data.calls}× · {((data.input_tokens + data.output_tokens) / 1000).toFixed(0)}k tok</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#A78BFA', fontFamily: 'var(--font-mono)' }}>{formatUsd(data.cost_usd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isOverLimit && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p style={{ fontSize: 11, color: '#EF4444', margin: 0 }}>Build paused — cost limit hit.</p>
        </div>
      )}
      {!isOverLimit && (sessionPct > 70 || projectPct > 70) && (
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <p style={{ fontSize: 11, color: '#F59E0B', margin: 0 }}>{sessionPct > 90 || projectPct > 90 ? '⚠ Approaching limit' : 'Nearing limit'}</p>
        </div>
      )}
    </div>
  )
}
