/**
 * FORGE AI — Parallel Phase Execution
 * POST /api/agent/run-phase
 * 
 * Executes all unblocked workstreams in a phase in parallel.
 * Supports Server-Sent Events for real-time progress streaming.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runPhase } from '@/lib/orchestrator'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)

  if (!body?.project_id || !body?.phase) {
    return NextResponse.json({ error: 'project_id and phase required' }, { status: 400 })
  }

  const maxParallel = Math.min(
    body.max_parallel || parseInt(process.env.MAX_PARALLEL_AGENTS || '5'),
    parseInt(process.env.MAX_PARALLEL_AGENTS || '5')
  )

  try {
    const result = await runPhase(body.project_id, body.phase, maxParallel)
    return NextResponse.json(result)
  } catch (err: any) {
    // Handle orchestration errors (circular deps, cost limits, etc.)
    if (err.type) {
      return NextResponse.json({
        error: err.message,
        error_type: err.type,
        workstream_ids: err.workstream_ids
      }, { status: 422 })
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
