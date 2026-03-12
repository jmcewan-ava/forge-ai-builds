/**
 * FORGE AI — Cost Controller
 * 
 * Tracks API usage across agents. Prevents runaway costs.
 * Uses in-memory state — resets on server restart.
 * For persistent cost tracking, session.cost_usd in Supabase is the source of truth.
 */

import type { CostRecord, CostLimitCheck } from './types'

// ─── TOKEN PRICING ────────────────────────────────────────────────────────────

const TOKEN_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 3.0  / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-sonnet-4-6': { input: 0.30 / 1_000_000, output: 1.50 / 1_000_000 },
  'claude-haiku-4-5-20251001':  { input: 0.08 / 1_000_000, output: 0.40 / 1_000_000 },
  'deterministic':     { input: 0, output: 0 }
}

function getRate(model: string) {
  return TOKEN_RATES[model] || TOKEN_RATES['claude-sonnet-4-6']
}

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────────

interface UsageRecord {
  agentRole: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  timestamp: Date
  sessionId?: string
}

const sessionUsage = new Map<string, UsageRecord[]>()
let currentSessionId = `session-${Date.now()}`
let projectTotalUsd = 0

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Record token usage after an LLM call.
 * Returns updated cost totals and whether limits are hit.
 */
export async function recordUsage(
  agentRole: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<CostRecord> {
  const rate = getRate(model)
  const cost = (inputTokens * rate.input) + (outputTokens * rate.output)

  const record: UsageRecord = {
    agentRole, model, inputTokens, outputTokens, cost,
    timestamp: new Date(),
    sessionId: currentSessionId
  }

  if (!sessionUsage.has(currentSessionId)) {
    sessionUsage.set(currentSessionId, [])
  }
  sessionUsage.get(currentSessionId)!.push(record)
  projectTotalUsd += cost

  const sessionTotal = getSessionCostSync(currentSessionId)
  const limitCheck = checkLimitsSync(sessionTotal, projectTotalUsd)

  return {
    session_delta_usd: cost,
    session_total_usd: sessionTotal,
    project_total_usd: projectTotalUsd,
    limit_hit: !limitCheck.within_limits,
    limit_reason: limitCheck.reason
  }
}

/**
 * Get current session cost. Async wrapper for API route compatibility.
 */
export async function getSessionCost(sessionId?: string): Promise<number> {
  return getSessionCostSync(sessionId || currentSessionId)
}

/**
 * Get total project cost (in-memory, since server start).
 */
export async function getProjectCost(): Promise<number> {
  return projectTotalUsd
}

/**
 * Check if costs are within limits.
 */
export async function checkLimits(): Promise<CostLimitCheck> {
  const sessionTotal = getSessionCostSync(currentSessionId)
  return checkLimitsSync(sessionTotal, projectTotalUsd)
}

/**
 * Start a new session (called when new brief is submitted).
 */
export function startNewSession(): string {
  currentSessionId = `session-${Date.now()}`
  return currentSessionId
}

/**
 * Get breakdown by agent role for current session.
 */
export function getSessionBreakdown(): Array<{
  role: string; model: string; calls: number; total_usd: number
}> {
  const records = sessionUsage.get(currentSessionId) || []
  const byRole = new Map<string, { calls: number; total_usd: number; model: string }>()

  for (const r of records) {
    const key = r.agentRole
    if (!byRole.has(key)) byRole.set(key, { calls: 0, total_usd: 0, model: r.model })
    const entry = byRole.get(key)!
    entry.calls++
    entry.total_usd += r.cost
  }

  return Array.from(byRole.entries()).map(([role, data]) => ({
    role, ...data
  }))
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

function getSessionCostSync(sessionId: string): number {
  const records = sessionUsage.get(sessionId) || []
  return records.reduce((sum, r) => sum + r.cost, 0)
}

function checkLimitsSync(
  sessionTotal: number,
  projectTotal: number
): CostLimitCheck {
  const sessionLimit = parseFloat(process.env.SESSION_COST_LIMIT_USD || '10')
  const projectLimit = parseFloat(process.env.TOTAL_COST_LIMIT_USD || '100')

  if (sessionTotal >= sessionLimit) {
    return {
      within_limits: false,
      reason: `Session cost $${sessionTotal.toFixed(3)} reached limit $${sessionLimit}. Answer the open question to continue.`,
      session_total_usd: sessionTotal,
      project_total_usd: projectTotal
    }
  }

  if (projectTotal >= projectLimit) {
    return {
      within_limits: false,
      reason: `Project total $${projectTotal.toFixed(2)} reached limit $${projectLimit}. Raise TOTAL_COST_LIMIT_USD to continue.`,
      session_total_usd: sessionTotal,
      project_total_usd: projectTotal
    }
  }

  return {
    within_limits: true,
    session_total_usd: sessionTotal,
    project_total_usd: projectTotal
  }
}
