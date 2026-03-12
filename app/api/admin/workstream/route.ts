/**
 * FORGE AI — Workstream Admin Route
 * 
 * PATCH /api/admin/workstream — reset/retry/skip a workstream
 * 
 * Actions:
 * - reset:  stuck in_progress → queued (clears started_at, resets qa_iterations)
 * - retry:  failed/escalated → queued
 * - skip:   any → complete (marks done without building — use when workstream is no longer needed)
 * - rebrief: update the workstream brief (OM may have written a bad brief)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forceRelease } from '@/lib/file-lock'
import { setCurrentProject } from '@/lib/cost-controller'
import { runWorkstream } from '@/lib/orchestrator'

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.workstream_id || !body?.action) {
    return NextResponse.json({ error: 'workstream_id and action required' }, { status: 400 })
  }

  const { workstream_id, action, project_id, new_brief } = body as {
    workstream_id: string
    action: 'reset' | 'retry' | 'skip' | 'rebrief' | 'run'
    project_id?: string
    new_brief?: string
  }

  const db = getServiceClient()

  const { data: ws, error: wsErr } = await db
    .from('workstreams').select('*').eq('id', workstream_id).single()

  if (wsErr || !ws) {
    return NextResponse.json({ error: 'Workstream not found' }, { status: 404 })
  }

  const pid = project_id || ws.project_id

  switch (action) {
    case 'reset':
    case 'retry': {
      // Release any stale file locks
      await forceRelease(workstream_id)

      await db.from('workstreams').update({
        status: 'queued',
        qa_iterations: 0,
        qa_status: 'pending',
        started_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', workstream_id)

      return NextResponse.json({ success: true, action, new_status: 'queued' })
    }

    case 'skip': {
      await forceRelease(workstream_id)

      const tasks = (ws.tasks || []).map((t: any) => ({ ...t, done: true, done_at: new Date().toISOString() }))

      await db.from('workstreams').update({
        status: 'complete',
        qa_status: 'pass',
        completion_pct: 100,
        tasks,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', workstream_id)

      return NextResponse.json({ success: true, action, new_status: 'complete' })
    }

    case 'rebrief': {
      if (!new_brief?.trim()) {
        return NextResponse.json({ error: 'new_brief required for rebrief action' }, { status: 400 })
      }

      await db.from('workstreams').update({
        brief: new_brief.trim(),
        status: 'queued',
        qa_iterations: 0,
        qa_status: 'pending',
        started_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', workstream_id)

      return NextResponse.json({ success: true, action, new_status: 'queued' })
    }

    case 'run': {
      // Immediately run this workstream (bypasses phase ordering)
      setCurrentProject(pid)

      const [specRes, patternsRes] = await Promise.all([
        db.from('living_specs').select('*').eq('project_id', pid)
          .order('version', { ascending: false }).limit(1),
        db.from('failure_patterns').select('*').eq('project_id', pid),
      ])

      if (!specRes.data?.[0]) {
        return NextResponse.json({ error: 'No living spec found' }, { status: 404 })
      }

      // Reset to queued first
      await forceRelease(workstream_id)
      await db.from('workstreams').update({
        status: 'queued',
        qa_iterations: 0,
        started_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', workstream_id)

      const { data: freshWs } = await db.from('workstreams').select('*').eq('id', workstream_id).single()

      const result = await runWorkstream(
        freshWs || ws,
        specRes.data[0],
        patternsRes.data || [],
        pid
      )

      return NextResponse.json(result)
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}

// GET — list all workstreams with their status for a project
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const db = getServiceClient()
  const { data, error } = await db
    .from('workstreams')
    .select('id, name, status, phase, priority, qa_iterations, started_at, completed_at, github_pr_url')
    .eq('project_id', projectId)
    .order('phase').order('priority')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stuck = (data || []).filter(ws => {
    if (ws.status !== 'in_progress') return false
    if (!ws.started_at) return true
    const minutesRunning = (Date.now() - new Date(ws.started_at).getTime()) / 60000
    return minutesRunning > 10
  })

  return NextResponse.json({ workstreams: data, stuck_count: stuck.length, stuck })
}
