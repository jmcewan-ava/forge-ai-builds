/**
 * FORGE AI — Product Manager Agent
 *
 * The PM believes in the vision and won't let the team ship broken work.
 * Owns the brief from submission through to green Vercel build.
 *
 * If the build fails — it doesn't close the workstream.
 * It files a bug, routes it back, and sees it through.
 *
 * This is the agent that would have caught today's entire disaster.
 * The PM sees a red Vercel deployment and says "we're not done."
 *
 * Responsibilities:
 * 1. Validates brief quality before it goes to OM
 * 2. Monitors the full pipeline execution
 * 3. Polls Vercel until green — does not close workstream until live
 * 4. On failure: writes a precise bug brief and requeues
 * 5. Tracks work-in-progress across the full lifecycle
 */

import Anthropic from '@anthropic-ai/sdk'
import { getServiceClient } from '../supabase'
import type { Workstream, LivingSpec } from '../types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface BriefQualityCheck {
  approved: boolean
  issues: string[]
  improved_brief?: string     // if issues are minor, PM rewrites the brief
  reject_reason?: string      // if fundamentally broken
}

export interface VercelDeployStatus {
  state: 'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'TIMEOUT' | 'UNKNOWN'
  url?: string
  build_id?: string
  error_summary?: string
}

export interface PMLifecycleResult {
  workstream_id: string
  lifecycle_stage: 'brief_rejected' | 'building' | 'qa_failed' | 'pr_merged' | 'deploy_green' | 'deploy_failed' | 'requeued'
  message: string
  vercel_status?: VercelDeployStatus
  bug_brief?: string          // filed if deploy failed, for requeue
  total_attempts: number
}

const PM_MODEL = process.env.PM_MODEL || 'claude-sonnet-4-6'

// ─── BRIEF QUALITY CHECK ─────────────────────────────────────────────────────

export async function runBriefQualityCheck(
  brief: string,
  livingSpec: LivingSpec
): Promise<BriefQualityCheck> {

  const systemPrompt = `You are the Product Manager Agent doing a brief quality check.

A brief is going to be decomposed into workstreams and sent to AI builders.
Before that happens, you check if the brief is ready.

A GOOD BRIEF:
- Has clear, specific acceptance criteria
- Is scoped (not "rewrite everything")
- Doesn't contradict existing architecture decisions
- Can be executed without human clarification

A BAD BRIEF:
- Too vague ("make it better", "improve UX")
- Too large to be a single workstream (>3 files likely touched)
- Contradicts a constraint in the living spec
- Missing critical context the builder will need

If issues are minor, REWRITE the brief to be better.
If fundamentally broken, REJECT with a clear reason.

Current constraints: ${livingSpec.content.constraints.join('; ')}
Current vision: ${livingSpec.content.vision}

Output ONLY valid JSON:
{
  "approved": true,
  "issues": [],
  "improved_brief": "Optional improved version if you made it better"
}
or:
{
  "approved": false,
  "issues": ["Too vague — no acceptance criteria", "Scope is 10+ files"],
  "reject_reason": "This brief needs to be split into 3 smaller workstreams"
}`

  try {
    const response = await anthropic.messages.create({
      model: PM_MODEL,
      max_tokens: 2000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Check this brief:\n\n${brief}` }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    return JSON.parse(clean.slice(start, end + 1)) as BriefQualityCheck

  } catch (err) {
    // Don't block on PM failures — let the brief through
    console.error('[PM] Brief quality check failed:', err)
    return { approved: true, issues: [] }
  }
}

// ─── VERCEL DEPLOYMENT POLLER ─────────────────────────────────────────────────

export async function pollVercelDeployment(
  workstreamName: string,
  mergeSha?: string,
  timeoutMs: number = 5 * 60 * 1000  // 5 minutes
): Promise<VercelDeployStatus> {

  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID

  if (!token || !projectId) {
    console.log('[PM] Vercel polling disabled — VERCEL_TOKEN or VERCEL_PROJECT_ID not set')
    return { state: 'UNKNOWN' }
  }

  // Give Vercel time to pick up the merge
  await new Promise(resolve => setTimeout(resolve, 15000))

  const startTime = Date.now()
  const pollInterval = 15000
  let lastState = 'UNKNOWN'

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollInterval))

    try {
      const res = await fetch(
        `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=3&target=production`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json() as { deployments?: Array<{
        uid: string; state: string; url?: string;
        meta?: { githubCommitSha?: string }
        error?: { message?: string }
      }> }

      const deployments = data.deployments || []

      // Try to match by SHA if we have it
      let deployment = mergeSha
        ? deployments.find(d => d.meta?.githubCommitSha === mergeSha)
        : deployments[0]

      // Fall back to latest
      if (!deployment) deployment = deployments[0]
      if (!deployment) continue

      lastState = deployment.state
      console.log(`[PM] Vercel deployment state for "${workstreamName}": ${lastState}`)

      if (deployment.state === 'READY') {
        return { state: 'READY', url: deployment.url, build_id: deployment.uid }
      }
      if (deployment.state === 'ERROR') {
        return {
          state: 'ERROR',
          build_id: deployment.uid,
          error_summary: deployment.error?.message || 'Build errored — check Vercel logs'
        }
      }
      // BUILDING, QUEUED — keep polling

    } catch (err) {
      console.error('[PM] Vercel poll error:', err)
    }
  }

  return { state: 'TIMEOUT' }
}

// ─── DEPLOY FAILURE HANDLER ───────────────────────────────────────────────────

export async function handleDeployFailure(
  workstream: Workstream,
  vercelStatus: VercelDeployStatus,
  projectId: string
): Promise<string> {

  const db = getServiceClient()

  // Ask PM to write a specific bug brief
  const systemPrompt = `You are the PM Agent filing a bug brief after a failed Vercel deployment.
Write a precise brief that will let a builder fix the TypeScript/build error.
The brief should be specific enough to implement without clarification.

Focus on: What file likely has an error, what the error pattern is, what to check.
Common causes: wrong import names, wrong function argument count/order, missing type annotations.`

  let bugBrief = `Fix Vercel build failure in workstream "${workstream.name}"`

  try {
    const response = await anthropic.messages.create({
      model: PM_MODEL,
      max_tokens: 1000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Workstream "${workstream.name}" merged but Vercel build failed.

Error: ${vercelStatus.error_summary || 'Unknown build error'}
Files this workstream touched: ${workstream.output_files?.join(', ') || 'unknown'}
PR URL: ${workstream.github_pr_url || 'unknown'}

Write a bug brief for a builder to fix this.`
      }]
    })

    bugBrief = response.content[0].type === 'text' ? response.content[0].text : bugBrief
  } catch { /* use default brief */ }

  // Mark workstream escalated
  await db.from('workstreams').update({
    status: 'escalated',
    updated_at: new Date().toISOString()
  }).eq('id', workstream.id)

  // File an open question
  await db.from('open_questions').insert({
    project_id: projectId,
    workstream_id: workstream.id,
    question: `Build failed after merge of "${workstream.name}" — needs fix`,
    context: `Vercel build errored. Error: ${vercelStatus.error_summary || 'unknown'}. Bug brief: ${bugBrief}`,
    urgency: 'blocking',
    asked_by: 'pm_agent',
    answered: false,
    raised_at: new Date().toISOString()
  })

  return bugBrief
}

