import { NextRequest, NextResponse } from 'next/server'
import { getSessionCost, getProjectCost, checkLimits } from '@/lib/cost-controller'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('session_id')
  
  const [session, project, limits] = await Promise.all([
    sessionId ? getSessionCost(sessionId) : Promise.resolve(0),
    getProjectCost(),
    checkLimits()
  ])

  return NextResponse.json({
    session_cost_usd: session,
    project_cost_usd: project,
    within_limits: limits.within_limits,
    limit_reason: limits.reason,
    limits: {
      session: parseFloat(process.env.SESSION_COST_LIMIT_USD || '10'),
      project: parseFloat(process.env.TOTAL_COST_LIMIT_USD || '100')
    }
  })
}
