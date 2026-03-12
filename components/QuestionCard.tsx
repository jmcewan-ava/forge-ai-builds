'use client'

import { useState } from 'react'
import type { OpenQuestion } from '@/lib/types'

interface Props {
  question: OpenQuestion
  projectId: string
  onAnswered: (questionId: string, answer: string) => void
}

const URGENCY_CFG = {
  blocking: { label: 'BLOCKING', color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)' },
  high:     { label: 'HIGH',     color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)' },
  medium:   { label: 'MEDIUM',   color: '#6366F1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)' },
  low:      { label: 'LOW',      color: '#64748B', bg: 'rgba(100,116,139,0.05)', border: 'rgba(100,116,139,0.15)' },
}

export function QuestionCard({ question, projectId, onAnswered }: Props) {
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(question.urgency === 'blocking' || question.urgency === 'high')
  const [error, setError] = useState<string | null>(null)

  const urgency = question.urgency as keyof typeof URGENCY_CFG || 'medium'
  const cfg = URGENCY_CFG[urgency]

  async function submit() {
    if (!answer.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/questions/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          answer: answer.trim(),
          project_id: projectId
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to submit answer')
        return
      }

      onAnswered(question.id, answer.trim())

    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      transition: 'all 0.2s ease'
    }}>
      {/* Question header */}
      <div
        style={{
          padding: '12px 16px', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, color: cfg.color,
              fontFamily: 'var(--font-mono)', letterSpacing: '0.08em'
            }}>
              {cfg.label}
            </span>
            <span style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
              {question.raised_by} · {new Date(question.raised_at).toLocaleDateString('en-AU')}
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#F1F5F9', margin: 0, lineHeight: 1.5 }}>
            {question.question}
          </p>
        </div>
        <span style={{ fontSize: 11, color: '#4B5563', flexShrink: 0, marginTop: 2 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded: context + answer input */}
      {expanded && (
        <div style={{
          padding: '0 16px 16px',
          borderTop: `1px solid ${cfg.border}`
        }}>
          {question.context && (
            <div style={{ padding: '10px 0 14px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6, letterSpacing: '0.06em' }}>
                WHY THIS MATTERS
              </p>
              <p style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.6, margin: 0 }}>
                {question.context}
              </p>
            </div>
          )}

          {error && (
            <div style={{
              padding: '8px 10px', borderRadius: 6, marginBottom: 10,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)'
            }}>
              <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>{error}</p>
            </div>
          )}

          <textarea
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Your answer..."
            style={{
              width: '100%', minHeight: 72, padding: '10px 12px',
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 7, color: '#F1F5F9', fontSize: 13, lineHeight: 1.5,
              fontFamily: 'var(--font-sans)', resize: 'vertical' as const, outline: 'none',
              boxSizing: 'border-box' as const
            }}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submit() }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={submit}
              disabled={submitting || !answer.trim()}
              style={{
                padding: '7px 18px', borderRadius: 7, border: 'none',
                background: submitting ? 'rgba(99,102,241,0.4)' : '#6366F1',
                color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: submitting || !answer.trim() ? 'not-allowed' : 'pointer',
                opacity: !answer.trim() ? 0.4 : 1,
                fontFamily: 'var(--font-sans)', transition: 'all 0.2s ease'
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Answer ⌘↵'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