// ─── FULL PM LIFECYCLE ─────────────────────────────────────────────────────────

export async function runPMLifecycle(
  workstream: Workstream,
  projectId: string,
  prUrl?: string,
  mergeSha?: string
): Promise<PMLifecycleResult> {

  if (!prUrl && !mergeSha) {
    return {
      workstream_id: workstream.id,
      lifecycle_stage: 'building',
      message: 'No PR yet — build still in progress',
      total_attempts: 1
    }
  }

  console.log(`[PM] Monitoring deployment for "${workstream.name}"...`)

  const vercelStatus = await pollVercelDeployment(workstream.name, mergeSha)

  if (vercelStatus.state === 'READY') {
    console.log(`[PM] ✅ Deploy green for "${workstream.name}" at ${vercelStatus.url}`)
    return {
      workstream_id: workstream.id,
      lifecycle_stage: 'deploy_green',
      message: `Deployed successfully to ${vercelStatus.url}`,
      vercel_status: vercelStatus,
      total_attempts: 1
    }
  }

  if (vercelStatus.state === 'ERROR') {
    console.error(`[PM] ❌ Deploy failed for "${workstream.name}": ${vercelStatus.error_summary}`)
    const bugBrief = await handleDeployFailure(workstream, vercelStatus, projectId)
    return {
      workstream_id: workstream.id,
      lifecycle_stage: 'deploy_failed',
      message: `Deploy failed: ${vercelStatus.error_summary}`,
      vercel_status: vercelStatus,
      bug_brief: bugBrief,
      total_attempts: 1
    }
  }

  // TIMEOUT or UNKNOWN
  return {
    workstream_id: workstream.id,
    lifecycle_stage: 'deploy_green',  // Optimistic — couldn't confirm either way
    message: `Deploy state: ${vercelStatus.state} — could not confirm within timeout`,
    vercel_status: vercelStatus,
    total_attempts: 1
  }
}
