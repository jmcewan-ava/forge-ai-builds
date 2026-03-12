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
      // This is the core quality improvement — builders that can see existing code
      // don't overwrite work or write conflicting implementations
      const existingFiles = await fetchRepoFiles(workstream.estimated_files || [])
      const contextPacket = await assembleContextPacket(workstream, livingSpec, failurePatterns, existingFiles)
      const wsWithBrief = { ...workstream, brief: currentBrief, context_packet: contextPacket }

      // Run builder
      const rawBuilderOutput = await runBuilderAgent(wsWithBrief, livingSpec, failurePatterns) as any
      builderOutput = rawBuilderOutput

      // Track REAL token usage from the API response
      const builderUsage = rawBuilderOutput.usage
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
        status: 'qa_review',
        qa_iterations: iteration + 1,
        output_code: builderOutput.code,
        updated_at: new Date().toISOString()
      }).eq('id', workstream.id)

      // Run QA
      const qaResult = await runQAManager(
        { ...workstream, brief: currentBrief },
        builderOutput,
        iteration
      )

      // Track real QA token usage (now returned from runQAManager)
      const qaResultWithUsage = qaResult as typeof qaResult & { usage?: { input_tokens: number; output_tokens: number } }
      if (qaResultWithUsage.usage) {
        const qaCostResult = await recordUsage(
          'qa_manager', QA_MODEL_NAME,
          qaResultWithUsage.usage.input_tokens,
          qaResultWithUsage.usage.output_tokens,
          projectId
        )
        totalCost += qaCostResult.session_delta_usd || 0
      }

      passed = qaResult.passed
      escalated = qaResult.escalate
      finalFailures = qaResult.failures

      // Record failure pattern
      if (!passed && !escalated && qaResult.pattern_type) {
        await upsertFailurePattern(
          projectId,
          qaResult.pattern_type,
          qaResult.failures.join('; '),
          qaResult.revised_brief || '',
          qaResult.pattern_prevention || '',
          workstream.id
        )
      }

      if (!passed && !escalated && qaResult.revised_brief) {
        currentBrief = qaResult.revised_brief
      }

      iteration++
    }

    // ── Handle escalation ─────────────────────────────────────────────────
    if (escalated || (!passed && iteration >= MAX_ITERATIONS)) {
      escalated = true

      await db.from('open_questions').insert({
        project_id: projectId,
        question: `Workstream "${workstream.name}" needs human review — QA failed after ${iteration} iterations`,
        context: `Final failures: ${finalFailures.join('; ')}. The builder brief may need to be rewritten.`,
        raised_by: 'qa_manager',
        raised_at: new Date().toISOString(),
        answered: false,
        workstream_id: workstream.id,
        urgency: 'high'
      })

      await db.from('workstreams').update({
        status: 'escalated',
        qa_status: 'escalated',
        qa_iterations: iteration,
        updated_at: new Date().toISOString()
      }).eq('id', workstream.id)

      return {
        workstream_id: workstream.id,
        status: 'escalated',
        iterations: iteration,
        passed: false,
        escalated: true,
        failures: finalFailures,
        files_produced: [],
        cost_usd: totalCost,
        duration_ms: Date.now() - startTime
      }
    }

    // ── QA passed — commit to GitHub ──────────────────────────────────────
    let githubPrUrl: string | undefined
    let githubMergeSha: string | undefined
    let filesProduced: string[] = []

    if (passed && Object.keys(builderOutput.code).length > 0) {
      try {
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
        githubPrUrl = commitResult.pr_url
        filesProduced = commitResult.files_committed

        // ── Auto-merge PR after QA pass ───────────────────────────────────
        if (commitResult.pr_number && process.env.GITHUB_TOKEN) {
          try {
            const mergeResult = await mergePR(
              process.env.GITHUB_OWNER!,
              process.env.GITHUB_REPO!,
              process.env.GITHUB_TOKEN!,
              commitResult.pr_number,
              workstream.name
            )
            githubMergeSha = mergeResult.sha

            // Record merge in Supabase
            await db.from('workstreams').update({
              github_merge_sha: githubMergeSha,
              github_merged_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }).eq('id', workstream.id)

          } catch (mergeErr) {
            // Merge failure is non-fatal — PR exists, can be merged manually
            console.error(`[orchestrator] Auto-merge failed for "${workstream.name}":`, mergeErr)

            await db.from('open_questions').insert({
              project_id: projectId,
              question: `Auto-merge failed for workstream "${workstream.name}" — please merge PR manually`,
              context: `PR URL: ${githubPrUrl}. Error: ${String(mergeErr)}`,
              raised_by: 'file_writer',
              raised_at: new Date().toISOString(),
              answered: false,
              workstream_id: workstream.id,
              urgency: 'medium'
            })
          }
        }

      } catch (fileWriteError) {
        console.error('File writer error:', fileWriteError)

        await db.from('open_questions').insert({
          project_id: projectId,
          question: `File writer failed for workstream "${workstream.name}" — code is built but not committed`,
          context: `GitHub API error: ${String(fileWriteError)}. Code is stored in workstream.output_code.`,
          raised_by: 'file_writer',
          raised_at: new Date().toISOString(),
          answered: false,
          workstream_id: workstream.id,
          urgency: 'high'
        })

        filesProduced = Object.keys(builderOutput.code)
      }
    }

    // ── Mark complete ─────────────────────────────────────────────────────
    const updatedTasks = (workstream.tasks || []).map(t => ({ ...t, done: true, done_at: new Date().toISOString() }))

    await db.from('workstreams').update({
      status: 'complete',
      qa_status: 'pass',
      qa_iterations: iteration,
      completion_pct: 100,
      output_files: filesProduced,
      github_pr_url: githubPrUrl,
      tasks: updatedTasks,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    await db.from('agents')
      .update({ status: 'idle', current_workstream: null, completed_at: new Date().toISOString() })
      .eq('current_workstream', workstream.id)

    return {
      workstream_id: workstream.id,
      status: 'complete',
      iterations: iteration,
      passed: true,
      escalated: false,
      failures: [],
      files_produced: filesProduced,
      github_pr_url: githubPrUrl,
      github_merge_sha: githubMergeSha,
      cost_usd: totalCost,
      duration_ms: Date.now() - startTime
    }

  } catch (err) {
    await db.from('workstreams').update({
      status: 'failed',
      qa_status: 'fail',
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    await db.from('agents')
      .update({ status: 'error', error_message: String(err), current_workstream: null })
      .eq('current_workstream', workstream.id)

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
  } finally {
    await releaseLocks(workstream.id)
  }
}

// ─── AUTO-MERGE ───────────────────────────────────────────────────────────────

async function mergePR(
  owner: string,
  repo: string,
  token: string,
  prNumber: number,
  workstreamName: string
): Promise<{ sha: string }> {
  const octokit = new Octokit({ auth: token })

  const { data } = await octokit.rest.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    commit_title: `Forge AI: ${workstreamName}`,
    commit_message: 'Auto-merged after QA pass.',
    merge_method: 'squash',
  })

  if (!data.merged) {
    throw new Error(data.message || 'PR merge returned merged=false')
  }

  return { sha: data.sha || '' }
}

