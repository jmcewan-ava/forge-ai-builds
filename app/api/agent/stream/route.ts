/**
 * FORGE AI — Streaming Agent Run (SSE)
 * POST /api/agent/stream
 *
 * Real-time Server-Sent Events stream of agent progress.
 * PhaseRunner in Dashboard uses this for live log output.
 */

import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { setCurrentProject } from '@/lib/cost-controller'
import { runWorkstream } from '@/lib/orchestrator'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.project_id) {
    return new Response('project_id required', { status: 400 })
  }

  const { project_id, phase, autonomous = false } = body as {
    project_id: string
    phase?: number
    autonomous?: boolean
  }

  const maxParallel = Math.min(
    parseInt(body.max_parallel || process.env.MAX_PARALLEL_AGENTS || '3'),
    5
  )

  setCurrentProject(project_id)

  const db = getServiceClient()
  const encoder = new TextEncoder()
  function send(data: object): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(send({ type: 'log', message: `Starting agent run for project ${project_id}` }))

        const [specRes, patternsRes] = await Promise.all([
          db.from('living_specs').select('*').eq('project_id', project_id)
            .order('version', { ascending: false }).limit(1),
          db.from('failure_patterns').select('*').eq('project_id', project_id)
        ])

        if (!specRes.data?.[0]) {
          controller.enqueue(send({ type: 'error', message: 'No living spec found' }))
          controller.close()
          return
        }

        const livingSpec = specRes.data[0]
        const failurePatterns = patternsRes.data || []
        let currentPhase = phase || 1
        let phasesRun = 0
        let totalCompleted = 0
        let totalFailed = 0

        const runOnePhase = async (phaseNum: number) => {
          controller.enqueue(send({ type: 'log', message: `Phase ${phaseNum}: loading workstreams...` }))

          const { data: allWs } = await db
            .from('workstreams').select('*').eq('project_id', project_id)
            .eq('phase', phaseNum).eq('status', 'queued')

          if (!allWs?.length) {
            controller.enqueue(send({ type: 'log', message: `Phase ${phaseNum}: nothing to run` }))
            return { completed: 0, failed: 0, total: 0 }
          }

          const { data: completedWs } = await db
            .from('workstreams').select('id').eq('project_id', project_id).eq('status', 'complete')
          const completedIds = new Set((completedWs || []).map((w: { id: string }) => w.id))

          const unblocked = allWs.filter((ws: { blocked_by?: string[] }) =>
            (ws.blocked_by || []).every((id: string) => completedIds.has(id))
          )

          if (!unblocked.length) {
            controller.enqueue(send({ type: 'log', message: `Phase ${phaseNum}: all workstreams blocked` }))
            return { completed: 0, failed: 0, total: 0 }
          }

          controller.enqueue(send({
            type: 'log',
            message: `Phase ${phaseNum}: running ${unblocked.length} workstream(s), ${maxParallel} parallel`
          }))

          let phaseCompleted = 0
          let phaseFailed = 0

          for (let i = 0; i < unblocked.length; i += maxParallel) {
            const batch = unblocked.slice(i, i + maxParallel)

            for (const ws of batch) {
              controller.enqueue(send({ type: 'workstream_start', workstream_id: ws.id, name: ws.name }))
            }

            const results = await Promise.allSettled(
              batch.map((ws: Record<string, unknown>) => runWorkstream(ws as never, livingSpec, failurePatterns, project_id))
            )

            for (let j = 0; j < results.length; j++) {
              const result = results[j]
              const ws = batch[j]
              if (result.status === 'fulfilled') {
                const r = result.value
                if (r.status === 'complete') {
                  phaseCompleted++
                  // Emit pipeline stage summary if available
                  const dtResult = r as typeof r & {
                    pipeline_stages?: Array<{ agent: string; status: string; notes?: string }>
                    type_check_passed?: boolean
                    deploy_confirmed?: boolean
                    advisor_briefs_filed?: number
                  }
                  if (dtResult.pipeline_stages?.length) {
                    const summary = dtResult.pipeline_stages
                      .map((s: { agent: string; status: string; notes?: string }) => `${s.agent}:${s.status === 'passed' ? '✓' : s.status === 'failed' ? '✗' : '~'}`)
                      .join(' → ')
                    controller.enqueue(send({ type: 'log', message: `  Pipeline: ${summary}` }))
                  }
                  if (dtResult.deploy_confirmed) {
                    controller.enqueue(send({ type: 'log', message: `  🚀 Deployed to production` }))
                  }
                  if (dtResult.advisor_briefs_filed && dtResult.advisor_briefs_filed > 0) {
                    controller.enqueue(send({ type: 'log', message: `  💡 ${dtResult.advisor_briefs_filed} improvement brief(s) filed by Product Advisor` }))
                  }
                  controller.enqueue(send({
                    type: 'workstream_complete', workstream_id: ws.id, name: ws.name,
                    files: r.files_produced.length, iterations: r.iterations,
                    pr_url: r.github_pr_url, merged: !!r.github_merge_sha
                  }))
                } else {
                  phaseFailed++
                  controller.enqueue(send({
                    type: 'workstream_failed', workstream_id: ws.id, name: ws.name,
                    status: r.status, reason: r.failures[0] || 'Unknown'
                  }))
                }
              } else {
                phaseFailed++
                controller.enqueue(send({
                  type: 'workstream_failed', workstream_id: ws.id, name: ws.name,
                  status: 'error', reason: String(result.reason)
                }))
              }
            }
          }

          controller.enqueue(send({
            type: 'phase_complete', phase: phaseNum,
            completed: phaseCompleted, failed: phaseFailed
          }))

          return { completed: phaseCompleted, failed: phaseFailed, total: unblocked.length }
        }

        if (autonomous) {
          while (true) {
            const result = await runOnePhase(currentPhase)
            phasesRun++
            totalCompleted += result.completed
            totalFailed += result.failed

            if (result.completed === 0 && result.total > 0) break

            const { data: blockingQs } = await db
              .from('open_questions').select('id').eq('project_id', project_id)
              .eq('answered', false).eq('urgency', 'blocking').limit(1)
            if (blockingQs?.length) {
              controller.enqueue(send({ type: 'log', message: 'Stopped: blocking question needs answer' }))
              break
            }

            const { data: nextWs } = await db
              .from('workstreams').select('phase').eq('project_id', project_id)
              .in('status', ['queued']).order('phase').limit(1)
            if (!nextWs?.length) { controller.enqueue(send({ type: 'log', message: 'All phases complete.' })); break }
            currentPhase = nextWs[0].phase
          }
        } else {
          const result = await runOnePhase(currentPhase)
          phasesRun = 1
          totalCompleted = result.completed
          totalFailed = result.failed
        }

        controller.enqueue(send({ type: 'done', summary: { phases_run: phasesRun, total_completed: totalCompleted, total_failed: totalFailed } }))

      } catch (err) {
        controller.enqueue(send({ type: 'error', message: String(err) }))
      } finally {
        // Always reset agent statuses for this project to prevent ghost agents
        try {
          await db
            .from('agents')
            .update({ status: 'idle', current_workstream: null })
            .eq('project_id', project_id)
            .eq('status', 'running')
          console.log('[Agent Stream] Agent status reset to idle')
        } catch (cleanupErr) {
          console.error('[Agent Stream] Failed to reset agent status:', cleanupErr)
        }
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  })
}
