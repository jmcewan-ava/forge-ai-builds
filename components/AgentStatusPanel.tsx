'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { Agent } from '@/lib/types'

interface Props {
  agents: Agent[]
  projectId: string
}

const ROLE_LABELS: Record<string, string> = {
  office_manager: 'Office Manager',
  builder: 'Builder',
  qa_manager: 'QA Manager',
  interview: 'Interview',
  file_writer: 'File Writer'
}

const ROLE_ICONS: Record<string, string> = {
  office_manager: '🧠',
  builder: '⚡',
  qa_manager: '🔍',
  interview: '💬',
  file_writer: '📁'
}

const MODEL_SHORT: Record<string, string> = {
  'claude-opus-4-6': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5': 'Haiku'
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: '#4B5563',
    running: '#F59E0B',
    complete: '#10B981',
    error: '#EF4444'
  }
  const color = colors[status] || colors.idle
  const pulse = status === 'running'

  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: pulse ? `0 0 6px ${color}` : 'none',
      animation: pulse ? 'pulse 1.5s ease infinite' : 'none'
    }} />
  )
}

function formatDuration(startedAt: string | undefined): string {
  if (!startedAt) return ''
  const ms = Date.now() - new Date(startedAt).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function AgentRow({ agent }: { agent: Agent }) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (agent.status !== 'running') {
      setElapsed('')
      return
    }
    const interval = setInterval(() => {
      setElapsed(formatDuration(agent.started_at))
    }, 1000)
    setElapsed(formatDuration(agent.started_at))
    return () => clearInterval(interval)
  }, [agent.status, agent.started_at])

  const isRunning = agent.status === 'running'
  const tokenCost = agent.token_usage
    ? `${((agent.token_usage.input + agent.token_usage.output) / 1000).toFixed(1)}k tokens`
    : null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 8,
      background: isRunning ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isRunning ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'}`,
      transition: 'all 0.3s ease'
    }}>
      <StatusDot status={agent.status} />

      <span style={{ fontSize: 16 }}>{ROLE_ICONS[agent.role] || '🤖'}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: isRunning ? '#F59E0B' : '#94A3B8' }}>
            {ROLE_LABELS[agent.role] || agent.role}
          </span>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: 'rgba(99,102,241,0.15)', color: '#A78BFA',
            fontFamily: 'var(--font-mono)'
          }}>
            {MODEL_SHORT[agent.model] || agent.model}
          </span>
        </div>

        {isRunning && agent.current_workstream && (
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            Working on workstream...
          </div>
        )}

        {agent.status === 'error' && agent.error_message && (
          <div style={{ fontSize: 11, color: '#EF4444', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {agent.error_message.slice(0, 60)}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
        {isRunning && elapsed && (
          <div style={{ fontSize: 11, color: '#F59E0B', fontFamily: 'var(--font-mono)' }}>
            {elapsed}
          </div>
        )}
        {tokenCost && !isRunning && (
          <div style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
            {tokenCost}
          </div>
        )}
        {agent.status === 'idle' && (
          <div style={{ fontSize: 11, color: '#475569' }}>idle</div>
        )}
      </div>
    </div>
  )
}

export function AgentStatusPanel({ agents: initialAgents, projectId }: Props) {
  const [agents, setAgents] = useState(initialAgents)
  const [connected, setConnected] = useState(false)

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const channel = supabase
      .channel('agents_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'agents',
        filter: `project_id=eq.${projectId}`
      }, (payload) => {
        setAgents(prev => {
          if (payload.eventType === 'INSERT') {
            return [...prev, payload.new as Agent]
          }
          if (payload.eventType === 'UPDATE') {
            return prev.map(a => a.id === payload.new.id ? payload.new as Agent : a)
          }
          if (payload.eventType === 'DELETE') {
            return prev.filter(a => a.id !== payload.old.id)
          }
          return prev
        })
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  const runningAgents = agents.filter(a => a.status === 'running')
  const hasActivity = runningAgents.length > 0

  return (
    <div style={{
      padding: '16px', borderRadius: 12,
      background: 'var(--surface)',
      border: `1px solid ${hasActivity ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`,
      transition: 'border-color 0.3s ease'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: hasActivity ? '#F59E0B' : '#64748B', letterSpacing: '0.08em' }}>
            AGENTS
          </span>
          {hasActivity && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(245,158,11,0.15)', color: '#F59E0B',
              fontWeight: 700, letterSpacing: '0.06em'
            }}>
              {runningAgents.length} RUNNING
            </span>
          )}
        </div>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connected ? '#10B981' : '#4B5563',
          // title removed — not a valid style prop
        }} />
      </div>

      {/* Agent list */}
      {agents.length === 0 ? (
        <div style={{ padding: '12px 0', textAlign: 'center' as const }}>
          <p style={{ fontSize: 12, color: '#475569' }}>No agents configured.</p>
          <p style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>Run /api/seed to initialise.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
          {agents.map(agent => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* No activity state */}
      {agents.length > 0 && !hasActivity && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.2)', textAlign: 'center' as const }}>
          <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>
            All agents idle. Submit a brief or run a phase to start.
          </p>
        </div>
      )}
    </div>
  )
}
