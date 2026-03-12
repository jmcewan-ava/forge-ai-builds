/**
 * FORGE AI — Orchestration Engine v2
 *
 * Responsibilities:
 * 1. Dependency graph resolution (topological sort)
 * 2. Parallel workstream execution
 * 3. Phase-level orchestration
 * 4. Post-build reconciliation
 * 5. Auto-merge PRs after QA pass (NEW)
 * 6. Real token cost tracking persisted to Supabase (NEW)
 *
 * Does NOT make LLM calls directly — delegates to lib/claude.ts
 * Does NOT write to GitHub directly — delegates to lib/file-writer.ts
 */

import { Octokit } from '@octokit/rest'
import { getServiceClient } from './supabase'
import { runBuilderAgent, runQAManager } from './claude'
import { acquireLocks, releaseLocks } from './file-lock'
import { commitFiles } from './file-writer'
import { checkLimits, recordUsage, setCurrentProject } from './cost-controller'
import { assembleContextPacket } from './context-packet'
import { fetchRepoFiles } from './repo-reader'
import type {
  Workstream, Agent, ExecutionPlan, ExecutionLevel,
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

// ─── SINGLE WORKSTREAM EXECUTION ─────────────────────────────────────────────

export async function runWorkstream(
  workstream: Workstream,
  livingSpec: LivingSpec,
  failurePatterns: FailurePattern[],
  projectId: string
): Promise<RunWorkstreamResult> {
  const startTime = Date.now()
  const db = getServiceClient()

  // Ensure cost controller has project context
  setCurrentProject(projectId)

  // Check cost limits before starting
  const costCheck = await checkLimits(projectId)
  if (!costCheck.within_limits) {
    return {
      workstream_id: workstream.id,
      status: 'failed',
      iterations: 0,
      passed: false,
      escalated: false,
      failures: [`Cost limit hit: ${costCheck.reason}`],
      files_produced: [],
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: costCheck.reason
    }
  }

  // Acquire file locks
  const estimatedFiles = workstream.estimated_files || []
  if (estimatedFiles.length > 0) {
    const locked = await acquireLocks(estimatedFiles, workstream.id, 120000)
    if (!locked) {
      await db.from('workstreams').update({
        status: 'queued',
        updated_at: new Date().toISOString()
      }).eq('id', workstream.id)

      return {
        workstream_id: workstream.id,
        status: 'failed',
        iterations: 0,
        passed: false,
        escalated: false,
        failures: ['File lock conflict — requeued for next execution'],
        files_produced: [],
        cost_usd: 0,
        duration_ms: Date.now() - startTime
      }
    }
  }

  // Mark as in_progress
  await db.from('workstreams').update({
    status: 'in_progress',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', workstream.id)

  // Update agent status
  await db.from('agents')
    .update({ status: 'running', current_workstream: workstream.id, started_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('role', 'builder')
    .eq('status', 'idle')
    .limit(1)

  let iteration = 0
  let currentBrief = workstream.brief
  let builderOutput = { code: {} as Record<string, string>, notes: '', handoff: '' }
  let passed = false
  let escalated = false
  let finalFailures: string[] = []
  let totalCost = 0

  const MAX_ITERATIONS = parseInt(process.env.MAX_QA_ITERATIONS || '3')

  try {
    // ── Builder → QA Loop ──────────────────────────────────────────────────
    while (!passed && !escalated && iteration < MAX_ITERATIONS) {

      // Fetch existing file contents from GitHub before building
      const existingFiles = await fetchRepoFiles(workstream.estimated_files || [])
      const contextPacket = await assembleContextPacket(workstream, livingSpec, failurePatterns, existingFiles)
      const wsWithBrief = { ...workstream, brief: currentBrief, context_packet: contextPacket }

      // Run builder
      const rawBuilderOutput = await runBuilderAgent(wsWithBrief, livingSpec, failurePatterns) as unknown as Record<string, unknown>
      builderOutput = rawBuilderOutput as typeof builderOutput

      // Track REAL token usage from the API response
      const builderUsage = rawBuilderOutput.usage as { input_tokens: number; output_tokens: number } | undefined
      if (builderUsage) {
        const costResult = await recordUsage(
          'builder', BUILDER_MODEL_NAME,
          builderUsage.input_tokens,
          builderUsage.output_tokens,
          projectId
        )
        totalCost += costResult.session_delta_usd || 0
      }

      // Mark as QA review
      await db.from('workstreams').update({
        qa_status: 'reviewing',
        qa_iterations: iteration + 1,
        output_code: builderOutput.code,
        updated_at: new Date().toISOString()
      }).eq('id', workstream.id)

      // Run QA
      const rawQaResult = await runQAManager(workstream, builderOutput, iteration) as unknown as Record<string, unknown>

      // Track QA token usage
      const qaUsage = rawQaResult.usage as { input_tokens: number; output_tokens: number } | undefined
      if (qaUsage) {
        const costResult = await recordUsage(
          'qa', QA_MODEL_NAME,
          qaUsage.input_tokens,
          qaUsage.output_tokens,
          projectId
        )
        totalCost += costResult.session_delta_usd || 0
      }

      const qaResult = rawQaResult as { passed: boolean; escalate: boolean; failures: string[]; feedback: string }

      if (qaResult.passed) {
        passed = true
      } else if (qaResult.escalate || iteration >= MAX_ITERATIONS - 1) {
        escalated = true
        finalFailures = qaResult.failures || ['QA escalated after max iterations']
      } else {
        currentBrief = `${workstream.brief}\n\n--- QA FEEDBACK (iteration ${iteration + 1}) ---\n${qaResult.feedback}\n\nFailures to fix:\n${(qaResult.failures || []).map((f: string) => `- ${f}`).join('\n')}`
        finalFailures = qaResult.failures || []
      }

      iteration++
    }

    // ── Post-loop: commit or fail ──────────────────────────────────────────
    const filesProduced = Object.keys(builderOutput.code || {})

    if (passed && filesProduced.length > 0) {
      // Commit files to GitHub
      const commitResult = await commitFiles(
        workstream.id,
        workstream.name,
        builderOutput.code,
        {
          owner: process.env.GITHUB_OWNER!,
          repo: process.env.GITHUB_REPO!,
          token: process.env.GITHUB_TOKEN!,
          defaultBranch: 'main'
        }
      )

      // Auto-merge if configured
      let mergeSha: string | undefined
      if (commitResult.pr_url && process.env.AUTO_MERGE_PRS === 'true') {
        try {
          const octokit = new Octokit({ auth: process.env.GITHUB_PAT })
          const [owner, repo] = (process.env.GITHUB_REPO || '').split('/')
          const prNumber = parseInt(commitResult.pr_url.split('/').pop() || '0')
          if (prNumber > 0) {
            const mergeResult = await octokit.pulls.merge({
              owner,
              repo,
              pull_number: prNumber,
              merge_method: 'squash'
            })
            mergeSha = mergeResult.data.sha
          }
        } catch (mergeErr) {
          console.error('[Orchestrator] Auto-merge failed:', mergeErr)
        }
      }

      await db.from('workstreams').update({
        status: 'complete',
        qa_status: 'passed',
        output_files: filesProduced,
        github_pr_url: commitResult.pr_url || null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', workstream.id)

      // Release file locks
      await releaseLocks(workstream.id)

      // Reset agent status
      await db.from('agents')
        .update({ status: 'idle', current_workstream: null })
        .eq('project_id', projectId)
        .eq('current_workstream', workstream.id)

      return {
        workstream_id: workstream.id,
        status: 'complete',
        iterations: iteration,
        passed: true,
        escalated: false,
        failures: [],
        files_produced: filesProduced,
        github_pr_url: commitResult.pr_url,
        github_merge_sha: mergeSha,
        cost_usd: totalCost,
        duration_ms: Date.now() - startTime
      }
    }

    // Failed or escalated
    const finalStatus = escalated ? 'escalated' : 'failed'
    await db.from('workstreams').update({
      status: finalStatus,
      qa_status: escalated ? 'escalated' : 'failed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    // Release file locks
    await releaseLocks(workstream.id)

    // Reset agent status
    await db.from('agents')
      .update({ status: 'idle', current_workstream: null })
      .eq('project_id', projectId)
      .eq('current_workstream', workstream.id)

    return {
      workstream_id: workstream.id,
      status: finalStatus,
      iterations: iteration,
      passed: false,
      escalated,
      failures: finalFailures,
      files_produced: [],
      cost_usd: totalCost,
      duration_ms: Date.now() - startTime
    }
  } catch (err) {
    // Release file locks on error
    await releaseLocks(workstream.id).catch(() => {})

    // Reset agent status on error
    await db.from('agents')
      .update({ status: 'idle', current_workstream: null })
      .eq('project_id', projectId)
      .eq('current_workstream', workstream.id)
      .then(() => {})
      .catch(() => {})

    await db.from('workstreams').update({
      status: 'failed',
      qa_status: 'error',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    return {
      workstream_id: workstream.id,
      status: 'failed',
      iterations: iteration,
      passed: false,
      escalated: false,
      failures: [String(err)],
      files_produced: [],
      cost_usd: totalCost,
      duration_ms: Date.now() - startTime,
      error: String(err)
    }
  }
}

// ─── MODEL NAME CONSTANTS ────────────────────────────────────────────────────

const BUILDER_MODEL_NAME = process.env.BUILDER_MODEL || 'claude-sonnet-4-20250514'
const QA_MODEL_NAME = process.env.QA_MODEL || 'claude-sonnet-4-20250514'

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
