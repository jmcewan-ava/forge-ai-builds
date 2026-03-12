/**
 * FORGE AI — GitHub File Writer
 * 
 * Commits builder-generated code to GitHub via the REST API.
 * Creates feature branches, commits files, opens PRs.
 * 
 * Requires: @octokit/rest
 * Env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
 */

import { Octokit } from '@octokit/rest'
import type { GitHubConfig, CommitResult } from './types'

// ─── MAIN COMMIT FUNCTION ─────────────────────────────────────────────────────

/**
 * Commits a set of files to a new feature branch and opens a PR.
 * Rolls back all files if any commit fails.
 */
export async function commitFiles(
  workstreamId: string,
  workstreamName: string,
  files: Record<string, string>,  // filepath → content
  config: GitHubConfig
): Promise<CommitResult> {
  const octokit = new Octokit({ auth: config.token })
  const branchName = `forge/ws-${workstreamId}`
  const committedFiles: string[] = []

  // ── Get default branch SHA ────────────────────────────────────────────────

  const { data: refData } = await octokit.rest.git.getRef({
    owner: config.owner,
    repo: config.repo,
    ref: `heads/${config.defaultBranch}`
  })

  const baseSha = refData.object.sha

  // ── Create feature branch (or get existing) ───────────────────────────────

  try {
    await octokit.rest.git.createRef({
      owner: config.owner,
      repo: config.repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    })
  } catch (err: any) {
    // Branch already exists — that's fine, we'll commit to it
    if (!err.message?.includes('already exists')) throw err
  }

  // ── Commit each file ──────────────────────────────────────────────────────

  for (const [filepath, content] of Object.entries(files)) {
    try {
      // Check if file exists (need SHA for updates)
      let existingSha: string | undefined
      try {
        const { data: existing } = await octokit.rest.repos.getContent({
          owner: config.owner,
          repo: config.repo,
          path: filepath,
          ref: branchName
        })
        if (!Array.isArray(existing) && existing.type === 'file') {
          existingSha = existing.sha
        }
      } catch {
        // File doesn't exist yet — create it
      }

      // Commit the file
      await withRetry(async () => {
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: config.owner,
          repo: config.repo,
          path: filepath,
          message: `forge: ${workstreamName} [${workstreamId.substring(0, 8)}]`,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch: branchName,
          ...(existingSha ? { sha: existingSha } : {})
        })
      })

      committedFiles.push(filepath)
    } catch (err) {
      // Rollback already-committed files
      await rollbackFiles(workstreamId, committedFiles, config)
      throw new Error(
        `File commit failed for ${filepath}: ${String(err)}. ` +
        `Rolled back ${committedFiles.length} previously committed files.`
      )
    }
  }

  // ── Open PR ───────────────────────────────────────────────────────────────

  let prUrl: string | undefined
  let prNumber: number | undefined

  try {
    // Check if PR already exists for this branch (idempotent)
    const { data: existingPRs } = await octokit.rest.pulls.list({
      owner: config.owner,
      repo: config.repo,
      head: `${config.owner}:${branchName}`,
      state: 'open',
    })

    if (existingPRs.length > 0) {
      prUrl = existingPRs[0].html_url
      prNumber = existingPRs[0].number
    } else {
      const { data: pr } = await octokit.rest.pulls.create({
        owner: config.owner,
        repo: config.repo,
        title: `Forge AI: ${workstreamName}`,
        body: buildPRBody(workstreamId, workstreamName, committedFiles),
        head: branchName,
        base: config.defaultBranch
      })
      prUrl = pr.html_url
      prNumber = pr.number
    }
  } catch (err) {
    // PR creation failure is non-fatal — files are committed
    console.error('PR creation failed (non-fatal):', err)
  }

  return {
    pr_url: prUrl,
    pr_number: prNumber,
    files_committed: committedFiles,
    branch: branchName
  }
}

// ─── ROLLBACK ─────────────────────────────────────────────────────────────────

/**
 * Deletes files from the branch to roll back a failed commit set.
 * Best-effort — does not throw if individual deletes fail.
 */
export async function rollbackFiles(
  workstreamId: string,
  filepaths: string[],
  config: GitHubConfig
): Promise<void> {
  const octokit = new Octokit({ auth: config.token })
  const branchName = `forge/ws-${workstreamId}`

  for (const filepath of filepaths) {
    try {
      const { data: existing } = await octokit.rest.repos.getContent({
        owner: config.owner,
        repo: config.repo,
        path: filepath,
        ref: branchName
      })

      if (!Array.isArray(existing) && existing.type === 'file') {
        await octokit.rest.repos.deleteFile({
          owner: config.owner,
          repo: config.repo,
          path: filepath,
          message: `forge: rollback ${workstreamId.substring(0, 8)}`,
          sha: existing.sha,
          branch: branchName
        })
      }
    } catch {
      // Best-effort rollback — continue even if individual delete fails
    }
  }
}

// ─── GET EXISTING FILES ───────────────────────────────────────────────────────

/**
 * Returns a flat list of all file paths in the repo's default branch.
 * Used by the orchestrator to prevent file collisions.
 */
export async function getExistingFiles(config: GitHubConfig): Promise<string[]> {
  const octokit = new Octokit({ auth: config.token })

  try {
    const { data: tree } = await octokit.rest.git.getTree({
      owner: config.owner,
      repo: config.repo,
      tree_sha: config.defaultBranch,
      recursive: '1'
    })

    return tree.tree
      .filter(item => item.type === 'blob' && item.path)
      .map(item => item.path!)
  } catch {
    return []
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3
): Promise<T> {
  let lastError: unknown
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      
      // Don't retry on auth errors or 404s
      if (err.status === 401 || err.status === 403 || err.status === 404) throw err
      
      if (attempt < maxAttempts) {
        const delayMs = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
        console.log(`GitHub API retry ${attempt}/${maxAttempts} after ${delayMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  
  throw lastError
}

function buildPRBody(
  workstreamId: string,
  workstreamName: string,
  files: string[]
): string {
  return `## Forge AI — ${workstreamName}

**Workstream ID:** \`${workstreamId}\`
**Files produced:** ${files.length}

### Files
${files.map(f => `- \`${f}\``).join('\n')}

---
*Generated autonomously by Forge AI. Reviewed by QA Manager before commit.*
*Merge this PR to mark the workstream as complete.*`
}
