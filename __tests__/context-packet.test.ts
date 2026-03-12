/**
 * FORGE AI — Context Packet Tests
 * Tests semantic keyword matching for failure pattern selection.
 */

import { assembleContextPacket } from '../lib/context-packet'
import type { Workstream, LivingSpec, FailurePattern } from '../lib/types'

function makePattern(
  type: string, triggerContext: string, prevention: string,
  severity: 'low'|'medium'|'high' = 'medium', count = 1
): FailurePattern {
  return {
    id: Math.random().toString(36),
    project_id: 'proj-1',
    pattern_type: type,
    description: type,
    trigger_context: triggerContext,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    occurrence_count: count,
    resolution: 'fixed',
    prevention,
    workstream_ids: [],
    severity
  }
}

function makeSpec(): LivingSpec {
  return {
    id: 'spec-1',
    project_id: 'proj-1',
    version: 1,
    content: {
      vision: 'Autonomous multi-agent software factory',
      goals: ['Build fast', 'Build autonomously'],
      constraints: ['TypeScript only'],
      tech_stack: [
        { layer: 'Frontend', choice: 'Next.js 14', rationale: '', decided_at: '', reversible: true },
        { layer: 'Database', choice: 'Supabase', rationale: '', decided_at: '', reversible: true }
      ],
      architecture: [],
      out_of_scope: ['Voice input in v1'],
      file_conventions: {
        components_dir: 'components/',
        lib_dir: 'lib/',
        api_dir: 'app/api/',
        naming_pattern: 'PascalCase for components, camelCase for utils'
      }
    },
    last_updated_by: 'founder',
    updated_at: new Date().toISOString()
  }
}

function makeWs(brief: string): Workstream {
  return {
    id: 'ws-1', project_id: 'proj-1', name: 'Test', description: '',
    status: 'queued', priority: 'P1', phase: 1, completion_pct: 0,
    blocked_by: [], qa_iterations: 0, tasks: [], brief,
    output_files: [], created_at: '', updated_at: ''
  }
}

describe('assembleContextPacket', () => {
  test('includes project vision', async () => {
    const ws = makeWs('Build a TypeScript database helper')
    const spec = makeSpec()
    const packet = await assembleContextPacket(ws, spec, [])
    expect(packet).toContain('Autonomous multi-agent')
  })

  test('includes tech stack', async () => {
    const ws = makeWs('Build something')
    const spec = makeSpec()
    const packet = await assembleContextPacket(ws, spec, [])
    expect(packet).toContain('Next.js 14')
    expect(packet).toContain('Supabase')
  })

  test('selects relevant failure patterns by keyword', async () => {
    const patterns = [
      makePattern('TypeScript any', 'typescript type generic', 'Use explicit types'),
      makePattern('Database timeout', 'supabase database query timeout', 'Add query timeout'),
      makePattern('CSS color clash', 'styling color button hover', 'Use design tokens'),
    ]

    // Brief about database — should select database pattern
    const ws = makeWs('Build a Supabase database query helper with timeout handling')
    const spec = makeSpec()
    const packet = await assembleContextPacket(ws, spec, patterns)
    
    expect(packet).toContain('Database timeout')
  })

  test('includes file conventions', async () => {
    const ws = makeWs('Build a React component')
    const spec = makeSpec()
    const packet = await assembleContextPacket(ws, spec, [])
    expect(packet).toContain('components/')
    expect(packet).toContain('PascalCase')
  })

  test('handles empty patterns gracefully', async () => {
    const ws = makeWs('Build something')
    const spec = makeSpec()
    const packet = await assembleContextPacket(ws, spec, [])
    expect(typeof packet).toBe('string')
    expect(packet.length).toBeGreaterThan(50)
  })
})
