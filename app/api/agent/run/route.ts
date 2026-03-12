/**
 * FORGE AI — Single Workstream Run
 * POST /api/agent/run
 * 
 * Runs a single workstream through the full builder → QA → file-writer loop.
 * Used by the dashboard "Run" button on individual workstreams.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { runWorkstream } from '@/lib/orchestrator'
import type { AgentRunRequest, AgentRunResponse } from '@/lib/types'

export async function POST(req: NextRequest) {
  let body: AgentRunRequest
  
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  
  const { workstream_id, project_id, force = false } = body
  
  if (!workstream_id || !project_id) {
    return NextResponse.json(
      { error: 'workstream_id and project_id are required' },
      { status: 400 }
    )
  }
  
  const db = getServiceClient()

  try {
    // Load workstream
    const { data: workstream, error: wsError } = await db
      .from('workstreams')
      .select('*')
      .eq('id', workstream_id)
      .eq('project_id', project_id)
      .single()
    
    if (wsError || !workstream) {
      return NextResponse.json({ error: 'Workstream not found' }, { status: 404 })
    }
    
    // Guard: don't re-run complete workstreams unless forced
    if (workstream.status === 'complete' && !force) {
      return NextResponse.json(
        { error: 'Workstream already complete. Pass force: true to re-run.' },
        { status: 409 }
      )
    }
    
    // Guard: check dependencies are met
    if (workstream.blocked_by?.length > 0) {
      const { data: blockers } = await db
        .from('workstreams')
        .select('id, name, status')
        .in('id', workstream.blocked_by)
      
      const incomplete = blockers?.filter((b: { id: string; name: string; status: string }) => b.status !== 'complete') || []
      if (incomplete.length > 0) {
        return NextResponse.json({
          error: 'Workstream is blocked by incomplete dependencies',
          blockers: incomplete.map((b: { id: string; name: string; status: string }) => ({ id: b.id, name: b.name, status: b.status }))
        }, { status: 409 })
      }
    }
    
    // Load living spec and failure patterns
    const [specRes, patternsRes] = await Promise.all([
      db.from('living_specs')
        .select('*')
        .eq('project_id', project_id)
        .order('version', { ascending: false })
        .limit(1),
      db.from('failure_patterns')
        .select('*')
        .eq('project_id', project_id)
        .order('occurrence_count', { ascending: false })
    ])
    
    if (!specRes.data?.[0]) {
      return NextResponse.json({ error: 'No living spec found for project' }, { status: 404 })
    }
    
    const livingSpec = specRes.data[0]
    const failurePatterns = patternsRes.data || []
    
    // If force-running, reset workstream status
    if (force) {
      await db.from('workstreams').update({
        status: 'queued',
        qa_iterations: 0,
        qa_status: 'pending',
        output_files: [],
        output_code: null,
        github_pr_url: null,
        started_at: null,
        completed_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', workstream_id)
      
      // Re-fetch with reset values
      const { data: refreshed } = await db
        .from('workstreams').select('*').eq('id', workstream_id).single()
      if (refreshed) Object.assign(workstream, refreshed)
    }
    
    // Run the workstream
    const result = await runWorkstream(workstream, livingSpec, failurePatterns, project_id)
    
    const response: AgentRunResponse = {
      workstream_id: result.workstream_id,
      status: result.status,
      iterations: result.iterations,
      passed: result.passed,
      escalated: result.escalated,
      failures: result.failures,
      files_produced: result.files_produced,
      github_pr_url: result.github_pr_url,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms
    }
    
    return NextResponse.json(response)
  } catch (error) {
    console.error('[Agent Run] Execution error:', error)
    return NextResponse.json({ error: 'Agent execution failed' }, { status: 500 })
  } finally {
    // Always reset agent status for this project to prevent ghost agents
    try {
      await db
        .from('agents')
        .update({ status: 'idle', current_workstream: null })
        .eq('project_id', project_id)
        .eq('status', 'running')
      console.log('[Agent Run] Agent status reset to idle')
    } catch (cleanupErr) {
      console.error('[Agent Run] Failed to reset agent status:', cleanupErr)
    }
  }
}
