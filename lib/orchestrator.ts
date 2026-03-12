/**
 * FORGE AI — Orchestration Engine v3 — Dream Team
 *
 * Responsibilities:
 * 1. Dependency graph resolution (topological sort)
 * 2. Parallel workstream execution
 * 3. Phase-level orchestration
 * 4. Dream Team pipeline: Discovery → Architect → Surgeon → TypeChecker → BehaviourQA → PM
 *
 * Does NOT make LLM calls directly — delegates to lib/agents/pipeline.ts
 * Does NOT write to GitHub directly — delegates to lib/file-writer.ts
 */

import { getServiceClient } from './supabase'
import { runDreamTeamPipeline } from './agents/pipeline'
import { setCurrentProject } from './cost-controller'
import type {
  Workstream, ExecutionPlan, ExecutionLevel,
  LivingSpec, FailurePattern, OfficeManagerState, Session
} from './types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface RunWorkstreamResult {
  workstream_id: string
  status: 'complete' | 'failed' | 'escalated'
  iterations: number
  passed: boolean
  escalated: boolean
  failures: string[]
  files_produced: string[]
  github_pr_url?: string
  github_merge_sha?: string
  cost_usd: number
  duration_ms: number
  error?: string
}

export interface RunPhaseResult {
  phase: number
  workstreams_run: number
  completed: number
  failed: number
  escalated: number
  results: RunWorkstreamResult[]
  total_cost_usd: number
  total_duration_ms: number
  next_phase_available: boolean
  next_phase?: number
  blocked_workstreams: string[]
}

export interface OrchestrationError {
  type: 'circular_dependency' | 'no_workstreams' | 'cost_limit' | 'spec_error'
  message: string
  workstream_ids?: string[]
}

// ─── DEPENDENCY GRAPH RESOLVER ───────────────────────────────────────────────

export function buildExecutionPlan(workstreams: Workstream[]): ExecutionPlan {
  const wsMap = new Map(workstreams.map(w => [w.id, w]))

  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const ws of workstreams) {
    if (!inDegree.has(ws.id)) inDegree.set(ws.id, 0)
    if (!dependents.has(ws.id)) dependents.set(ws.id, [])

    for (const depId of (ws.blocked_by || [])) {
      inDegree.set(ws.id, (inDegree.get(ws.id) || 0) + 1)
      if (!dependents.has(depId)) dependents.set(depId, [])
      dependents.get(depId)!.push(ws.id)
    }
  }

  const levels: ExecutionLevel[] = []
  let remaining = new Set(workstreams.map(w => w.id))
  let levelNum = 1

  while (remaining.size > 0) {
    const currentLevel: string[] = []

    for (const wsId of Array.from(remaining)) {
      if ((inDegree.get(wsId) || 0) === 0) currentLevel.push(wsId)
    }

    if (currentLevel.length === 0) {
      const remaining_ids = Array.from(remaining)
      throw {
        type: 'circular_dependency',
        message: `Circular dependency detected between workstreams: ${remaining_ids.map(id => wsMap.get(id)?.name || id).join(', ')}`,
        workstream_ids: remaining_ids
      } as OrchestrationError
    }

    const levelWorkstreams = currentLevel
      .map(id => wsMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => {
        const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 }
        return (priorityOrder[a.priority as keyof typeof priorityOrder] || 3) -
               (priorityOrder[b.priority as keyof typeof priorityOrder] || 3)
      })

    levels.push({
      level: levelNum,
      workstreams: levelWorkstreams,
      blocked_until: levelWorkstreams.flatMap(ws => ws.blocked_by || [])
    })

    for (const wsId of currentLevel) {
      remaining.delete(wsId)
      for (const dependent of (dependents.get(wsId) || [])) {
        inDegree.set(dependent, (inDegree.get(dependent) || 1) - 1)
      }
    }

    levelNum++
  }

  const totalSerialTime = levels.reduce((sum, level) => {
    const longestInLevel = level.workstreams.length > 0 ? 90 * 1.5 : 0
    return sum + longestInLevel
  }, 0)

  const estimatedMinutes = Math.ceil(totalSerialTime / 60)

  return {
    levels,
    total_ws: workstreams.length,
    estimated_time: estimatedMinutes < 2 ? '< 2 minutes' : `~${estimatedMinutes} minutes`
  }
}

// ─── SINGLE WORKSTREAM EXECUTION — DREAM TEAM ─────────────────────────────────

export async function runWorkstream(
  workstream: Workstream,
  livingSpec: LivingSpec,
  failurePatterns: FailurePattern[],
  projectId: string
): Promise<RunWorkstreamResult> {
  setCurrentProject(projectId)

  // Delegate entirely to the Dream Team pipeline
  // Discovery → Architect → Consultant → Surgeon → TypeChecker → BehaviourQA → PM → ProductAdvisor
  const result = await runDreamTeamPipeline(workstream, livingSpec, failurePatterns, projectId)

  return {
    workstream_id: result.workstream_id,
    status: result.status,
    iterations: result.iterations,
    passed: result.passed,
    escalated: result.escalated,
    failures: result.failures,
    files_produced: result.files_produced,
    github_pr_url: result.github_pr_url,
    github_merge_sha: result.github_merge_sha,
    cost_usd: result.cost_usd,
    duration_ms: result.duration_ms,
    error: result.error
  }
}


