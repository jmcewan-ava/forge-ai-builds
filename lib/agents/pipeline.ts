/**
 * FORGE AI — Dream Team Pipeline
 *
 * The full 8-agent build pipeline:
 *
 *   Brief → [PM Quality Check]
 *        → [Discovery: map codebase]
 *        → [Architect: plan changes]
 *        → [Consultant: resolve ambiguity if needed]
 *        → [Surgeon: execute manifest]
 *        → [TypeChecker: tsc validation]
 *        → [Surgeon: fix type errors (loop)]
 *        → [BehaviourQA: did we build what was asked?]
 *        → [Surgeon: fix QA failures (loop)]
 *        → [commit + PR + auto-merge]
 *        → [PM: poll Vercel until green]
 *        → [ProductAdvisor: file next improvements]
 *
 * Nobody ships broken work. The PM sees a red build and says "we're not done."
 */

import { runDiscoveryAgent } from './discovery'
import { runArchitectAgent } from './architect'
import { runSurgeonAgent } from './surgeon'
import { runTypeCheckerAgent, formatTypeErrorsForSurgeon } from './type-checker'
import { runBehaviourQAAgent } from './behaviour-qa'
import { runProductAdvisorAgent } from './product-advisor'
import { runConsultantAgent } from './consultant'
import { runPMLifecycle } from './product-manager'
import { commitFiles } from '../file-writer'
import { Octokit } from '@octokit/rest'
import { getServiceClient } from '../supabase'
import { checkLimits, recordUsage, setCurrentProject } from '../cost-controller'
import { acquireLocks, releaseLocks } from '../file-lock'
import type { Workstream, LivingSpec, FailurePattern } from '../types'

export interface DreamTeamResult {
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
  // Dream team extras
  pipeline_stages: PipelineStage[]
  type_check_passed: boolean
  behaviour_qa_passed: boolean
  deploy_confirmed: boolean
  advisor_briefs_filed: number
}

export interface PipelineStage {
  agent: string
  status: 'skipped' | 'running' | 'passed' | 'failed' | 'fixed'
  duration_ms: number
  notes?: string
}

const GITHUB_CONFIG = () => ({
  owner: process.env.GITHUB_OWNER!,
  repo: process.env.GITHUB_REPO!,
  token: process.env.GITHUB_TOKEN!,
  defaultBranch: 'main'
})

// Model names for cost tracking
const SURGEON_MODEL_NAME = process.env.SURGEON_MODEL || 'claude-sonnet-4-6'
const ARCHITECT_MODEL_NAME = process.env.ARCHITECT_MODEL || 'claude-opus-4-6'

