/**
 * FORGE AI — Root Page (Server Component)
 * Fetches data via /api/dashboard (uses service client, handles new Supabase key formats)
 */

import { Dashboard } from '@/components/Dashboard'
import { getServiceClient } from '@/lib/supabase'
import type { DashboardData, DashboardStats } from '@/lib/types'

async function getDashboardData(): Promise<DashboardData | null> {
  try {
    const db = getServiceClient()

    const { data: projects } = await db
      .from('projects').select('*').eq('status', 'active')
      .order('updated_at', { ascending: false }).limit(1)

    const project = projects?.[0]
    if (!project) return null

    const [specRes, wsRes, decisionsRes, sessionsRes, questionsRes, patternsRes, agentsRes] =
      await Promise.all([
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
    if (!livingSpec) return null

    const allTasks = workstreams.flatMap((w: any) => w.tasks || [])
    const doneTasks = allTasks.filter((t: any) => t.done)
    const overallPct = allTasks.length > 0
      ? Math.round((doneTasks.length / allTasks.length) * 100) : 0

    const totalCost = (sessionsRes.data || []).reduce((sum: number, s: any) => sum + (s.cost_usd || 0), 0)
    const totalTokens = (sessionsRes.data || []).reduce((sum: number, s: any) => sum + (s.token_usage || 0), 0)

    const stats: DashboardStats = {
      overall_pct: overallPct,
      active_workstreams: workstreams.filter((w: any) => w.status === 'in_progress').length,
      queued_workstreams: workstreams.filter((w: any) => w.status === 'queued').length,
      completed_workstreams: workstreams.filter((w: any) => w.status === 'complete').length,
      total_cost_usd: totalCost,
      total_tokens: totalTokens,
      spec_version: livingSpec.version
    }

    return {
      project,
      living_spec: livingSpec,
      workstreams,
      decisions: decisionsRes.data || [],
      sessions: sessionsRes.data || [],
      open_questions: questionsRes.data || [],
      failure_patterns: patternsRes.data || [],
      agents: agentsRes.data || [],
      stats
    }
  } catch (e) {
    console.error('getDashboardData error:', e)
    return null
  }
}

export default async function Home() {
  const data = await getDashboardData()

  if (!data) {
    return (
      <main className="min-h-screen bg-[#0B0C14] flex items-center justify-center">
        <div className="text-center space-y-4 max-w-lg px-6">
          <div className="text-6xl mb-6">⚙</div>
          <h1 className="text-3xl font-bold text-white">Forge AI</h1>
          <p className="text-[#64748B] text-lg">Autonomous Multi-Agent Software Factory</p>
          <div className="bg-[#1a1b2e] border border-[#C7D2FE]/20 rounded-xl p-6 text-left space-y-3 mt-8">
            <p className="text-[#C7D2FE] font-medium text-sm">Setup Required</p>
            <ol className="text-[#94A3B8] text-sm space-y-2 list-decimal list-inside">
              <li>Add environment variables to <code className="text-[#7C3AED]">.env.local</code></li>
              <li>Run schema in Supabase SQL Editor</li>
              <li>Visit <code className="text-[#7C3AED]">/api/seed</code> to load initial data</li>
              <li>Refresh this page</li>
            </ol>
            <p className="text-[#64748B] text-xs mt-4">
              See <code>SETUP.md</code> for complete instructions.
            </p>
          </div>
        </div>
      </main>
    )
  }

  return <Dashboard initialData={data} />
}
