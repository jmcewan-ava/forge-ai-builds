/**
 * FORGE AI — GitHub Webhook Handler
 * 
 * Receives GitHub PR events and auto-updates workstream status.
 * 
 * Setup in GitHub:
 * 1. Go to repo Settings → Webhooks → Add webhook
 * 2. Payload URL: https://your-vercel-url.vercel.app/api/webhooks/github
 * 3. Content type: application/json
 * 4. Secret: same value as GITHUB_WEBHOOK_SECRET env var
 * 5. Events: Pull requests
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { getServiceClient } from '@/lib/supabase'
import type { GitHubWebhookPayload } from '@/lib/types'

// ─── WEBHOOK SIGNATURE VERIFICATION ─────────────────────────────────────────

async function verifyWebhookSignature(
  body: string,
  signature: string | null
): Promise<boolean> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  
  // In development, skip verification if no secret set
  if (!secret) {
    if (process.env.NODE_ENV === 'development') return true
    return false
  }
  
  if (!signature || !signature.startsWith('sha256=')) return false
  
  const expectedSignature = 'sha256=' + createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex')
  
  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) return false
  
  let result = 0
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }
  
  return result === 0
}

// ─── WORKSTREAM EXTRACTION FROM BRANCH NAME ──────────────────────────────────

function extractWorkstreamIdFromBranch(branchName: string): string | null {
  // Branch format: forge/ws-{workstream_uuid}
  const match = branchName.match(/forge\/ws-([a-f0-9-]{36})/)
  return match ? match[1] : null
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Read raw body for signature verification
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  const event = req.headers.get('x-github-event')
  
  // Verify signature
  const isValid = await verifyWebhookSignature(rawBody, signature)
  if (!isValid) {
    console.error('GitHub webhook: invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  
  // Only handle pull_request events
  if (event !== 'pull_request') {
    return NextResponse.json({ message: `Event ${event} ignored` }, { status: 200 })
  }
  
  let payload: GitHubWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  
  const { action, pull_request: pr } = payload
  
  // Only care about PR merges and closures
  if (!pr || !['closed', 'opened', 'reopened', 'synchronize'].includes(action)) {
    return NextResponse.json({ message: `Action ${action} ignored` }, { status: 200 })
  }
  
  const branchName = pr.head.ref
  const workstreamId = extractWorkstreamIdFromBranch(branchName)
  
  if (!workstreamId) {
    // Not a Forge AI branch — ignore
    return NextResponse.json({ message: 'Not a Forge branch' }, { status: 200 })
  }
  
  const db = getServiceClient()
  
  // Verify workstream exists
  const { data: workstream, error: wsError } = await db
    .from('workstreams')
    .select('id, name, project_id, status')
    .eq('id', workstreamId)
    .single()
  
  if (wsError || !workstream) {
    console.error('Webhook: workstream not found:', workstreamId)
    return NextResponse.json({ message: 'Workstream not found' }, { status: 200 })
  }
  
  // ── Handle different PR states ──────────────────────────────────────────────
  
  if (action === 'closed' && pr.merged) {
    // PR merged → workstream is truly complete
    await db.from('workstreams').update({
      status: 'complete',
      github_pr_url: pr.html_url,
      completion_pct: 100,
      completed_at: pr.merged_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', workstreamId)
    
    // Log the merge as a session output
    await logWebhookEvent(
      db,
      workstream.project_id,
      `PR merged: "${workstream.name}" — ${pr.html_url}`,
      workstreamId
    )
    
    // Check if this unblocks any queued workstreams
    await unblockDependents(db, workstreamId, workstream.project_id)
    
    console.log(`Webhook: workstream ${workstream.name} marked complete via merged PR`)
    
  } else if (action === 'closed' && !pr.merged) {
    // PR closed without merging — mark failed, raise question
    await db.from('workstreams').update({
      status: 'failed',
      updated_at: new Date().toISOString()
    }).eq('id', workstreamId)
    
    await db.from('open_questions').insert({
      project_id: workstream.project_id,
      question: `PR for "${workstream.name}" was closed without merging — what should happen?`,
      context: `PR ${pr.html_url} was closed without merging. The code was built and committed to branch ${branchName}. Options: re-open the PR, rebuild the workstream, or mark as won't fix.`,
      raised_by: 'github_webhook',
      raised_at: new Date().toISOString(),
      answered: false,
      workstream_id: workstreamId,
      urgency: 'high'
    })
    
  } else if (action === 'opened') {
    // PR opened — update workstream with PR URL
    await db.from('workstreams').update({
      github_pr_url: pr.html_url,
      updated_at: new Date().toISOString()
    }).eq('id', workstreamId)
    
  } else if (action === 'synchronize') {
    // New commits pushed to PR branch — update timestamp
    await db.from('workstreams').update({
      updated_at: new Date().toISOString()
    }).eq('id', workstreamId)
  }
  
  return NextResponse.json({
    message: 'Webhook processed',
    workstream_id: workstreamId,
    action,
    merged: pr.merged
  })
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function logWebhookEvent(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  output: string,
  workstreamId: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  
  const { data: existingSession } = await db
    .from('sessions')
    .select('id, key_outputs, workstreams_completed')
    .eq('project_id', projectId)
    .eq('date', today)
    .single()
  
  if (existingSession) {
    await db.from('sessions').update({
      key_outputs: [...(existingSession.key_outputs || []), output],
      workstreams_completed: [...(existingSession.workstreams_completed || []), workstreamId]
    }).eq('id', existingSession.id)
  }
  // If no session today, the next brief submission will create one
}

async function unblockDependents(
  db: ReturnType<typeof getServiceClient>,
  completedWorkstreamId: string,
  projectId: string
): Promise<void> {
  // Find workstreams blocked by the one that just completed
  const { data: potentiallyUnblocked } = await db
    .from('workstreams')
    .select('id, blocked_by, name')
    .eq('project_id', projectId)
    .eq('status', 'blocked')
    .contains('blocked_by', [completedWorkstreamId])
  
  if (!potentiallyUnblocked?.length) return
  
  // Get all completed workstream IDs
  const { data: completed } = await db
    .from('workstreams')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'complete')
  
  const completedIds = new Set(completed?.map(w => w.id) || [])
  
  for (const ws of potentiallyUnblocked) {
    const allDepsComplete = (ws.blocked_by || []).every(
      (depId: string) => completedIds.has(depId)
    )
    
    if (allDepsComplete) {
      await db.from('workstreams').update({
        status: 'queued',
        updated_at: new Date().toISOString()
      }).eq('id', ws.id)
      
      console.log(`Webhook: workstream "${ws.name}" unblocked`)
    }
  }
}
