/**
 * FORGE AI — Repo Reader
 *
 * Fetches existing file contents from GitHub before any builder agent runs.
 * This is the single most important quality improvement — builders that can
 * see what already exists don't overwrite work or write conflicting code.
 *
 * Uses the GitHub REST API v3 contents endpoint.
 * 404 = new file (not an error — builder should create it fresh).
 * Any other error = logged but non-fatal (build continues without that file).
 */

interface GitHubFileResponse {
  content: string
  encoding: string
  sha: string
  size: number
}

/**
 * Fetch the contents of multiple files from a GitHub repo.
 *
 * @param filePaths  Array of repo-relative paths e.g. ['lib/foo.ts', 'app/api/bar/route.ts']
 * @returns Map of filepath → file contents (empty string = file does not exist yet)
 */
export async function fetchRepoFiles(
  filePaths: string[]
): Promise<Record<string, string>> {
  const owner = process.env.GITHUB_OWNER
  const repo  = process.env.GITHUB_REPO
  const token = process.env.GITHUB_TOKEN

  if (!owner || !repo || !token) {
    console.warn('[repo-reader] Missing GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN — skipping repo read')
    return {}
  }

  if (!filePaths || filePaths.length === 0) return {}

  const results: Record<string, string> = {}

  // Fetch in parallel — GitHub API allows this fine at our scale
  await Promise.allSettled(
    filePaths.map(async (filePath) => {
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          // Next.js: don't cache — always fetch latest
          cache: 'no-store',
        })

        if (res.status === 404) {
          // File doesn't exist yet — this is expected for new files
          results[filePath] = ''
          return
        }

        if (!res.ok) {
          console.warn(`[repo-reader] GitHub API ${res.status} for ${filePath}: ${res.statusText}`)
          results[filePath] = ''
          return
        }

        const data: GitHubFileResponse = await res.json()

        if (data.encoding === 'base64' && data.content) {
          // GitHub returns base64-encoded content
          const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
          results[filePath] = decoded
        } else {
          results[filePath] = ''
        }

      } catch (err) {
        // Non-fatal: if we can't read a file, builder works without context for that file
        console.warn(`[repo-reader] Failed to fetch ${filePath}:`, err)
        results[filePath] = ''
      }
    })
  )

  return results
}

/**
 * Format existing file contents for injection into a builder's context packet.
 * Files that don't exist are labelled as NEW so the builder knows to create them.
 */
export function formatExistingFiles(fileMap: Record<string, string>): string {
  if (Object.keys(fileMap).length === 0) return ''

  const lines: string[] = ['EXISTING FILE CONTENTS (read before writing — do not duplicate or conflict with this code):']

  for (const [path, content] of Object.entries(fileMap)) {
    if (!content) {
      lines.push(`\n--- ${path} [NEW FILE — does not exist yet, create from scratch] ---`)
    } else {
      // Truncate very large files to avoid blowing the context window
      const truncated = content.length > 8000
        ? content.slice(0, 8000) + `\n... [truncated — ${content.length} chars total. Read the full file via GitHub if needed]`
        : content
      lines.push(`\n--- ${path} [EXISTING — modify carefully, preserve what isn't changing] ---`)
      lines.push(truncated)
    }
  }

  return lines.join('\n')
}
