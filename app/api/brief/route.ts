/**
 * FORGE AI — Brief Submission Route v2
 * POST /api/brief
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { runOfficeManager } from '@/lib/claude'
import { setCurrentProject } from '@/lib/cost-controller'
import type { OfficeManagerState } from '@/lib/types'

const MAX_BRIEF_LENGTH = 5000

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null)

    if (!body || typeof body.brief !== 'string') {
      return NextResponse.json({ error: 'Request body must include a "brief" string field.' }, { status: 400 })
    }

    const { brief, project_id } = body as { brief: string; project_id?: string }

    if (!brief.trim()) return NextResponse.json({ error: 'Brief cannot be empty.' }, { status: 400 })
    if (brief.length > MAX_BRIEF_LENGTH) {
      return NextResponse.json({ error: `Brief exceeds maximum allowed length of ${MAX_BRIEF_LENGTH} characters.` }, { status: 400 })
    }

    const db = getServiceClient()

    // Resolve project
    let projectQuery = db.from('projects').select('*').eq('status', 'active')
    if (project_id) projectQuery = projectQuery.eq('id', project_id)
    const { data: projects } = await projectQuery.order('updated_at', { ascending: false }).limit(1)
    const project = projects?.[0]
    if (!project) return NextResponse.json({ error: 'No active project found. Run /api/seed to create one.' }, { status: 404 })

    setCurrentProject(project.id)

    // Load Office Manager state
    const [specRes, wsRes, decisionsRes, questionsRes, patternsRes] = await Promise.all([
      db.from('living_specs').select('*').eq('project_id', project.id).order('version', { ascending: false }).limit(1),
      db.from('workstreams').select('id,name,status,phase,priority,blocked_by,description,completion_pct,qa_iterations,tasks,brief,output_files,created_at,updated_at').eq('project_id', project.id).order('phase').order('priority'),
      db.from('decisions').select('*').eq('project_id', project.id).order('date', { ascending: false }).limit(20),
      db.from('open_questions').select('*').eq('project_id', project.id).eq('answered', false).order('urgency', { ascending: false }),
      db.from('failure_patterns').select('*').eq('project_id', project.id).order('occurrence_count', { ascending: false }).limit(10),
    ])

    const livingSpec = specRes.data?.[0]
    if (!livingSpec) return NextResponse.json({ error: 'No living spec found. Run /api/seed to initialise.' }, { status: 404 })

    const omState: OfficeManagerState = {
      project,
      living_spec: livingSpec,
      active_workstreams: (wsRes.data || []) as any,
      recent_decisions: decisionsRes.data || [],
      open_questions: questionsRes.data || [],
      failure_patterns: patternsRes.data || [],
      session_history: [],
    }

    // Run Office Manager
    const result = await runOfficeManager(brief, omState)
    const resultWithExtras = result as typeof result & { spec_updates?: any }

    // Persist workstreams
    const createdWorkstreams = []
    for (const ws of (result.workstreams_created || [])) {
      const wsAny = ws as any
      const allWs = wsRes.data || []
      const blockedByIds: string[] = (wsAny.blocked_by_names || [])
        .map((name: string) => (allWs as any[]).find(w => w.name === name)?.id)
        .filter(Boolean)

      try {
        const { data: created } = await db.from('workstreams').insert({
          project_id: project.id,
          name: wsAny.name,
          description: wsAny.description,
          priority: wsAny.priority || 'P1',
          phase: wsAny.phase || 1,
          status: 'queued',
          completion_pct: 0,
          blocked_by: blockedByIds,
          tasks: (wsAny.tasks || []).map((t: any, i: number) => ({
            id: `task-${Date.now()}-${i}`,
            workstream_id: '',
            text: t.text,
            done: false
          })),
          brief: wsAny.brief,
          estimated_files: wsAny.estimated_files || [],
          qa_iterations: 0,
          output_files: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).select().single()
        if (created) createdWorkstreams.push(created)
      } catch (err) {
        console.error('[brief] Failed to create workstream:', err)
      }
    }

    // Persist decisions (fire and forget)
    for (const d of (result.decisions_logged || [])) {
      db.from('decisions').insert({
        project_id: project.id,
        decision: (d as any).decision,
        rationale: (d as any).rationale,
        made_by: 'office_manager',
        date: new Date().toISOString().split('T')[0],
        reversible: (d as any).reversible ?? true,
        impact: (d as any).impact || 'medium',
      }).then(() => {}, (err: unknown) => console.error('[brief] Failed to persist decision:', err))
    }

    // Persist questions
    for (const q of (result.questions_raised || [])) {
      db.from('open_questions').insert({
        project_id: project.id,
        question: (q as any).question,
        context: (q as any).context || '',
        raised_by: 'office_manager',
        raised_at: new Date().toISOString(),
        answered: false,
        urgency: (q as any).urgency || 'medium',
      }).then(() => {}, (err: unknown) => console.error('[brief] Failed to persist question:', err))
    }

    // Update living spec if suggested
    if (result.spec_updated && resultWithExtras.spec_updates) {
      const specUpdates = resultWithExtras.spec_updates
      const updatedContent = { ...livingSpec.content }
      if (specUpdates.goals) updatedContent.goals = specUpdates.goals
      if (specUpdates.constraints) updatedContent.constraints = specUpdates.constraints
      if (specUpdates.out_of_scope) updatedContent.out_of_scope = specUpdates.out_of_scope

      db.from('living_specs').insert({
        project_id: project.id,
        version: livingSpec.version + 1,
        content: updatedContent,
        last_updated_by: 'office_manager',
        change_summary: `Brief: ${brief.slice(0, 100)}...`,
        updated_at: new Date().toISOString(),
      }).then(() => {}, (err: unknown) => console.error('[brief] Failed to update spec:', err))
    }

    // Create session record
    db.from('sessions').insert({
      project_id: project.id,
      date: new Date().toISOString().split('T')[0],
      title: `Brief: ${brief.slice(0, 50)}${brief.length > 50 ? '...' : ''}`,
      summary: result.office_manager_message,
      brief_submitted: brief,
      key_outputs: [],
      decisions_made: (result.decisions_logged || []).map((d: any) => d.decision),
      open_questions: (result.questions_raised || []).map((q: any) => q.question),
      workstreams_created: createdWorkstreams.map(w => w.id),
      workstreams_completed: [],
      token_usage: 0,
      cost_usd: result.estimated_cost_usd || 0,
    }).then(() => {}, (err: unknown) => console.error('[brief] Failed to create session:', err))

    return NextResponse.json({
      session_id: '',
      workstreams_created: createdWorkstreams,
      decisions_logged: result.decisions_logged || [],
      questions_raised: result.questions_raised || [],
      spec_updated: result.spec_updated,
      office_manager_message: result.office_manager_message,
      estimated_cost_usd: result.estimated_cost_usd,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
    console.error('[POST /api/brief] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
