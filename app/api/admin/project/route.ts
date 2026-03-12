/**
 * FORGE AI — Project Health Check
 * GET /api/admin/project?project_id=xxx
 * 
 * Returns a full health snapshot: stuck workstreams, cost, open questions,
 * blocking issues. Useful for debugging without opening Supabase directly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const db = getServiceClient()

  const [wsRes, costRes, qRes, lockRes, agentRes] = await Promise.all([
    db.from('workstreams').select('id,name,status,phase,priority,qa_iterations,started_at,updated_at').eq('project_id', projectId),
    db.from('api_costs').select('cost_usd,agent_role,created_at').eq('project_id', projectId),
    db.from('open_questions').select('id,question,urgency,answered').eq('project_id', projectId),
    db.from('file_locks').select('filepath,workstream_id,expires_at').gt('expires_at', new Date().toISOString()),
    db.from('agents').select('role,status,current_workstream,error_message').eq('project_id', projectId),
  ])

  const workstreams = wsRes.data || []
  const costs = costRes.data || []

  const now = Date.now()
  const stuck = workstreams.filter(ws => {
    if (ws.status !== 'in_progress') return false
    const minutesRunning = ws.started_at
      ? (now - new Date(ws.started_at).getTime()) / 60000
      : 999
    return minutesRunning > 8
  })

  const summary = {
    total: workstreams.length,
    byStatus: workstreams.reduce((acc: Record<string, number>, ws) => {
      acc[ws.status] = (acc[ws.status] || 0) + 1
      return acc
    }, {}),
  }

  const totalCost = costs.reduce((sum, c) => sum + (c.cost_usd || 0), 0)
  const openQuestions = (qRes.data || []).filter(q => !q.answered)
  const blockingQuestions = openQuestions.filter(q => q.urgency === 'blocking')

  return NextResponse.json({
    project_id: projectId,
    health: stuck.length > 0 || blockingQuestions.length > 0 ? 'degraded' : 'healthy',
    workstreams: summary,
    stuck_workstreams: stuck,
    total_cost_usd: totalCost,
    open_questions: openQuestions.length,
    blocking_questions: blockingQuestions.length,
    active_locks: lockRes.data || [],
    agents: agentRes.data || [],
    checked_at: new Date().toISOString(),
  })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { project_id, auto_merge_prs } = body
  if (!project_id) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const db = getServiceClient()
  const { error } = await db.from('projects')
    .update({ auto_merge_prs })
    .eq('id', project_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, auto_merge_prs })
}