// ─── PHASE EXECUTOR ───────────────────────────────────────────────────────────

export async function runPhase(
  projectId: string,
  phase: number,
  maxParallel: number = parseInt(process.env.MAX_PARALLEL_AGENTS || '3')
): Promise<RunPhaseResult> {
  const startTime = Date.now()
  const db = getServiceClient()

  setCurrentProject(projectId)

  const { data: allWorkstreams } = await db
    .from('workstreams')
    .select('*')
    .eq('project_id', projectId)
    .eq('phase', phase)
    .eq('status', 'queued')

  if (!allWorkstreams || allWorkstreams.length === 0) {
    return {
      phase,
      workstreams_run: 0,
      completed: 0,
      failed: 0,
      escalated: 0,
      results: [],
      total_cost_usd: 0,
      total_duration_ms: 0,
      next_phase_available: false,
      blocked_workstreams: []
    }
  }

  const [specRes, patternsRes] = await Promise.all([
    db.from('living_specs').select('*').eq('project_id', projectId).order('version', { ascending: false }).limit(1),
    db.from('failure_patterns').select('*').eq('project_id', projectId)
  ])

  const livingSpec = specRes.data?.[0]
  const failurePatterns = patternsRes.data || []

  if (!livingSpec) throw new Error('No living spec found for project')

  const completedIds = new Set(
    (await db.from('workstreams').select('id').eq('project_id', projectId).eq('status', 'complete')).data?.map(w => w.id) || []
  )

  const unblocked = allWorkstreams.filter(ws =>
    (ws.blocked_by || []).every((depId: string) => completedIds.has(depId))
  )

  const blocked = allWorkstreams.filter(ws =>
    (ws.blocked_by || []).some((depId: string) => !completedIds.has(depId))
  )

  if (unblocked.length === 0) {
    return {
      phase,
      workstreams_run: 0,
      completed: 0,
      failed: 0,
      escalated: 0,
      results: [],
      total_cost_usd: 0,
      total_duration_ms: 0,
      next_phase_available: false,
      blocked_workstreams: blocked.map(w => w.id)
    }
  }

  const results: RunWorkstreamResult[] = []

  for (let i = 0; i < unblocked.length; i += maxParallel) {
    const batch = unblocked.slice(i, i + maxParallel)

    const batchResults = await Promise.allSettled(
      batch.map(ws => runWorkstream(ws, livingSpec, failurePatterns, projectId))
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
          failures: [result.reason?.message || 'Unknown error'],
          files_produced: [],
          cost_usd: 0,
          duration_ms: 0,
          error: String(result.reason)
        })
      }
    }
  }

  const { data: nextPhaseWs } = await db
    .from('workstreams')
    .select('id')
    .eq('project_id', projectId)
    .eq('phase', phase + 1)
    .eq('status', 'queued')
    .limit(1)

  const totalCost = results.reduce((sum, r) => sum + r.cost_usd, 0)

  await reconcileAfterPhase(projectId, phase, results)

  return {
    phase,
    workstreams_run: results.length,
    completed: results.filter(r => r.status === 'complete').length,
    failed: results.filter(r => r.status === 'failed').length,
    escalated: results.filter(r => r.status === 'escalated').length,
    results,
    total_cost_usd: totalCost,
    total_duration_ms: Date.now() - startTime,
    next_phase_available: (nextPhaseWs?.length || 0) > 0,
    next_phase: (nextPhaseWs?.length || 0) > 0 ? phase + 1 : undefined,
    blocked_workstreams: blocked.map(w => w.id)
  }
}

