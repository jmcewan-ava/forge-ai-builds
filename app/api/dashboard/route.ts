/**
 * FORGE AI — Dashboard Data Route
 * GET /api/dashboard?project_id=xxx
 * 
 * Returns all dashboard data in a single parallelised request.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import type { DashboardData, DashboardStats } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')

  const db = getServiceClient()

  // Resolve project
  let projectQuery = db.from('projects').select('*').eq('status', 'active')
  if (projectId) projectQuery = projectQuery.eq('id', projectId)
  const { data: projects } = await projectQuery
    .order('updated_at', { ascending: false })
    .limit(1)
  
  const project = projects?.[0]
  if (!project) {
    return NextResponse.json({ error: 'No active project found' }, { status: 404 })
  }

  // Parallel load
  const [
    specRes, wsRes, decisionsRes, sessionsRes,
    questionsRes, patternsRes, agentsRes
  ] = await Promise.all([
    db.from('living_specs').select('*').eq('project_id', project.id)
      .order('version', { ascending: false }).limit(1),
    db.from('workstreams').select('*').eq('project_id', project.id)
      .order('phase').order('priority'),
    db.from('decisions').select('*').eq('project_id', project.id)
      .order('date', { ascending: false }),
    db.from('sessions').select('*').eq('project_id', project.id)
      .order('date', { ascending: false }),
    db.from('open_questions').select('*').eq('project_id', project.id)
      .order('urgency', { ascending: false }),
    db.from('failure_patterns').select('*').eq('project_id', project.id)
      .order('occurrence_count', { ascending: false }),
    db.from('agents').select('*').eq('project_id', project.id)
  ])

  const workstreams = wsRes.data || []
  const livingSpec = specRes.data?.[0]

  if (!livingSpec) {
    return NextResponse.json({ error: 'No living spec found' }, { status: 404 })
  }

  // Compute stats
  const allTasks = workstreams.flatMap(w => (w.tasks || []) as any[])
  const doneTasks = allTasks.filter(t => t.done)
  const overallPct = allTasks.length > 0
    ? Math.round((doneTasks.length / allTasks.length) * 100)
    : 0

  const sessions = sessionsRes.data || []
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost_usd || 0), 0)
  const totalTokens = sessions.reduce((sum, s) => sum + (s.token_usage || 0), 0)

  const stats: DashboardStats = {
    overall_pct: overallPct,
    active_workstreams: workstreams.filter(w => w.status === 'in_progress').length,
    queued_workstreams: workstreams.filter(w => w.status === 'queued').length,
    completed_workstreams: workstreams.filter(w => w.status === 'complete').length,
    total_cost_usd: totalCost,
    total_tokens: totalTokens,
    spec_version: livingSpec.version
  }

  const data: DashboardData = {
    project,
    living_spec: livingSpec,
    workstreams,
    decisions: decisionsRes.data || [],
    sessions,
    open_questions: questionsRes.data || [],
    failure_patterns: patternsRes.data || [],
    agents: agentsRes.data || [],
    stats
  }

  return NextResponse.json(data)
}
