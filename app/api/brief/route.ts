/**
 * FORGE AI — Brief Processing Route
 * POST /api/brief
 * 
 * Receives a founder brief, runs the Office Manager, persists all outputs.
 * Optionally kicks off autonomous execution via auto_run flag.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { runOfficeManager, runInterviewAgent } from '@/lib/claude'
import type { BriefRequest, BriefResponse, OfficeManagerState } from '@/lib/types'

export async function POST(req: NextRequest) {
  let body: BriefRequest & { auto_run?: boolean }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { brief, project_id, auto_run = false } = body

  if (!brief || !project_id) {
    return NextResponse.json({ error: 'brief and project_id are required' }, { status: 400 })
  }

  if (brief.trim().length < 20) {
    return NextResponse.json({ error: 'Brief too short — minimum 20 characters' }, { status: 422 })
  }

  const db = getServiceClient()

  // ── Load project + state ──────────────────────────────────────────────────

  const [projectRes, specRes, wsRes, decisionsRes, questionsRes, patternsRes, sessionsRes] =
    await Promise.all([
      db.from('projects').select('*').eq('id', project_id).single(),
      db.from('living_specs').select('*').eq('project_id', project_id)
        .order('version', { ascending: false }).limit(1),
      db.from('workstreams').select('*').eq('project_id', project_id)
        .in('status', ['queued', 'in_progress', 'qa_review', 'blocked']),
      db.from('decisions').select('*').eq('project_id', project_id)
        .order('date', { ascending: false }).limit(10),
      db.from('open_questions').select('*').eq('project_id', project_id)
        .eq('answered', false).order('urgency', { ascending: false }),
      db.from('failure_patterns').select('*').eq('project_id', project_id)
        .order('occurrence_count', { ascending: false }),
      db.from('sessions').select('title, summary, date').eq('project_id', project_id)
        .order('date', { ascending: false }).limit(5)
    ])

  if (!projectRes.data) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (!specRes.data?.[0]) {
    return NextResponse.json({ error: 'No living spec found — run /api/seed first' }, { status: 404 })
  }

  const state: OfficeManagerState = {
    project: projectRes.data,
    living_spec: specRes.data[0],
    active_workstreams: wsRes.data || [],
    recent_decisions: decisionsRes.data || [],
    open_questions: questionsRes.data || [],
    failure_patterns: patternsRes.data || [],
    session_history: sessionsRes.data?.map(s => `${s.date}: ${s.title} — ${s.summary}`) || []
  }

  // ── Run Office Manager ────────────────────────────────────────────────────

  let omResult: BriefResponse
  try {
    omResult = await runOfficeManager(brief, state)
  } catch (err) {
    return NextResponse.json(
      { error: 'Office Manager failed', details: String(err) },
      { status: 500 }
    )
  }

  // ── Create session ────────────────────────────────────────────────────────

  const today = new Date().toISOString().split('T')[0]
  const { data: session, error: sessionError } = await db
    .from('sessions')
    .insert({
      project_id,
      date: today,
      title: (omResult as any).session_title || `Brief: ${brief.substring(0, 40)}...`,
      summary: omResult.office_manager_message,
      brief_submitted: brief,
      key_outputs: [],
      decisions_made: [],
      open_questions: [],
      workstreams_created: [],
      workstreams_completed: [],
      token_usage: 0,
      cost_usd: omResult.estimated_cost_usd || 0
    })
    .select()
    .single()

  if (sessionError || !session) {
    console.error('Session creation error:', sessionError)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  // ── Persist workstreams ───────────────────────────────────────────────────

  const createdWorkstreams: any[] = []

  for (const ws of (omResult.workstreams_created as any[])) {
    // Resolve blocked_by from names to IDs
    let blockedByIds: string[] = []
    if (ws.blocked_by_names?.length > 0) {
      const { data: blockingWs } = await db
        .from('workstreams')
        .select('id, name')
        .eq('project_id', project_id)
        .in('name', ws.blocked_by_names)
      blockedByIds = blockingWs?.map((w: any) => w.id) || []
    }

    const { data: newWs, error: wsInsertError } = await db
      .from('workstreams')
      .insert({
        project_id,
        name: ws.name,
        description: ws.description || '',
        status: blockedByIds.length > 0 ? 'blocked' : 'queued',
        priority: ws.priority || 'P1',
        phase: ws.phase || 1,
        completion_pct: 0,
        blocked_by: blockedByIds,
        qa_iterations: 0,
        tasks: (ws.tasks || []).map((t: any, i: number) => ({
          id: `t${i + 1}`,
          workstream_id: '',
          text: t.text,
          done: false
        })),
        brief: ws.brief || '',
        estimated_files: ws.estimated_files || [],
        output_files: []
      })
      .select()
      .single()

    if (!wsInsertError && newWs) {
      createdWorkstreams.push(newWs)
    }
  }

  // ── Persist decisions ─────────────────────────────────────────────────────

  const createdDecisions: any[] = []

  for (const d of (omResult.decisions_logged as any[])) {
    const { data: newDecision } = await db
      .from('decisions')
      .insert({
        project_id,
        decision: d.decision,
        rationale: d.rationale || '',
        made_by: d.made_by || 'office_manager',
        date: today,
        reversible: d.reversible ?? true,
        impact: d.impact || 'medium'
      })
      .select()
      .single()

    if (newDecision) createdDecisions.push(newDecision)
  }

  // ── Persist questions ─────────────────────────────────────────────────────

  const createdQuestions: any[] = []

  for (const q of (omResult.questions_raised as any[])) {
    const { data: newQuestion } = await db
      .from('open_questions')
      .insert({
        project_id,
        question: q.question,
        context: q.context || '',
        raised_by: 'office_manager',
        raised_at: new Date().toISOString(),
        answered: false,
        urgency: q.urgency || 'medium'
      })
      .select()
      .single()

    if (newQuestion) createdQuestions.push(newQuestion)
  }

  // ── Update spec if changed ────────────────────────────────────────────────

  let specUpdated = false
  let newSpecVersion: number | undefined

  const specUpdates = (omResult as any).spec_updates
  if (specUpdates?.goals || specUpdates?.constraints || specUpdates?.out_of_scope) {
    const currentSpec = specRes.data[0]
    const updatedContent = {
      ...currentSpec.content,
      ...(specUpdates.goals ? { goals: specUpdates.goals } : {}),
      ...(specUpdates.constraints ? { constraints: specUpdates.constraints } : {}),
      ...(specUpdates.out_of_scope ? { out_of_scope: specUpdates.out_of_scope } : {})
    }

    const { data: newSpec } = await db
      .from('living_specs')
      .insert({
        project_id,
        version: currentSpec.version + 1,
        content: updatedContent,
        last_updated_by: 'office_manager',
        change_summary: `Brief submitted: ${brief.substring(0, 80)}`,
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (newSpec) {
      specUpdated = true
      newSpecVersion = newSpec.version
    }
  }

  // ── Update session with created IDs ──────────────────────────────────────

  await db.from('sessions').update({
    workstreams_created: createdWorkstreams.map(w => w.id),
    decisions_made: createdDecisions.map(d => d.id)
  }).eq('id', session.id)

  // ── Auto-interview: raise a spec question if spec has gaps ────────────────

  if (createdWorkstreams.length > 0 && createdQuestions.length === 0) {
    try {
      const interviewResult = await runInterviewAgent(
        specRes.data[0],
        state.session_history,
        questionsRes.data || []
      )

      // Only insert if not already asked
      const alreadyAsked = (questionsRes.data || []).some(
        q => q.question.toLowerCase().includes(interviewResult.question.toLowerCase().substring(0, 30))
      )

      if (!alreadyAsked) {
        await db.from('open_questions').insert({
          project_id,
          question: interviewResult.question,
          context: interviewResult.context,
          raised_by: 'interview_agent',
          raised_at: new Date().toISOString(),
          answered: false,
          urgency: interviewResult.urgency
        })
      }
    } catch (err) {
      // Interview agent failure is non-fatal
      console.error('Interview agent error (non-fatal):', err)
    }
  }

  // ── Store brief record ────────────────────────────────────────────────────

  await db.from('briefs').insert({
    project_id,
    content: brief,
    submitted_at: new Date().toISOString(),
    processed: true,
    workstreams_created: createdWorkstreams.map(w => w.id),
    office_manager_response: omResult.office_manager_message,
    session_id: session.id
  })

  // ── Response ──────────────────────────────────────────────────────────────

  const response: BriefResponse = {
    session_id: session.id,
    workstreams_created: createdWorkstreams,
    decisions_logged: createdDecisions,
    questions_raised: createdQuestions,
    spec_updated: specUpdated,
    spec_version: newSpecVersion,
    office_manager_message: omResult.office_manager_message,
    estimated_cost_usd: omResult.estimated_cost_usd
  }

  return NextResponse.json(response)
}
