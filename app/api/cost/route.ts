/**
 * FORGE AI — Cost API Route v2
 * GET /api/cost?project_id=xxx
 *
 * Reads persistent costs from Supabase (not in-memory).
 * Works correctly across Vercel cold starts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

const SESSION_LIMIT = parseFloat(process.env.SESSION_COST_LIMIT_USD || '10')
const PROJECT_LIMIT = parseFloat(process.env.TOTAL_COST_LIMIT_USD || '100')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({
      session_total_usd: 0, project_total_usd: 0,
      session_limit_usd: SESSION_LIMIT, project_limit_usd: PROJECT_LIMIT,
      session_remaining_usd: SESSION_LIMIT, project_remaining_usd: PROJECT_LIMIT,
      within_limits: true, breakdown: {}
    })
  }

  try {
    const db = getServiceClient()

    // Load all cost records for this project
    const { data: records, error } = await db
      .from('api_costs')
      .select('agent_role, model, input_tokens, output_tokens, cost_usd, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) throw error

    const allRecords = records || []

    // Project total = all records
    const projectTotal = allRecords.reduce((sum, r) => sum + (r.cost_usd || 0), 0)

    // Session total = records in last 24h (approximation — we don't track session boundaries in DB)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const sessionTotal = allRecords
      .filter(r => r.created_at > oneDayAgo)
      .reduce((sum, r) => sum + (r.cost_usd || 0), 0)

    // Per-agent breakdown
    const breakdown: Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }> = {}
    for (const row of allRecords) {
      const key = row.agent_role as string
      if (!breakdown[key]) breakdown[key] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 }
      breakdown[key].calls++
      breakdown[key].input_tokens += row.input_tokens || 0
      breakdown[key].output_tokens += row.output_tokens || 0
      breakdown[key].cost_usd += row.cost_usd || 0
    }

    const withinLimits = sessionTotal < SESSION_LIMIT && projectTotal < PROJECT_LIMIT

    return NextResponse.json({
      session_total_usd: sessionTotal,
      project_total_usd: projectTotal,
      session_limit_usd: SESSION_LIMIT,
      project_limit_usd: PROJECT_LIMIT,
      session_remaining_usd: Math.max(0, SESSION_LIMIT - sessionTotal),
      project_remaining_usd: Math.max(0, PROJECT_LIMIT - projectTotal),
      within_limits: withinLimits,
      breakdown
    })
  } catch (err) {
    console.error('[GET /api/cost] Error:', err)
    // Return zeros rather than erroring — cost display is non-critical
    return NextResponse.json({
      session_total_usd: 0, project_total_usd: 0,
      session_limit_usd: SESSION_LIMIT, project_limit_usd: PROJECT_LIMIT,
      session_remaining_usd: SESSION_LIMIT, project_remaining_usd: PROJECT_LIMIT,
      within_limits: true, breakdown: {},
      error: String(err)
    })
  }
}
