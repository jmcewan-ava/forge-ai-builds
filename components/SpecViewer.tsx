'use client'

import { useState } from 'react'
import type { LivingSpec } from '@/lib/types'

interface Props {
  spec: LivingSpec
  compact?: boolean
}

function Tag({ text, color = '#6366F1' }: { text: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, color,
      background: `${color}18`, border: `1px solid ${color}30`,
      marginRight: 6, marginBottom: 4
    }}>
      {text}
    </span>
  )
}

function Section({ title, children, defaultOpen = true }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
          cursor: 'pointer', marginBottom: open ? 10 : 0
        }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: '#64748B', letterSpacing: '0.08em' }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: '#4B5563' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && children}
    </div>
  )
}

export function SpecViewer({ spec, compact = false }: Props) {
  const content = spec.content

  if (compact) {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 10,
        background: 'var(--surface)', border: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#64748B', letterSpacing: '0.08em' }}>
            LIVING SPEC
          </span>
          <span style={{ fontSize: 10, color: '#6366F1', fontFamily: 'var(--font-mono)' }}>
            v{spec.version}
          </span>
        </div>
        <p style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.6, margin: '0 0 10px' }}>
          {content.vision?.slice(0, 140)}{(content.vision?.length || 0) > 140 ? '...' : ''}
        </p>
        <div>
          {(content.tech_stack || []).slice(0, 3).map((t, i) => (
            <Tag key={i} text={`${t.layer}: ${t.choice.split(' ')[0]}`} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Version header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20, padding: '10px 14px', borderRadius: 8,
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)'
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#6366F1' }}>Living Spec</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748B' }}>
            Last updated by: {spec.last_updated_by}
          </span>
          <span style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 20,
            background: 'rgba(99,102,241,0.2)', color: '#A78BFA',
            fontFamily: 'var(--font-mono)', fontWeight: 700
          }}>
            v{spec.version}
          </span>
        </div>
      </div>

      {/* Vision */}
      <Section title="VISION">
        <p style={{ fontSize: 14, color: '#E2E8F0', lineHeight: 1.8, fontStyle: 'italic' as const }}>
          "{content.vision}"
        </p>
      </Section>

      {/* Goals */}
      {content.goals?.length > 0 && (
        <Section title="GOALS">
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
            {content.goals.map((goal, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 11, color: '#10B981', fontFamily: 'var(--font-mono)', marginTop: 2, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p style={{ fontSize: 13, color: '#94A3B8', margin: 0, lineHeight: 1.6 }}>{goal}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Tech Stack */}
      {content.tech_stack?.length > 0 && (
        <Section title="TECH STACK">
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {content.tech_stack.map((t, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12,
                padding: '8px 12px', borderRadius: 6,
                background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
              }}>
                <span style={{ fontSize: 11, color: '#6366F1', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {t.layer}
                </span>
                <div>
                  <span style={{ fontSize: 12, color: '#F1F5F9', fontWeight: 600 }}>{t.choice}</span>
                  <p style={{ fontSize: 11, color: '#64748B', margin: '2px 0 0', lineHeight: 1.5 }}>
                    {t.rationale}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Constraints */}
      {content.constraints?.length > 0 && (
        <Section title="CONSTRAINTS" defaultOpen={false}>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
            {content.constraints.map((c, i) => (
              <Tag key={i} text={c} color="#F59E0B" />
            ))}
          </div>
        </Section>
      )}

      {/* Architecture */}
      {content.architecture?.length > 0 && (
        <Section title="ARCHITECTURE" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {content.architecture.map((node, i) => (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${node.status === 'decided' ? 'rgba(16,185,129,0.15)' : node.status === 'open' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)'}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0' }}>{node.component}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 8px', borderRadius: 10,
                    color: node.status === 'decided' ? '#10B981' : node.status === 'open' ? '#F59E0B' : '#94A3B8',
                    background: node.status === 'decided' ? 'rgba(16,185,129,0.1)' : node.status === 'open' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.05)',
                    fontWeight: 700, fontFamily: 'var(--font-mono)'
                  }}>{node.status}</span>
                </div>
                <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>{node.description}</p>
                {node.dependencies?.length > 0 && (
                  <p style={{ fontSize: 11, color: '#475569', margin: '4px 0 0' }}>
                    Depends on: {node.dependencies.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Out of scope */}
      {content.out_of_scope?.length > 0 && (
        <Section title="OUT OF SCOPE" defaultOpen={false}>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
            {content.out_of_scope.map((item, i) => (
              <Tag key={i} text={item} color="#EF4444" />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
