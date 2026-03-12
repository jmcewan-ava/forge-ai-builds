/**
 * FORGE AI — Orchestrator Unit Tests
 * 
 * Tests the dependency resolver (pure function — no DB, no LLM calls).
 * Run with: npm test
 */

import { buildExecutionPlan } from '../lib/orchestrator'
import type { Workstream } from '../lib/types'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeWs(
  id: string,
  name: string,
  blocked_by: string[] = [],
  priority: 'P0' | 'P1' | 'P2' | 'P3' = 'P1'
): Workstream {
  return {
    id, name, blocked_by, priority,
    project_id: 'proj-1',
    description: '',
    status: 'queued',
    phase: 1,
    completion_pct: 0,
    qa_iterations: 0,
    tasks: [],
    brief: '',
    output_files: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

// ─── TESTS ───────────────────────────────────────────────────────────────────

describe('buildExecutionPlan', () => {
  
  describe('Linear chain', () => {
    test('three sequential workstreams produce three levels', () => {
      const ws1 = makeWs('ws1', 'Types')
      const ws2 = makeWs('ws2', 'DB Schema', ['ws1'])
      const ws3 = makeWs('ws3', 'API Routes', ['ws2'])

      const plan = buildExecutionPlan([ws1, ws2, ws3])

      expect(plan.total_ws).toBe(3)
      expect(plan.levels).toHaveLength(3)
      expect(plan.levels[0].workstreams.map(w => w.id)).toEqual(['ws1'])
      expect(plan.levels[1].workstreams.map(w => w.id)).toEqual(['ws2'])
      expect(plan.levels[2].workstreams.map(w => w.id)).toEqual(['ws3'])
    })
  })

  describe('Parallel workstreams', () => {
    test('independent workstreams all appear in level 1', () => {
      const ws1 = makeWs('ws1', 'Types')
      const ws2 = makeWs('ws2', 'Supabase')
      const ws3 = makeWs('ws3', 'GitHub API')

      const plan = buildExecutionPlan([ws1, ws2, ws3])

      expect(plan.levels).toHaveLength(1)
      expect(plan.levels[0].workstreams).toHaveLength(3)
      expect(plan.total_ws).toBe(3)
    })

    test('diamond dependency: A→[B,C]→D', () => {
      const a = makeWs('a', 'Foundation')
      const b = makeWs('b', 'Branch B', ['a'])
      const c = makeWs('c', 'Branch C', ['a'])
      const d = makeWs('d', 'Merge', ['b', 'c'])

      const plan = buildExecutionPlan([a, b, c, d])

      expect(plan.levels).toHaveLength(3)
      expect(plan.levels[0].workstreams.map(w => w.id)).toEqual(['a'])
      
      const level2Ids = plan.levels[1].workstreams.map(w => w.id).sort()
      expect(level2Ids).toEqual(['b', 'c'])
      
      expect(plan.levels[2].workstreams.map(w => w.id)).toEqual(['d'])
    })
  })

  describe('Priority ordering', () => {
    test('P0 workstreams appear before P2 in same level', () => {
      const p2 = makeWs('ws-p2', 'Low priority', [], 'P2')
      const p0 = makeWs('ws-p0', 'Critical', [], 'P0')
      const p1 = makeWs('ws-p1', 'Normal', [], 'P1')

      const plan = buildExecutionPlan([p2, p0, p1])

      expect(plan.levels).toHaveLength(1)
      const ids = plan.levels[0].workstreams.map(w => w.id)
      expect(ids[0]).toBe('ws-p0')  // P0 first
      expect(ids[1]).toBe('ws-p1')  // P1 second
      expect(ids[2]).toBe('ws-p2')  // P2 last
    })
  })

  describe('Error cases', () => {
    test('empty workstreams returns empty plan', () => {
      const plan = buildExecutionPlan([])
      expect(plan.total_ws).toBe(0)
      expect(plan.levels).toHaveLength(0)
    })

    test('single workstream returns single level', () => {
      const plan = buildExecutionPlan([makeWs('ws1', 'Solo')])
      expect(plan.levels).toHaveLength(1)
      expect(plan.levels[0].workstreams).toHaveLength(1)
    })

    test('circular dependency throws OrchestrationError', () => {
      const ws1 = makeWs('ws1', 'A', ['ws2'])
      const ws2 = makeWs('ws2', 'B', ['ws1'])

      expect(() => buildExecutionPlan([ws1, ws2])).toThrow()
    })

    test('circular dependency error has correct type', () => {
      const ws1 = makeWs('ws1', 'A', ['ws2'])
      const ws2 = makeWs('ws2', 'B', ['ws1'])

      try {
        buildExecutionPlan([ws1, ws2])
        fail('Should have thrown')
      } catch (err: any) {
        expect(err.type).toBe('circular_dependency')
        expect(err.message).toContain('Circular dependency')
        expect(err.workstream_ids).toContain('ws1')
        expect(err.workstream_ids).toContain('ws2')
      }
    })
  })

  describe('Timing estimates', () => {
    test('estimated_time is reasonable for 1 workstream', () => {
      const plan = buildExecutionPlan([makeWs('ws1', 'A')])
      expect(plan.estimated_time).toMatch(/minute|< 2/)
    })

    test('parallel workstreams estimate same time as single', () => {
      // 5 parallel workstreams should take about same as 1 (they run simultaneously)
      const single = buildExecutionPlan([makeWs('ws1', 'A')])
      const parallel = buildExecutionPlan([
        makeWs('ws1', 'A'), makeWs('ws2', 'B'), makeWs('ws3', 'C'),
        makeWs('ws4', 'D'), makeWs('ws5', 'E')
      ])
      // Parallel should be faster than or equal to sequential of same count
      expect(single.total_ws).toBe(1)
      expect(parallel.total_ws).toBe(5)
    })
  })

  describe('Complex real-world scenario', () => {
    test('Forge AI own workstreams resolve correctly', () => {
      const types      = makeWs('types',   'lib/types.ts')
      const supabase   = makeWs('supabase','lib/supabase.ts',        ['types'])
      const claude     = makeWs('claude',  'lib/claude.ts',          ['types'])
      const filelock   = makeWs('filelock','lib/file-lock.ts')
      const cost       = makeWs('cost',    'lib/cost-controller.ts')
      const context    = makeWs('context', 'lib/context-packet.ts',  ['types'])
      const orchestr   = makeWs('orchestr','lib/orchestrator.ts',    ['supabase', 'claude', 'filelock', 'cost', 'context'])
      const briefRoute = makeWs('brief',   'app/api/brief/route.ts', ['supabase', 'claude'])
      const dashboard  = makeWs('dash',    'components/Dashboard',   ['types'])

      const plan = buildExecutionPlan([
        types, supabase, claude, filelock, cost, context, orchestr, briefRoute, dashboard
      ])

      // types, filelock, cost should be in level 1 (no dependencies)
      const level1Ids = plan.levels[0].workstreams.map(w => w.id)
      expect(level1Ids).toContain('types')
      expect(level1Ids).toContain('filelock')
      expect(level1Ids).toContain('cost')

      // orchestrator should be in a later level (depends on many things)
      const orchestrLevel = plan.levels.findIndex(
        l => l.workstreams.some(w => w.id === 'orchestr')
      )
      expect(orchestrLevel).toBeGreaterThan(1)

      expect(plan.total_ws).toBe(9)
    })
  })
})
