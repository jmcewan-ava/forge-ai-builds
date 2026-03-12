'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { AgentStatusPanel } from './AgentStatusPanel'
import { CostTracker } from './CostTracker'
import { QuestionCard } from './QuestionCard'
import { SpecViewer } from './SpecViewer'
import type {
  Project, Workstream, Decision, Session,
  OpenQuestion, FailurePattern, Agent, LivingSpec
} from '@/lib/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface DashboardData {
  project: Project
  living_spec: LivingSpec
  workstreams: Workstream[]
  decisions: Decision[]
  sessions: Session[]
  open_questions: OpenQuestion[]
  failure_patterns: FailurePattern[]
  agents: Agent[]
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  in_progress: { label: 'In Progress', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  queued:      { label: 'Queued',      color: '#6B7280', bg: 'rgba(107,114,128,0.1)' },
  qa_review:   { label: 'QA Review',   color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
  complete:    { label: 'Complete',    color: '#10B981', bg: 'rgba(16,185,129,0.1)'  },
  blocked:     { label: 'Blocked',     color: '#EF4444', bg: 'rgba(239,68,68,0.1)'   },
  failed:      { label: 'Failed',      color: '#EF4444', bg: 'rgba(239,68,68,0.1)'   },
  escalated:   { label: 'Escalated',   color: '#F97316', bg: 'rgba(249,115,22,0.1)'  },
}
const PRIORITY_COLOR: Record<string, string> = {
  P0: '#EF4444', P1: '#F59E0B', P2: '#6366F1', P3: '#6B7280'
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────

function Badge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.queued
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11,
      fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      fontFamily: 'var(--font-mono)', color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}30`
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color }} />
      {cfg.label}
    </span>
  )
}

function ProgressBar({ pct, color = 'linear-gradient(90deg, #6366F1, #A78BFA)' }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: color, transition: 'width 0.5s ease' }} />
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

// ─── AUTO-RUN COUNTDOWN ──────────────────────────────────────────────────────

function AutoRunCountdown({ onRun, onCancel }: { onRun: () => void; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(60)

  useEffect(() => {
    if (seconds <= 0) { onRun(); return }
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, onRun])

  const pct = ((60 - seconds) / 60) * 100

  return (
    <div style={{
      padding: '14px 18px', borderRadius: 10, marginBottom: 16,
      background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)',
      display: 'flex', alignItems: 'center', gap: 14
    }}>
      <div style={{ position: 'relative' as const, width: 40, height: 40, flexShrink: 0 }}>
        <svg width="40" height="40" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(99,102,241,0.2)" strokeWidth="3" />
          <circle cx="20" cy="20" r="16" fill="none" stroke="#6366F1" strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 16}`}
            strokeDashoffset={`${2 * Math.PI * 16 * (1 - pct / 100)}`}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <span style={{
          position: 'absolute' as const, top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 11, fontWeight: 800, color: '#6366F1', fontFamily: 'var(--font-mono)'
        }}>{seconds}</span>
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', margin: '0 0 3px' }}>
          Auto-running next phase in {seconds}s
        </p>
        <p style={{ fontSize: 11, color: '#64748B', margin: 0 }}>
          Brief processed. Agents will execute automatically.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onRun} style={{
          padding: '7px 14px', borderRadius: 7, border: 'none',
          background: '#6366F1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer'
        }}>Run Now</button>
        <button onClick={onCancel} style={{
          padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
          background: 'transparent', color: '#94A3B8', fontSize: 12, cursor: 'pointer'
        }}>Cancel</button>
      </div>
    </div>
  )
}

// ─── PHASE RUNNER PANEL ──────────────────────────────────────────────────────

