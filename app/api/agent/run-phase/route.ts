/**
 * FORGE AI — Parallel Phase Execution v2
 * POST /api/agent/run-phase
 *
 * Executes all unblocked workstreams in a phase in parallel.
 * Supports autonomous mode: loops through all phases until complete or blocked.
 * Sets project context for cost tracking.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runPhase, runAutonomous } from '@/lib/orchestrator'
import { setCurrentProject } from '@/lib/cost-controller'

export const maxDuration = 300 // 5 min — requires Vercel Pro; hobby gets 60s

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)

  if (!body?.project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const { project_id, phase, autonomous = false } = body as {
    project_id: string
    phase?: number
    autonomous?: boolean
    max_parallel?: number
  }

  const maxParallel = Math.min(
    body.max_parallel || parseInt(process.env.MAX_PARALLEL_AGENTS || '3'),
    parseInt(process.env.MAX_PARALLEL_AGENTS || '3')
  )

  // Set project context so cost-controller can persist to the right project
  setCurrentProject(project_id)

  try {
    if (autonomous) {
      // Run all phases sequentially until complete or blocked
      const result = await runAutonomous(project_id, maxParallel)
      return NextResponse.json(result)
    }

    // Single phase run — phase is required
    if (!phase) {
      return NextResponse.json({ error: 'phase is required for non-autonomous runs' }, { status: 400 })
    }

    const result = await runPhase(project_id, phase, maxParallel)
    return NextResponse.json(result)

  } catch (err: any) {
    // Handle known orchestration errors (circular deps, cost limits, etc.)
    if (err?.type) {
      return NextResponse.json({
        error: err.message,
        error_type: err.type,
        workstream_ids: err.workstream_ids
      }, { status: 422 })
    }
    console.error('[run-phase] Unexpected error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