// ─── POST-PHASE RECONCILIATION ────────────────────────────────────────────────

async function reconcileAfterPhase(
  projectId: string,
  phase: number,
  results: RunWorkstreamResult[]
): Promise<void> {
  const db = getServiceClient()

  const completedCount = results.filter(r => r.status === 'complete').length
  const failedCount = results.filter(r => r.status === 'failed' || r.status === 'escalated').length

  const today = new Date().toISOString().split('T')[0]

  const { data: existingSession } = await db
    .from('sessions')
    .select('*')
    .eq('project_id', projectId)
    .eq('date', today)
    .single()

  const sessionSummary = `Phase ${phase} complete. ${completedCount} workstreams succeeded, ${failedCount} need attention.`
  const filesProduced = results.flatMap(r => r.files_produced)
  const phaseCost = results.reduce((sum, r) => sum + r.cost_usd, 0)

  if (existingSession) {
    await db.from('sessions').update({
      summary: existingSession.summary + ' ' + sessionSummary,
      key_outputs: [...(existingSession.key_outputs || []), ...filesProduced],
      workstreams_completed: [
        ...(existingSession.workstreams_completed || []),
        ...results.filter(r => r.status === 'complete').map(r => r.workstream_id)
      ],
      cost_usd: (existingSession.cost_usd || 0) + phaseCost
    }).eq('id', existingSession.id)
  } else {
    await db.from('sessions').insert({
      project_id: projectId,
      date: today,
      title: `Phase ${phase} Build Session`,
      summary: sessionSummary,
      key_outputs: filesProduced,
      decisions_made: [],
      open_questions: [],
      workstreams_created: [],
      workstreams_completed: results.filter(r => r.status === 'complete').map(r => r.workstream_id),
      token_usage: 0,
      cost_usd: phaseCost
    })
  }
}