function PhaseRunner({ projectId, onComplete }: { projectId: string; onComplete: () => void }) {
  const [running, setRunning] = useState(false)
  const [autonomous, setAutonomous] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  async function runPhase() {
    setRunning(true)
    setLog([`[${new Date().toLocaleTimeString()}] Starting ${autonomous ? 'autonomous build' : 'next phase'}...`])

    try {
      const res = await fetch('/api/agent/run-phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, autonomous })
      })

      if (!res.body) throw new Error('No stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.trim())

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.message) {
                setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${data.message}`])
              }
              if (data.workstream_id) {
                setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ Workstream complete — ${data.files_produced?.length || 0} files, ${data.iterations} QA iterations`])
              }
            } catch { /* ignore parse errors in stream */ }
          }
          if (line.startsWith('event: complete')) {
            setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ Build phase complete`])
          }
          if (line.startsWith('event: error')) {
            setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ Error in build`])
          }
        }
      }

      onComplete()

    } catch (err) {
      setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${String(err)}`])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ padding: '16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#64748B', letterSpacing: '0.08em' }}>PHASE RUNNER</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <div
              onClick={() => !running && setAutonomous(!autonomous)}
              style={{
                width: 32, height: 18, borderRadius: 9, position: 'relative' as const, cursor: 'pointer',
                background: autonomous ? '#6366F1' : 'rgba(255,255,255,0.1)',
                transition: 'background 0.2s'
              }}
            >
              <div style={{
                position: 'absolute' as const, top: 2, left: autonomous ? 16 : 2, width: 14, height: 14,
                borderRadius: '50%', background: '#fff', transition: 'left 0.2s'
              }} />
            </div>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>Autonomous</span>
          </label>
          <button
            onClick={runPhase}
            disabled={running}
            style={{
              padding: '7px 16px', borderRadius: 7, border: 'none',
              background: running ? 'rgba(99,102,241,0.4)' : '#6366F1',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: running ? 'not-allowed' : 'pointer'
            }}
          >
            {running ? '⚡ Running...' : autonomous ? '⚡ Run All Phases' : '⚡ Run Next Phase'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div
          ref={logRef}
          style={{
            maxHeight: 140, overflowY: 'auto' as const, padding: '8px 10px',
            background: 'rgba(0,0,0,0.3)', borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748B',
            display: 'flex', flexDirection: 'column' as const, gap: 2
          }}
        >
          {log.map((line, i) => (
            <span key={i} style={{ color: line.includes('✓') ? '#10B981' : line.includes('✗') ? '#EF4444' : '#64748B' }}>
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── BRIEF INPUT ─────────────────────────────────────────────────────────────

function BriefInput({
  projectId,
  onSuccess
}: {
  projectId: string
  onSuccess: (createdCount: number) => void
}) {
  const [val, setVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCountdown, setShowCountdown] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)

  async function submit() {
    if (!val.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: val, project_id: projectId })
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setResponse(data.office_manager_message)
      setCreatedCount(data.workstreams_created?.length || 0)
      setVal('')
      // Trigger auto-run countdown if workstreams were created
      if (data.workstreams_created?.length > 0) {
        setShowCountdown(true)
      }
      onSuccess(data.workstreams_created?.length || 0)
    } catch {
      setError('Failed to reach Office Manager')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 660 }}>
      <p style={{ fontSize: 14, color: '#94A3B8', marginBottom: 20, lineHeight: 1.7 }}>
        Describe what you want to build or change. The Office Manager decomposes your brief into workstreams and queues them for execution.
      </p>

      {showCountdown && (
        <AutoRunCountdown
          onRun={() => { setShowCountdown(false) }}
          onCancel={() => setShowCountdown(false)}
        />
      )}

      {response && !showCountdown && (
        <div style={{
          padding: '14px 18px', borderRadius: 10, marginBottom: 16,
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)'
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#10B981', marginBottom: 6, letterSpacing: '0.08em' }}>
            OFFICE MANAGER — {createdCount} WORKSTREAM{createdCount !== 1 ? 'S' : ''} CREATED
          </p>
          <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, margin: 0 }}>{response}</p>
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>{error}</p>
        </div>
      )}

      <div style={{ padding: 20, borderRadius: 12, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
          Brief → Office Manager
        </p>
        <textarea
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="e.g. Build the Shopify OAuth integration layer. Needs to handle the initial auth redirect, token exchange, and store credentials in Supabase against the shop domain. Use Next.js API routes, TypeScript, handle errors gracefully..."
          style={{
            width: '100%', minHeight: 120, padding: '12px 14px',
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, color: '#F1F5F9', fontSize: 13, lineHeight: 1.6,
            fontFamily: 'var(--font-sans)', resize: 'vertical' as const, outline: 'none',
            boxSizing: 'border-box' as const
          }}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submit() }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>⌘↵ to submit</span>
          <button onClick={submit} disabled={loading || !val.trim()} style={{
            padding: '9px 22px', borderRadius: 8, border: 'none',
            background: loading ? 'rgba(99,102,241,0.5)' : '#6366F1',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            opacity: !val.trim() ? 0.4 : 1
          }}>
            {loading ? 'Processing...' : 'Submit Brief'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── WORKSTREAM DETAIL ───────────────────────────────────────────────────────

function WorkstreamDetail({ ws, onRun, running }: { ws: Workstream; onRun: (id: string) => void; running: boolean }) {
  const canRun = ws.status === 'queued' || ws.status === 'failed'

  return (
    <div style={{ padding: 20, borderRadius: 12, background: 'var(--surface)', border: '1px solid rgba(99,102,241,0.25)', position: 'sticky' as const, top: 72 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: '#F1F5F9', margin: 0 }}>{ws.name}</h3>
        <Badge status={ws.status} />
      </div>
      <p style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.7, marginBottom: 14 }}>{ws.description}</p>

      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
          Tasks {ws.tasks?.filter(t => t.done).length || 0}/{ws.tasks?.length || 0}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
          {(ws.tasks || []).map(task => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, background: task.done ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.02)' }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: task.done ? '#10B981' : 'transparent', border: `1px solid ${task.done ? '#10B981' : 'rgba(255,255,255,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff' }}>
                {task.done ? '✓' : ''}
              </div>
              <span style={{ fontSize: 11, color: task.done ? '#475569' : '#94A3B8', textDecoration: task.done ? 'line-through' : 'none' }}>{task.text}</span>
            </div>
          ))}
        </div>
      </div>

      {ws.github_pr_url && (
        <a href={ws.github_pr_url} target="_blank" rel="noopener noreferrer" style={{
          display: 'block', padding: '8px 12px', borderRadius: 7, marginBottom: 12,
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
          color: '#10B981', fontSize: 12, fontWeight: 700, textDecoration: 'none'
        }}>
          → View Pull Request
        </a>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        {canRun && (
          <button onClick={() => onRun(ws.id)} disabled={running} style={{
            flex: 1, padding: '8px 14px', borderRadius: 7, border: 'none',
            background: running ? 'rgba(99,102,241,0.4)' : '#6366F1',
            color: '#fff', fontSize: 12, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer'
          }}>
            {running ? '⚡ Running...' : '⚡ Run Agent'}
          </button>
        )}
        <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
          Ph{ws.phase} · {ws.priority} · {ws.qa_iterations}×QA
        </span>
      </div>
    </div>
  )
}

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────────

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData)
  const [activeTab, setActiveTab] = useState('workstreams')
  const [activeWs, setActiveWs] = useState<Workstream | null>(data.workstreams[0] || null)
  const [runningAgent, setRunningAgent] = useState<string | null>(null)
  const [questions, setQuestions] = useState(initialData.open_questions)

  const project = data.project

  const totalTasks = data.workstreams.flatMap(w => w.tasks || []).length
  const doneTasks = data.workstreams.flatMap(w => w.tasks || []).filter(t => t.done).length
  const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/dashboard?project_id=${project.id}`)
    const fresh = await res.json()
    if (!fresh.error) {
      setData(fresh)
      setQuestions(fresh.open_questions)
    }
  }, [project.id])

  // Realtime subscriptions — workstreams + open questions
  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const channel = supabase.channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workstreams', filter: `project_id=eq.${project.id}` }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_questions', filter: `project_id=eq.${project.id}` }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `project_id=eq.${project.id}` }, () => refresh())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [project.id, refresh])

  const runAgent = async (workstreamId: string) => {
    setRunningAgent(workstreamId)
    try {
      await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workstream_id: workstreamId, project_id: project.id })
      })
      await refresh()
    } finally {
      setRunningAgent(null)
    }
  }

  const handleQuestionAnswered = (questionId: string) => {
    setQuestions(prev => prev.filter(q => q.id !== questionId))
    setTimeout(refresh, 500)
  }

  const TABS = [
    { id: 'workstreams', label: 'Workstreams' },
    { id: 'run',         label: '⚡ Run' },
    { id: 'decisions',   label: 'Decisions' },
    { id: 'sessions',    label: 'Sessions' },
    { id: 'questions',   label: `Questions${questions.length > 0 ? ` (${questions.length})` : ''}`, alert: questions.filter(q => q.urgency === 'blocking').length > 0 },
    { id: 'spec',        label: 'Spec' },
    { id: 'patterns',    label: 'Patterns' },
    { id: 'brief',       label: '+ Brief' },
  ]

  const blockingQuestions = questions.filter(q => q.urgency === 'blocking').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── NAV ── */}
      <nav style={{
        borderBottom: '1px solid var(--border)', padding: '0 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52,
        background: 'rgba(11,12,20,0.95)', backdropFilter: 'blur(12px)',
        position: 'sticky' as const, top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #6366F1, #A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>⚒</div>
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.02em' }}>
            FORGE <span style={{ color: '#6366F1' }}>AI</span>
          </span>
          <span style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>OFFICE MANAGER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {blockingQuestions > 0 && (
            <button onClick={() => setActiveTab('questions')} style={{
              padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
              background: 'rgba(239,68,68,0.15)', color: '#EF4444',
              fontSize: 11, fontWeight: 800, letterSpacing: '0.06em'
            }}>
              ⚠ {blockingQuestions} BLOCKING
            </button>
          )}
          {runningAgent && (
            <span style={{ fontSize: 11, color: '#F59E0B', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ animation: 'pulse 1.5s ease infinite' }}>●</span> Agent running
            </span>
          )}
          <button onClick={refresh} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: '#64748B', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>↻</button>
        </div>
      </nav>

      <div style={{ padding: '24px 28px', maxWidth: 1320, margin: '0 auto' }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>{project.name}</h1>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>{project.tagline}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              <Stat label="Progress" value={`${overallPct}%`} color="#6366F1" />
              <Stat label="Active" value={data.workstreams.filter(w => w.status === 'in_progress').length} color="#F59E0B" />
              <Stat label="Complete" value={data.workstreams.filter(w => w.status === 'complete').length} color="#10B981" />
              <Stat label="Decisions" value={data.decisions.length} color="#A78BFA" />
              <Stat label="Questions" value={questions.length} color={questions.length > 0 ? '#EF4444' : '#64748B'} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, minWidth: 220 }}>
            <AgentStatusPanel agents={data.agents} projectId={project.id} />
            <CostTracker projectId={project.id} />
          </div>
        </div>

        {/* ── TABS ── */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '9px 14px', border: 'none', background: 'transparent',
              color: activeTab === t.id ? '#6366F1' : t.alert ? '#EF4444' : '#64748B',
              fontWeight: activeTab === t.id ? 700 : 500, fontSize: 12,
              borderBottom: activeTab === t.id ? '2px solid #6366F1' : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer'
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── WORKSTREAMS ── */}
        {activeTab === 'workstreams' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {data.workstreams.map(ws => (
                <div key={ws.id} onClick={() => setActiveWs(ws)} style={{
                  padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                  background: activeWs?.id === ws.id ? 'rgba(99,102,241,0.1)' : 'var(--surface)',
                  border: `1px solid ${activeWs?.id === ws.id ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                  transition: 'all 0.15s ease'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: PRIORITY_COLOR[ws.priority], fontFamily: 'var(--font-mono)' }}>{ws.priority}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{ws.name}</span>
                    </div>
                    <Badge status={ws.status} />
                  </div>
                  <p style={{ fontSize: 12, color: '#64748B', marginBottom: 8, lineHeight: 1.5 }}>{ws.description}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                      Phase {ws.phase} · {(ws.tasks || []).filter(t => t.done).length}/{(ws.tasks || []).length} tasks
                    </span>
                    <span style={{ fontSize: 11, color: '#6366F1', fontFamily: 'var(--font-mono)' }}>{ws.completion_pct}%</span>
                  </div>
                  <ProgressBar pct={ws.completion_pct} />
                </div>
              ))}
            </div>
            {activeWs && <WorkstreamDetail ws={activeWs} onRun={runAgent} running={runningAgent === activeWs.id} />}
          </div>
        )}

        {/* ── RUN ── */}
        {activeTab === 'run' && (
          <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
            <PhaseRunner projectId={project.id} onComplete={refresh} />
          </div>
        )}

        {/* ── DECISIONS ── */}
        {activeTab === 'decisions' && (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, maxWidth: 760 }}>
            {data.decisions.map(d => (
              <div key={d.id} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid #6366F1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{d.decision}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                    {!d.reversible && <span style={{ fontSize: 10, color: '#EF4444', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>FINAL</span>}
                    <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>{d.date}</span>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#94A3B8', margin: '0 0 4px', lineHeight: 1.6 }}>{d.rationale}</p>
                <span style={{ fontSize: 11, color: '#6366F1', fontFamily: 'var(--font-mono)' }}>— {d.made_by}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── SESSIONS ── */}
        {activeTab === 'sessions' && (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, maxWidth: 760 }}>
            {data.sessions.map(s => (
              <div key={s.id} style={{ padding: '16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{s.title}</span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {s.cost_usd > 0 && <span style={{ fontSize: 11, color: '#A78BFA', fontFamily: 'var(--font-mono)' }}>${s.cost_usd?.toFixed(2)}</span>}
                    <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>{s.date}</span>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.7, marginBottom: s.key_outputs?.length ? 10 : 0 }}>{s.summary}</p>
                {s.key_outputs?.length > 0 && (
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#10B981', marginBottom: 4, letterSpacing: '0.06em' }}>OUTPUTS</p>
                    {s.key_outputs.map((o, i) => <p key={i} style={{ fontSize: 11, color: '#64748B', margin: '1px 0' }}>· {o}</p>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── QUESTIONS ── */}
        {activeTab === 'questions' && (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, maxWidth: 720 }}>
            {questions.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center' as const, color: '#475569', fontSize: 13 }}>
                No open questions. The Office Manager is satisfied.
              </div>
            ) : (
              questions.map(q => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  projectId={project.id}
                  onAnswered={handleQuestionAnswered}
                />
              ))
            )}
          </div>
        )}

        {/* ── SPEC ── */}
        {activeTab === 'spec' && (
          <SpecViewer spec={data.living_spec} />
        )}

        {/* ── PATTERNS ── */}
        {activeTab === 'patterns' && (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, maxWidth: 760 }}>
            {data.failure_patterns.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center' as const, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p style={{ color: '#475569', fontSize: 13, margin: 0 }}>No failure patterns yet.</p>
                <p style={{ color: '#374151', fontSize: 12, marginTop: 6 }}>Patterns accumulate as agents run QA. Gets valuable fast.</p>
              </div>
            ) : data.failure_patterns.map(fp => (
              <div key={fp.id} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid #A78BFA' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>{fp.pattern_type}</span>
                  <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>×{fp.occurrence_count}</span>
                </div>
                <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8, lineHeight: 1.6 }}>{fp.description}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#10B981', marginBottom: 3, letterSpacing: '0.08em' }}>PREVENTION</p>
                    <p style={{ fontSize: 11, color: '#64748B' }}>{fp.prevention}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#6366F1', marginBottom: 3, letterSpacing: '0.08em' }}>RESOLUTION</p>
                    <p style={{ fontSize: 11, color: '#64748B' }}>{fp.resolution}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── BRIEF ── */}
        {activeTab === 'brief' && (
          <BriefInput
            projectId={project.id}
            onSuccess={(count) => {
              if (count > 0) setActiveTab('workstreams')
              refresh()
            }}
          />
        )}

      </div>
    </div>
  )
}
