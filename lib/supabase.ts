/**
 * FORGE AI — Supabase Client
 * 
 * Two clients:
 * - getServiceClient(): Server-side only. Bypasses RLS. Used in API routes.
 * - getAnonClient():    Client-side safe. Respects RLS. Used in components.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ─── SERVER-SIDE CLIENT (service role) ───────────────────────────────────────

let serviceClient: SupabaseClient | null = null

export function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. ' +
      'Check your .env.local file.'
    )
  }

  serviceClient = createClient(url, key, {
    auth: { persistSession: false }
  })

  return serviceClient
}

// ─── CLIENT-SIDE CLIENT (anon key) ───────────────────────────────────────────

let anonClient: SupabaseClient | null = null

export function getAnonClient(): SupabaseClient {
  if (anonClient) return anonClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env vars')
  }

  anonClient = createClient(url, key)
  return anonClient
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Safely parse a Supabase response, throwing if error exists.
 */
export function unwrap<T>(result: { data: T | null; error: any }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned')
  return result.data
}

/**
 * Get the latest living spec for a project.
 */
export async function getLatestSpec(projectId: string) {
  const db = getServiceClient()
  const { data, error } = await db
    .from('living_specs')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .single()
  
  if (error) throw new Error(`Failed to load spec: ${error.message}`)
  return data
}

/**
 * Get all unblocked queued workstreams for a phase.
 */
export async function getUnblockedWorkstreams(projectId: string, phase: number) {
  const db = getServiceClient()
  
  // Get completed IDs first
  const { data: completed } = await db
    .from('workstreams')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'complete')
  
  const completedIds = completed?.map(w => w.id) || []
  
  const { data: workstreams } = await db
    .from('workstreams')
    .select('*')
    .eq('project_id', projectId)
    .eq('phase', phase)
    .eq('status', 'queued')
  
  return (workstreams || []).filter(ws =>
    (ws.blocked_by || []).every((depId: string) => completedIds.includes(depId))
  )
}

/**
 * Update workstream status with type safety.
 */
export async function setWorkstreamStatus(
  id: string,
  status: string,
  extraFields?: Record<string, any>
) {
  const db = getServiceClient()
  return db.from('workstreams').update({
    status,
    updated_at: new Date().toISOString(),
    ...extraFields
  }).eq('id', id)
}