// ─── AUTONOMOUS RUN ───────────────────────────────────────────────────────────

export async function runAutonomous(
  projectId: string,
  maxParallel: number = parseInt(process.env.MAX_PARALLEL_AGENTS || '3')
): Promise<{ phases_run: number; total_completed: number; total_failed: number; stopped_reason: string }> {
  const db = getServiceClient()

  setCurrentProject(projectId)

  let phasesRun = 0
  let totalCompleted = 0
  let totalFailed = 0
  let currentPhase = 1
  let stoppedReason = 'all_complete'

  while (true) {
    const costCheck = await checkLimits(projectId)
    if (!costCheck.within_limits) {
      stoppedReason = `cost_limit: ${costCheck.reason}`
      break
    }

    // Find lowest phase with queued work
    const { data: phaseWs } = await db
      .from('workstreams')
      .select('id')
      .eq('project_id', projectId)
      .eq('phase', currentPhase)
      .in('status', ['queued', 'in_progress'])
      .limit(1)

    if (!phaseWs || phaseWs.length === 0) {
      const { data: higherPhases } = await db
        .from('workstreams')
        .select('phase')
        .eq('project_id', projectId)
        .in('status', ['queued'])
        .order('phase')
        .limit(1)

      if (!higherPhases || higherPhases.length === 0) {
        stoppedReason = 'all_complete'
        break
      }

      currentPhase = higherPhases[0].phase
      continue
    }

    const result = await runPhase(projectId, currentPhase, maxParallel)
    phasesRun++
    totalCompleted += result.completed
    totalFailed += result.failed + result.escalated

    // Stop if entire phase failed with no completions
    if (result.completed === 0 && result.workstreams_run > 0) {
      stoppedReason = `phase_${currentPhase}_all_failed`
      break
    }

    // Stop if there are unanswered blocking questions
    const { data: blockingQs } = await db
      .from('open_questions')
      .select('id')
      .eq('project_id', projectId)
      .eq('answered', false)
      .eq('urgency', 'blocking')
      .limit(1)

    if (blockingQs && blockingQs.length > 0) {
      stoppedReason = 'blocking_questions'
      break
    }

    if (result.next_phase_available && result.next_phase) {
      currentPhase = result.next_phase
    } else {
      stoppedReason = 'all_complete'
      break
    }
  }

  return { phases_run: phasesRun, total_completed: totalCompleted, total_failed: totalFailed, stopped_reason: stoppedReason }
}

// ─── FAILURE PATTERN UPSERT ───────────────────────────────────────────────────

async function upsertFailurePattern(
  projectId: string,
  patternType: string,
  description: string,
  resolution: string,
  prevention: string,
  workstreamId: string
): Promise<void> {
  const db = getServiceClient()

  const { data: existing } = await db
    .from('failure_patterns')
    .select('*')
    .eq('project_id', projectId)
    .eq('pattern_type', patternType)
    .single()

  if (existing) {
    await db.from('failure_patterns').update({
      occurrence_count: existing.occurrence_count + 1,
      last_seen: new Date().toISOString(),
      workstream_ids: [...(existing.workstream_ids || []), workstreamId],
      resolution: resolution || existing.resolution,
      prevention: prevention || existing.prevention
    }).eq('id', existing.id)
  } else {
    await db.from('failure_patterns').insert({
      project_id: projectId,
      pattern_type: patternType,
      description,
      trigger_context: description,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      occurrence_count: 1,
      resolution,
      prevention,
      workstream_ids: [workstreamId],
      severity: 'medium'
    })
  }
}

// ─── MODEL NAME CONSTANTS ─────────────────────────────────────────────────────

const BUILDER_MODEL_NAME = process.env.BUILDER_MODEL || 'claude-sonnet-4-6'
const QA_MODEL_NAME      = process.env.QA_MODEL      || 'claude-sonnet-4-6'