// ─── PHASE EXECUTION ─────────────────────────────────────────────────────────

export async function runPhase(
  projectId: string,
  phase: number,
  maxParallel: number = 3
): Promise<RunPhaseResult> {
  const startTime = Date.now()
  const db = getServiceClient()

  setCurrentProject(projectId)

  // Load workstreams for this phase
  const { data: workstreams, error: wsError } = await db
    .from('workstreams')
    .select('*')
    .eq('project_id', projectId)
    .eq('phase', phase)
    .in('status', ['queued'])

  if (wsError || !workstreams?.length) {
    return {
      phase,
      workstreams_run: 0,
      completed: 0,
      failed: 0,
      escalated: 0,
      results: [],
      total_cost_usd: 0,
      total_duration_ms: Date.now() - startTime,
      next_phase_available: false,
      blocked_workstreams: []
    }
  }

  // Load living spec and failure patterns
  const [specRes, patternsRes] = await Promise.all([
    db.from('living_specs')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1),
    db.from('failure_patterns')
      .select('*')
      .eq('project_id', projectId)
      .order('occurrence_count', { ascending: false })
  ])

  if (!specRes.data?.[0]) {
    throw new Error('No living spec found for project')
  }

  const livingSpec = specRes.data[0] as LivingSpec
  const failurePatterns = (patternsRes.data || []) as FailurePattern[]

  // Check which workstreams are unblocked
  const { data: completedWs } = await db
    .from('workstreams')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'complete')

  const completedIds = new Set((completedWs || []).map((w: { id: string }) => w.id))

  const unblocked = workstreams.filter((ws: Workstream) =>
    (ws.blocked_by || []).every((id: string) => completedIds.has(id))
  )

  const blockedWorkstreams = workstreams
    .filter((ws: Workstream) => !unblocked.includes(ws))
    .map((ws: Workstream) => ws.id)

  // Execute unblocked workstreams in parallel batches
  const results: RunWorkstreamResult[] = []

  for (let i = 0; i < unblocked.length; i += maxParallel) {
    const batch = unblocked.slice(i, i + maxParallel)
    const batchResults = await Promise.allSettled(
      batch.map((ws: Workstream) => runWorkstream(ws, livingSpec, failurePatterns, projectId))
    )

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
      } else {
        results.push({
          workstream_id: 'unknown',
          status: 'failed',
          iterations: 0,
          passed: false,
          escalated: false,
          failures: [String(result.reason)],
          files_produced: [],
          cost_usd: 0,
          duration_ms: 0,
          error: String(result.reason)
        })
      }
    }
  }

  // Check if next phase is available
  const { data: nextPhaseWs } = await db
    .from('workstreams')
    .select('phase')
    .eq('project_id', projectId)
    .in('status', ['queued'])
    .gt('phase', phase)
    .order('phase', { ascending: true })
    .limit(1)

  const completed = results.filter(r => r.status === 'complete').length
  const failed = results.filter(r => r.status === 'failed').length
  const escalatedCount = results.filter(r => r.status === 'escalated').length
  const totalCost = results.reduce((sum, r) => sum + r.cost_usd, 0)

  const phaseResult: RunPhaseResult = {
    phase,
    workstreams_run: results.length,
    completed,
    failed,
    escalated: escalatedCount,
    results,
    total_cost_usd: totalCost,
    total_duration_ms: Date.now() - startTime,
    next_phase_available: !!nextPhaseWs?.length,
    next_phase: nextPhaseWs?.[0]?.phase,
    blocked_workstreams: blockedWorkstreams
  }

  // ── Agent status cleanup ─────────────────────────────────────────────────
  // Reset any agents still stuck in 'running' state for this project.
  // This catches edge cases where individual workstream cleanup was missed.
  try {
    console.log(`[Orchestrator] Cleaning up agent statuses for project ${projectId}`)
    const { error: cleanupError } = await db
      .from('agents')
      .update({ status: 'idle', current_workstream: null })
      .eq('project_id', projectId)
      .eq('status', 'running')
    if (cleanupError) {
      console.error('[Orchestrator] Agent cleanup failed:', cleanupError)
    } else {
      console.log('[Orchestrator] Agent statuses cleaned up successfully')
    }
  } catch (cleanupErr) {
    console.error('[Orchestrator] Agent cleanup exception:', cleanupErr)
  }

  return phaseResult
}

// ─── FULL PROJECT ORCHESTRATION ──────────────────────────────────────────────

export async function runFullProject(
  projectId: string,
  maxParallel: number = 3
): Promise<RunPhaseResult[]> {
  const db = getServiceClient()
  const allResults: RunPhaseResult[] = []

  // Get all phases
  const { data: phases } = await db
    .from('workstreams')
    .select('phase')
    .eq('project_id', projectId)
    .order('phase', { ascending: true })

  if (!phases?.length) return allResults

  const uniquePhases = [...new Set(phases.map((p: { phase: number }) => p.phase))].sort((a, b) => a - b)

  for (const phase of uniquePhases) {
    const result = await runPhase(projectId, phase, maxParallel)
    allResults.push(result)

    // Stop if phase had failures and no completions
    if (result.completed === 0 && result.workstreams_run > 0) {
      break
    }
  }

  return allResults
}
