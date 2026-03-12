/**
 * FORGE AI — File Lock Registry
 * 
 * Prevents two parallel Builder Agents from writing to the same file.
 * Singleton in-memory Map. TTL-based auto-release.
 * 
 * For multi-instance deployment: replace with Redis (Phase 5).
 */

interface FileLock {
  filepath: string
  workstream_id: string
  acquired_at: Date
  ttl_ms: number
}

// ─── SINGLETON REGISTRY ───────────────────────────────────────────────────────

const registry = new Map<string, FileLock>()

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Attempt to acquire locks on all filepaths for a workstream.
 * Atomic: either all locks acquired, or none.
 * Returns false if any file is already locked by another workstream.
 */
export async function acquireLocks(
  filepaths: string[],
  workstreamId: string,
  ttlMs: number = 120_000
): Promise<boolean> {
  cleanExpiredLocks()

  if (!filepaths.length) return true

  // Check if any files are locked by a DIFFERENT workstream
  for (const filepath of filepaths) {
    const existing = registry.get(filepath)
    if (existing && existing.workstream_id !== workstreamId) {
      // Locked by someone else
      return false
    }
  }

  // All clear — acquire all locks
  const now = new Date()
  for (const filepath of filepaths) {
    registry.set(filepath, {
      filepath,
      workstream_id: workstreamId,
      acquired_at: now,
      ttl_ms: ttlMs
    })
  }

  return true
}

/**
 * Release all locks held by a workstream.
 * Always call in a finally block after build completion.
 */
export async function releaseLocks(workstreamId: string): Promise<void> {
  for (const [filepath, lock] of Array.from(registry.entries())) {
    if (lock.workstream_id === workstreamId) {
      registry.delete(filepath)
    }
  }
}

/**
 * Check if a specific file is locked.
 */
export function isLocked(filepath: string): {
  locked: boolean
  held_by?: string
  expires_at?: Date
} {
  cleanExpiredLocks()
  
  const lock = registry.get(filepath)
  if (!lock) return { locked: false }

  const expiresAt = new Date(lock.acquired_at.getTime() + lock.ttl_ms)
  return {
    locked: true,
    held_by: lock.workstream_id,
    expires_at: expiresAt
  }
}

/**
 * Get all currently active locks (for debugging / monitoring).
 */
export function getActiveLocks(): Array<{
  filepath: string
  workstream_id: string
  acquired_at: string
  expires_at: string
}> {
  cleanExpiredLocks()
  
  return Array.from(registry.values()).map(lock => ({
    filepath: lock.filepath,
    workstream_id: lock.workstream_id,
    acquired_at: lock.acquired_at.toISOString(),
    expires_at: new Date(lock.acquired_at.getTime() + lock.ttl_ms).toISOString()
  }))
}

/**
 * Clear all locks for a given workstream (emergency use).
 */
export function forceRelease(workstreamId: string): number {
  let released = 0
  for (const [filepath, lock] of Array.from(registry.entries())) {
    if (lock.workstream_id === workstreamId) {
      registry.delete(filepath)
      released++
    }
  }
  return released
}

// ─── PRIVATE ─────────────────────────────────────────────────────────────────

function cleanExpiredLocks(): void {
  const now = Date.now()
  for (const [filepath, lock] of Array.from(registry.entries())) {
    const expiresAt = lock.acquired_at.getTime() + lock.ttl_ms
    if (now > expiresAt) {
      registry.delete(filepath)
      console.log(`File lock expired and released: ${filepath} (was held by ${lock.workstream_id})`)
    }
  }
}