export async function runDreamTeamPipeline(
  workstream: Workstream,
  livingSpec: LivingSpec,
  failurePatterns: FailurePattern[],
  projectId: string
): Promise<DreamTeamResult> {

  const startTime = Date.now()
  const db = getServiceClient()
  setCurrentProject(projectId)

  // Fetch project settings (auto_merge_prs etc)
  const { data: projectRow } = await db.from('projects').select('*').eq('id', projectId).single()

  const stages: PipelineStage[] = []
  let totalCost = 0
  let iteration = 0
  const MAX_ITERATIONS = parseInt(process.env.MAX_QA_ITERATIONS || '3')

  const logStage = (agent: string, status: PipelineStage['status'], duration_ms: number, notes?: string) => {
    stages.push({ agent, status, duration_ms, notes })
    console.log(`[DreamTeam:${workstream.name}] ${agent}: ${status}${notes ? ` — ${notes}` : ''}`)
  }

  // Helper to push a log line to Supabase for dashboard visibility
  const log = async (msg: string) => {
    try {
      await db.from('agent_logs').insert({
        project_id: projectId,
        workstream_id: workstream.id,
        agent_role: 'orchestrator',
        model: 'system',
        response_text: msg,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        iteration
      })
    } catch { /* non-critical */ }
  }

  // ── Cost check ──────────────────────────────────────────────────────────────
  const costCheck = await checkLimits(projectId)
  if (!costCheck.within_limits) {
    return makeFailResult(workstream.id, `Cost limit: ${costCheck.reason}`, stages, startTime, totalCost)
  }

  // ── File locks ──────────────────────────────────────────────────────────────
  const estimatedFiles = workstream.estimated_files || []
  if (estimatedFiles.length > 0) {
    const locked = await acquireLocks(estimatedFiles, workstream.id, 120000)
    if (!locked) {
      await db.from('workstreams').update({ status: 'queued', updated_at: new Date().toISOString() }).eq('id', workstream.id)
      return makeFailResult(workstream.id, 'File lock conflict — requeued', stages, startTime, totalCost)
    }
  }

  // Mark in_progress
  await db.from('workstreams').update({
    status: 'in_progress',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', workstream.id)

  try {

    // ══════════════════════════════════════════════════════════════════════════
    // STAGE 1: DISCOVERY
    // Map every exported function, every import, every dependency
    // ══════════════════════════════════════════════════════════════════════════
    await log('🔍 Discovery: mapping codebase...')
    const discoveryStart = Date.now()

    const discoveryReport = await runDiscoveryAgent(
      workstream.name,
      workstream.brief,
      workstream.estimated_files?.length ? workstream.estimated_files : undefined
    )

    logStage('Discovery', 'passed', Date.now() - discoveryStart,
      `Mapped ${discoveryReport.files.length} files, ${discoveryReport.potential_risks.length} risks identified`)

    if (discoveryReport.potential_risks.length > 0) {
      await log(`⚠ Discovery risks: ${discoveryReport.potential_risks.slice(0, 3).join(' | ')}`)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STAGE 2: ARCHITECT
    // Plan exactly what changes are needed — not code, just decisions
    // ══════════════════════════════════════════════════════════════════════════
    await log('🏗 Architect: planning changes...')
    const archStart = Date.now()

    let manifest = await runArchitectAgent(
      workstream.name,
      workstream.brief,
      discoveryReport,
      livingSpec
    )

    logStage('Architect', 'passed', Date.now() - archStart,
      `${manifest.files_to_change.length} files to change, ${manifest.risks.length} risks flagged`)

    // Check if Architect needs Consultant
    const architectRisks = manifest.risks || []
    const needsConsultant = architectRisks.some(r =>
      r.toLowerCase().includes('ambiguous') ||
      r.toLowerCase().includes('unclear') ||
      r.toLowerCase().includes('two approaches') ||
      r.toLowerCase().includes('alternative')
    )

    if (needsConsultant && architectRisks.length > 0) {
      await log('🎯 Consultant: resolving architectural ambiguity...')
      const consultStart = Date.now()

      const recommendation = await runConsultantAgent(
        architectRisks[0],
        `Workstream: ${workstream.name}\nBrief: ${workstream.brief}\nArchitect approach: ${manifest.approach}`,
        livingSpec,
        workstream.name
      )

      logStage('Consultant', 'passed', Date.now() - consultStart,
        `Recommended: ${recommendation.decision.slice(0, 100)}`)

      // Log the recommendation for transparency
      await log(`📋 Consultant says: ${recommendation.decision}`)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SURGERY + TYPE CHECK + BEHAVIOUR QA LOOP
    // ══════════════════════════════════════════════════════════════════════════
    let surgeonOutput = { files: {} as Record<string, string>, edits_applied: 0, edits_skipped: [] as string[], new_files: [] as string[], notes: '' }
    let typeCheckPassed = false
    let behaviourQAPassed = false
    let finalFailures: string[] = []
    let escalated = false
    let currentBrief = workstream.brief

    while (iteration < MAX_ITERATIONS && !behaviourQAPassed && !escalated) {

      // ── SURGEON ─────────────────────────────────────────────────────────────
      await log(`🔪 Surgeon (iteration ${iteration + 1}): executing manifest...`)
      const surgeonStart = Date.now()

      surgeonOutput = await runSurgeonAgent(manifest, discoveryReport, livingSpec)

      logStage('Surgeon', surgeonOutput.edits_applied > 0 ? 'passed' : 'failed',
        Date.now() - surgeonStart,
        surgeonOutput.notes)

      if (surgeonOutput.edits_applied === 0 && Object.keys(surgeonOutput.files).length === 0) {
        finalFailures = ['Surgeon produced no output — manifest may have unreachable find strings']
        escalated = iteration >= MAX_ITERATIONS - 1
        if (!escalated) { iteration++; continue }
        break
      }

      // ── TYPE CHECKER ─────────────────────────────────────────────────────────
      await log(`🔬 TypeChecker: validating TypeScript...`)
      const tcStart = Date.now()

      const typeResult = await runTypeCheckerAgent(surgeonOutput, manifest, discoveryReport)
      typeCheckPassed = typeResult.passed

      if (typeResult.passed) {
        logStage('TypeChecker', 'passed', Date.now() - tcStart,
          `${typeResult.files_checked.length} files checked`)
        await log(`✅ TypeCheck passed`)
      } else {
        const errSummary = typeResult.errors.slice(0, 3).map(e => e.error).join(' | ')
        logStage('TypeChecker', 'failed', Date.now() - tcStart,
          `${typeResult.errors.length} errors: ${errSummary}`)
        await log(`❌ TypeCheck failed: ${errSummary}`)

        // Feed errors back to Surgeon for another pass
        const typeErrors = formatTypeErrorsForSurgeon(typeResult)

        // Update manifest with type error context for next surgeon pass
        // We patch the brief to include the type errors
        if (iteration < MAX_ITERATIONS - 1) {
          // Update the architect's approach with type error context
          manifest = {
            ...manifest,
            approach: `${manifest.approach}\n\nTYPE ERRORS TO FIX (iteration ${iteration + 1}):\n${typeErrors}`,
            risks: [...manifest.risks, `Type errors found: ${typeResult.errors.length} errors to fix`]
          }
          iteration++
          continue  // Back to Surgeon with error context
        } else {
          finalFailures = typeResult.errors.map(e => `[${e.file}] ${e.error}`)
          escalated = true
          break
        }
      }

      // ── BEHAVIOUR QA ─────────────────────────────────────────────────────────
      await log(`🧪 BehaviourQA: checking intent was met...`)
      const qaStart = Date.now()

      const qaResult = await runBehaviourQAAgent(
        workstream.name,
        currentBrief,
        surgeonOutput,
        manifest,
        iteration
      )

      behaviourQAPassed = qaResult.passed

      if (qaResult.passed) {
        logStage('BehaviourQA', 'passed', Date.now() - qaStart,
          `${qaResult.requirements_met.length} requirements met`)
        await log(`✅ BehaviourQA passed: ${qaResult.requirements_met.join(', ')}`)
      } else {
        const missing = qaResult.requirements_missing.join(', ')
        logStage('BehaviourQA', 'failed', Date.now() - qaStart, missing)
        await log(`❌ BehaviourQA failed: missing ${missing}`)

        if (qaResult.escalate || iteration >= MAX_ITERATIONS - 1) {
          escalated = true
          finalFailures = [
            ...qaResult.requirements_missing.map(r => `Missing: ${r}`),
            ...qaResult.bugs_found
          ]
          break
        }

        // Use revised brief for next iteration
        if (qaResult.revised_brief) {
          currentBrief = qaResult.revised_brief
          // Also update the manifest approach
          manifest = {
            ...manifest,
            approach: `${manifest.approach}\n\nQA FEEDBACK (iteration ${iteration + 1}):\nMissing: ${missing}`
          }
        }
      }

      iteration++
    }

    // ══════════════════════════════════════════════════════════════════════════
    // POST-LOOP: COMMIT OR FAIL
    // ══════════════════════════════════════════════════════════════════════════

    const filesProduced = Object.keys(surgeonOutput.files).filter(f => surgeonOutput.files[f] !== '__DELETE__')

    if (!behaviourQAPassed || escalated) {
      await db.from('workstreams').update({
        status: escalated ? 'escalated' : 'failed',
        qa_status: escalated ? 'escalated' : 'fail',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', workstream.id)

      await releaseLocks(workstream.id)

      return {
        workstream_id: workstream.id,
        status: escalated ? 'escalated' : 'failed',
        iterations: iteration,
        passed: false,
        escalated,
        failures: finalFailures,
        files_produced: filesProduced,
        cost_usd: totalCost,
        duration_ms: Date.now() - startTime,
        pipeline_stages: stages,
        type_check_passed: typeCheckPassed,
        behaviour_qa_passed: behaviourQAPassed,
        deploy_confirmed: false,
        advisor_briefs_filed: 0
      }
    }

    // ── COMMIT TO GITHUB ─────────────────────────────────────────────────────
    await log(`📦 Committing ${filesProduced.length} files to GitHub...`)

    // Update workstream with output code
    await db.from('workstreams').update({
      output_code: surgeonOutput.files,
      qa_status: 'pass',
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    const commitResult = await commitFiles(
      workstream.id,
      workstream.name,
      surgeonOutput.files,
      GITHUB_CONFIG()
    )

    await log(`🔗 PR opened: ${commitResult.pr_url}`)

    // ── AUTO-MERGE ───────────────────────────────────────────────────────────
    let mergeSha: string | undefined

    if (commitResult.pr_url && (projectRow?.auto_merge_prs === true || process.env.AUTO_MERGE_PRS === 'true')) {
      try {
        const octokit = new Octokit({ auth: process.env.GITHUB_PAT || process.env.GITHUB_TOKEN })
        const { owner, repo } = GITHUB_CONFIG()
        const prNumber = parseInt(commitResult.pr_url.split('/').pop() || '0')

        if (prNumber > 0) {
          await log(`🔀 Auto-merging PR #${prNumber}...`)
          const mergeResult = await octokit.pulls.merge({
            owner, repo,
            pull_number: prNumber,
            merge_method: 'squash'
          })
          mergeSha = mergeResult.data.sha
          await log(`✅ Merged: ${mergeSha?.slice(0, 7)}`)
        }
      } catch (mergeErr) {
        console.error('[DreamTeam] Auto-merge failed:', mergeErr)
        await log(`⚠ Auto-merge failed: ${String(mergeErr)}`)
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PM AGENT: Monitor deployment to green
    // The PM does not close the workstream until the build is green
    // ══════════════════════════════════════════════════════════════════════════
    let deployConfirmed = false
    let advisorBriefsCount = 0

    await log(`👔 PM Agent: monitoring Vercel deployment...`)
    const pmStart = Date.now()

    const pmResult = await runPMLifecycle(workstream, projectId, commitResult.pr_url, mergeSha)
    logStage('ProductManager', pmResult.lifecycle_stage === 'deploy_green' ? 'passed' : 'failed',
      Date.now() - pmStart, pmResult.message)

    if (pmResult.lifecycle_stage === 'deploy_green') {
      deployConfirmed = true
      await log(`🚀 Live: ${pmResult.vercel_status?.url || 'deployed'}`)

      // ── PRODUCT ADVISOR: File next improvements ──────────────────────────
      try {
        await log(`🧭 Product Advisor: reviewing for improvements...`)
        const advisorStart = Date.now()

        const { data: recentWs } = await db
          .from('workstreams')
          .select('*')
          .eq('project_id', projectId)
          .order('updated_at', { ascending: false })
          .limit(20)

        const advisorResult = await runProductAdvisorAgent(
          livingSpec.content.vision,
          livingSpec,
          recentWs || [],
          pmResult.vercel_status?.url || process.env.DEPLOYMENT_URL || ''
        )

        logStage('ProductAdvisor', 'passed', Date.now() - advisorStart,
          `${advisorResult.briefs.length} improvements identified, health: ${advisorResult.overall_health}`)

        // Auto-submit safe small briefs
        const autoSubmit = advisorResult.briefs.filter(b => b.auto_submit && b.priority !== 'P0')
        for (const brief of autoSubmit.slice(0, 2)) {  // Max 2 auto-briefs per run
          await db.from('open_questions').insert({
            project_id: projectId,
            question: `[Product Advisor] ${brief.title}`,
            context: `Brief: ${brief.brief}\n\nWhy: ${brief.why}\nObserved: ${brief.what_triggered_it}`,
            urgency: brief.priority === 'P1' ? 'high' : brief.priority === 'P2' ? 'medium' : 'low',
            asked_by: 'product_advisor',
            answered: false,
            raised_at: new Date().toISOString()
          })
          advisorBriefsCount++
          await log(`💡 Advisor brief filed: ${brief.title}`)
        }

      } catch (advisorErr) {
        console.error('[DreamTeam] Product Advisor failed:', advisorErr)
      }

    } else if (pmResult.lifecycle_stage === 'deploy_failed') {
      await log(`💥 Deploy failed: ${pmResult.message}`)
      await log(`📋 Bug brief filed for requeue`)

      // PM already marked workstream escalated and filed open question
      await releaseLocks(workstream.id)

      return {
        workstream_id: workstream.id,
        status: 'escalated',
        iterations: iteration,
        passed: false,
        escalated: true,
        failures: [`Vercel deploy failed: ${pmResult.message}`],
        files_produced: filesProduced,
        github_pr_url: commitResult.pr_url,
        github_merge_sha: mergeSha,
        cost_usd: totalCost,
        duration_ms: Date.now() - startTime,
        pipeline_stages: stages,
        type_check_passed: typeCheckPassed,
        behaviour_qa_passed: behaviourQAPassed,
        deploy_confirmed: false,
        advisor_briefs_filed: 0
      }
    }

    // ── MARK COMPLETE ────────────────────────────────────────────────────────
    await db.from('workstreams').update({
      status: 'complete',
      qa_status: 'pass',
      output_files: filesProduced,
      github_pr_url: commitResult.pr_url || null,
      github_merge_sha: mergeSha || null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    await releaseLocks(workstream.id)

    await log(`🎉 Workstream complete after ${iteration} iteration(s)`)

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
      duration_ms: Date.now() - startTime,
      pipeline_stages: stages,
      type_check_passed: typeCheckPassed,
      behaviour_qa_passed: behaviourQAPassed,
      deploy_confirmed: deployConfirmed,
      advisor_briefs_filed: advisorBriefsCount
    }

  } catch (err) {
    console.error('[DreamTeam] Pipeline error:', err)
    await releaseLocks(workstream.id).catch(() => {})
    await db.from('workstreams').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', workstream.id)

    return makeFailResult(workstream.id, String(err), stages, startTime, totalCost)
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeFailResult(
  workstream_id: string,
  error: string,
  stages: PipelineStage[],
  startTime: number,
  totalCost: number
): DreamTeamResult {
  return {
    workstream_id,
    status: 'failed',
    iterations: 0,
    passed: false,
    escalated: false,
    failures: [error],
    files_produced: [],
    cost_usd: totalCost,
    duration_ms: Date.now() - startTime,
    error,
    pipeline_stages: stages,
    type_check_passed: false,
    behaviour_qa_passed: false,
    deploy_confirmed: false,
    advisor_briefs_filed: 0
  }
}
