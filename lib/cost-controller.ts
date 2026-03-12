/**
 * FORGE AI — Cost Controller v2
 *
 * Tracks API usage across agents. Prevents runaway costs.
 * v2: Persists every call to Supabase `api_costs` table so costs
 *     survive Vercel cold starts and show correctly in the UI.
 */

import { getServiceClient } from './supabase'
import type { CostRecord, CostLimitCheck } from './types'

// ─── TOKEN PRICING ────────────────────────────────────────────────────────────

const TOKEN_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':          { input: 3.0  / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-sonnet-4-6':        { input: 0.30 / 1_000_000, output: 1.50 / 1_000_000 },
  'claude-haiku-4-5-20251001':{ input: 0.08 / 1_000_000, output: 0.40 / 1_000_000 },
  'deterministic':            { input: 0,                 output: 0 },
}

function getRate(model: string) {
  return TOKEN_RATES[model] || TOKEN_RATES['claude-sonnet-4-6']
}

// ─── IN-MEMORY WRITE-THROUGH CACHE ───────────────────────────────────────────

interface UsageRecord {
  agentRole: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  timestamp: Date
  projectId?: string
}

const memoryCache = new Map<string, UsageRecord[]>()
let currentProjectId = ''

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export async function recordUsage(
  agentRole: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  projectId?: string
): Promise<CostRecord> {
  const rate = getRate(model)
  const cost = (inputTokens * rate.input) + (outputTokens * rate.output)
  const pid = projectId || currentProjectId

  const record: UsageRecord = { agentRole, model, inputTokens, outputTokens, cost, timestamp: new Date(), projectId: pid }
  if (!memoryCache.has(pid)) memoryCache.set(pid, [])
  memoryCache.get(pid)!.push(record)

  // Persist to Supabase (fire-and-forget — never blocks the agent)
  if (pid) {
    persistCostRecord(pid, agentRole, model, inputTokens, outputTokens, cost).catch(err => {
      console.error('[cost-controller] Failed to persist cost record:', err)
    })
  }

  const sessionTotal = getMemoryTotal(pid)
  const projectTotal = await getProjectCostFromSupabase(pid)
  const limitCheck = checkLimitsSync(sessionTotal, projectTotal)

  return {
    session_delta_usd: cost,
    session_total_usd: sessionTotal,
    project_total_usd: projectTotal,
    limit_hit: !limitCheck.within_limits,
    limit_reason: limitCheck.reason
  }
}

export async function getSessionCost(projectId?: string): Promise<number> {
  return getMemoryTotal(projectId || currentProjectId)
}

export async function getProjectCost(projectId?: string): Promise<number> {
  if (!projectId && !currentProjectId) return 0
  return getProjectCostFromSupabase(projectId || currentProjectId)
}

export async function checkLimits(projectId?: string): Promise<CostLimitCheck> {
  const pid = projectId || currentProjectId
  const sessionTotal = getMemoryTotal(pid)
  const projectTotal = pid ? await getProjectCostFromSupabase(pid) : 0
  return checkLimitsSync(sessionTotal, projectTotal)
}

export function setCurrentProject(projectId: string): void {
  currentProjectId = projectId
}

export async function getCostBreakdown(
  projectId: string
): Promise<Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>> {
  if (!projectId) return {}
  try {
    const db = getServiceClient()
    const { data, error } = await db
      .from('api_costs')
      .select('agent_role, input_tokens, output_tokens, cost_usd')
      .eq('project_id', projectId)
    if (error || !data) return {}

    const breakdown: Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }> = {}
    for (const row of data) {
      const key = row.agent_role as string
      if (!breakdown[key]) breakdown[key] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 }
      breakdown[key].calls++
      breakdown[key].input_tokens += row.input_tokens || 0
      breakdown[key].output_tokens += row.output_tokens || 0
      breakdown[key].cost_usd += row.cost_usd || 0
    }
    return breakdown
  } catch {
    return {}
  }
}

// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

function getMemoryTotal(projectId: string): number {
  return (memoryCache.get(projectId) || []).reduce((sum, r) => sum + r.cost, 0)
}

async function getProjectCostFromSupabase(projectId: string): Promise<number> {
  if (!projectId) return 0
  try {
    const db = getServiceClient()
    const { data, error } = await db.from('api_costs').select('cost_usd').eq('project_id', projectId)
    if (error || !data) return 0
    return data.reduce((sum: number, row: { cost_usd: number }) => sum + (row.cost_usd || 0), 0)
  } catch {
    return 0
  }
}

async function persistCostRecord(
  projectId: string, agentRole: string, model: string,
  inputTokens: number, outputTokens: number, costUsd: number
): Promise<void> {
  const db = getServiceClient()
  await db.from('api_costs').insert({
    project_id: projectId,
    agent_role: agentRole,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    created_at: new Date().toISOString()
  })
}

function checkLimitsSync(sessionTotal: number, projectTotal: number): CostLimitCheck {
  const sessionLimit = parseFloat(process.env.SESSION_COST_LIMIT_USD || '10')
  const projectLimit = parseFloat(process.env.TOTAL_COST_LIMIT_USD || '100')

  if (sessionTotal >= sessionLimit) {
    return {
      within_limits: false,
      reason: `Session cost $${sessionTotal.toFixed(3)} reached limit $${sessionLimit}. Answer open questions to continue.`,
      session_total_usd: sessionTotal, project_total_usd: projectTotal
    }
  }
  if (projectTotal >= projectLimit) {
    return {
      within_limits: false,
      reason: `Project total $${projectTotal.toFixed(2)} reached limit $${projectLimit}. Raise TOTAL_COST_LIMIT_USD to continue.`,
      session_total_usd: sessionTotal, project_total_usd: projectTotal
    }
  }
  return { within_limits: true, session_total_usd: sessionTotal, project_total_usd: projectTotal }
}
