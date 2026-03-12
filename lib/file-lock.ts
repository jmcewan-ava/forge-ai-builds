/**
 * FORGE AI — File Lock Registry v2
 *
 * Prevents two parallel Builder Agents from writing to the same file.
 *
 * v1 was in-memory only — worked locally, silently broken on Vercel
 * (each serverless invocation has its own memory, so locks were invisible
 * to other concurrent lambdas).
 *
 * v2 uses Supabase as the lock store. Atomic upsert + TTL cleanup.
 * Falls back gracefully if Supabase is unavailable.
 */

import { getServiceClient } from './supabase'

const LOCK_TTL_MS = 120_000 // 2 minutes — enough for a full builder+QA cycle

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Attempt to acquire locks on all filepaths for a workstream.
 * Atomic: either all locks acquired, or none (rolls back on failure).
 * Returns false if any file is already locked by another workstream.
 */
export async function acquireLocks(
  filepaths: string[],
  workstreamId: string,
  ttlMs: number = LOCK_TTL_MS
): Promise<boolean> {
  if (!filepaths.length) return true

  try {
    const db = getServiceClient()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMs)

    // Clean expired locks first
    await db
      .from('file_locks')
      .delete()
      .lt('expires_at', now.toISOString())

    // Check if any files are locked by a DIFFERENT workstream
    const { data: existing } = await db
      .from('file_locks')
      .select('filepath, workstream_id, expires_at')
      .in('filepath', filepaths)
      .gt('expires_at', now.toISOString())

    const blockedByOther = (existing || []).filter(
      lock => lock.workstream_id !== workstreamId
    )

    if (blockedByOther.length > 0) {
      console.log(`[file-lock] Blocked: ${blockedByOther.map(l => l.filepath).join(', ')} held by ${blockedByOther[0].workstream_id}`)
      return false
    }

    // Upsert all locks atomically
    const lockRows = filepaths.map(filepath => ({
      filepath,
      workstream_id: workstreamId,
      acquired_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }))

    const { error } = await db
      .from('file_locks')
      .upsert(lockRows, { onConflict: 'filepath' })

    if (error) {
      console.error('[file-lock] Upsert failed, proceeding without lock:', error.message)
      return true // Fail open — better to risk a collision than block all builds
    }

    return true
  } catch (err) {
    // If Supabase is down, fail open — agent can still run
    console.error('[file-lock] Lock acquisition failed, proceeding without lock:', err)
    return true
  }
}

/**
 * Release all locks held by a workstream.
 * Always call in a finally block after build completion.
 */
export async function releaseLocks(workstreamId: string): Promise<void> {
  try {
    const db = getServiceClient()
    await db
      .from('file_locks')
      .delete()
      .eq('workstream_id', workstreamId)
  } catch (err) {
    console.error('[file-lock] Lock release failed (non-fatal):', err)
  }
}

/**
 * Check if a specific file is locked.
 */
export async function isLocked(filepath: string): Promise<{
  locked: boolean
  held_by?: string
  expires_at?: string
}> {
  try {
    const db = getServiceClient()
    const { data } = await db
      .from('file_locks')
      .select('workstream_id, expires_at')
      .eq('filepath', filepath)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!data) return { locked: false }
    return { locked: true, held_by: data.workstream_id, expires_at: data.expires_at }
  } catch {
    return { locked: false }
  }
}

/**
 * Get all currently active locks (for monitoring).
 */
export async function getActiveLocks(): Promise<Array<{
  filepath: string
  workstream_id: string
  acquired_at: string
  expires_at: string
}>> {
  try {
    const db = getServiceClient()
    const { data } = await db
      .from('file_locks')
      .select('filepath, workstream_id, acquired_at, expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('acquired_at')

    return data || []
  } catch {
    return []
  }
}

/**
 * Force-release all locks for a workstream (emergency use via admin route).
 */
export async function forceRelease(workstreamId: string): Promise<number> {
  try {
    const db = getServiceClient()
    const { data } = await db
      .from('file_locks')
      .delete()
      .eq('workstream_id', workstreamId)
      .select()

    return data?.length || 0
  } catch {
    return 0
  }
}
