/**
 * FORGE AI — Surgeon Agent
 *
 * Takes: ChangeManifest from Architect + existing file contents
 * Produces: exact file contents ready to commit
 *
 * The Surgeon EXECUTES — does not plan, does not invent.
 * It follows the manifest precisely.
 * One job: make exactly the changes specified, nothing more.
 */

import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import type { ChangeManifest, FileEdit } from './architect'
import { formatManifestForPrompt } from './architect'
import type { DiscoveryReport } from './discovery'
import { formatDiscoveryForPrompt } from './discovery'
import type { LivingSpec } from '../types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface SurgeonOutput {
  files: Record<string, string>   // filepath -> complete new content
  edits_applied: number
  edits_skipped: string[]         // edits where find string wasn't found
  new_files: string[]
  notes: string
}

const SURGEON_MODEL = process.env.SURGEON_MODEL || 'claude-sonnet-4-6'

/**
 * Fetch current file contents from GitHub for files in the manifest
 */
async function fetchFilesForManifest(manifest: ChangeManifest): Promise<Record<string, string>> {
  const token = process.env.GITHUB_TOKEN!
  const owner = process.env.GITHUB_OWNER!
  const repo = process.env.GITHUB_REPO!
  const octokit = new Octokit({ auth: token })

  const existingFiles: Record<string, string> = {}
  const filesToFetch = manifest.files_to_change
    .filter(e => e.type === 'edit')
    .map(e => e.file)

  await Promise.allSettled(
    filesToFetch.map(async path => {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path })
        if ('content' in data && data.content) {
          existingFiles[path] = Buffer.from(data.content, 'base64').toString('utf-8')
        }
      } catch { /* file may not exist yet */ }
    })
  )

  return existingFiles
}

/**
 * Apply surgical edits without LLM for simple find/replace
 * Falls back to LLM for complex edits
 */
function applySurgicalEdit(
  content: string,
  edit: FileEdit
): { result: string; applied: boolean; reason?: string } {
  if (!edit.find || edit.replace === undefined) {
    return { result: content, applied: false, reason: 'No find/replace provided' }
  }

  if (!content.includes(edit.find)) {
    return { result: content, applied: false, reason: `Find string not found in ${edit.file}` }
  }

  const occurrences = content.split(edit.find).length - 1
  if (occurrences > 1) {
    // Find string is not unique — need LLM to handle it
    return { result: content, applied: false, reason: `Find string appears ${occurrences} times — not unique` }
  }

  return { result: content.replace(edit.find, edit.replace), applied: true }
}

/**
 * Use LLM to apply an edit when find/replace is ambiguous or complex
 */
async function applyEditWithLLM(
  fileContent: string,
  edit: FileEdit,
  discovery: DiscoveryReport
): Promise<string> {
  const discoveryContext = formatDiscoveryForPrompt(discovery)

  const response = await anthropic.messages.create({
    model: SURGEON_MODEL,
    max_tokens: 16000,
    temperature: 0,
    system: `You are a surgical code editor. Apply EXACTLY the specified change to the file.
Do NOT change anything else. Do NOT add comments. Do NOT reformat.
Return the complete updated file content as plain text — no markdown, no explanation.

${discoveryContext}`,
    messages: [{
      role: 'user',
      content: `Apply this change to the file:

CHANGE: ${edit.description}
${edit.find ? `FIND THIS:\n${edit.find}\n\nREPLACE WITH:\n${edit.replace}` : `CREATE/REPLACE WITH:\n${edit.content}`}

CURRENT FILE CONTENT:
${fileContent}

Return the complete updated file content:`
    }]
  })

  return response.content[0].type === 'text' ? response.content[0].text : fileContent
}

/**
 * Main Surgeon execution
 */
export async function runSurgeonAgent(
  manifest: ChangeManifest,
  discovery: DiscoveryReport,
  livingSpec: LivingSpec
): Promise<SurgeonOutput> {

  const existingFiles = await fetchFilesForManifest(manifest)
  const outputFiles: Record<string, string> = {}
  const editsSkipped: string[] = []
  const newFiles: string[] = []
  let editsApplied = 0

  for (const edit of manifest.files_to_change) {
    try {
      if (edit.type === 'create') {
        // New file — use provided content or generate it
        if (edit.content) {
          outputFiles[edit.file] = edit.content
          newFiles.push(edit.file)
          editsApplied++
        } else {
          // Need to generate content — use LLM
          const manifestContext = formatManifestForPrompt(manifest)
          const discoveryContext = formatDiscoveryForPrompt(discovery)
          const stack = livingSpec.content.tech_stack.map(t => `${t.layer}: ${t.choice}`).join(' | ')

          const response = await anthropic.messages.create({
            model: SURGEON_MODEL,
            max_tokens: 8000,
            temperature: 0.1,
            system: `You are the Surgeon Agent. Generate exactly the new file described.
Follow the architect's plan precisely. Match existing code patterns.
Stack: ${stack}

${discoveryContext}
${manifestContext}

Output ONLY the file content — no markdown, no explanation.`,
            messages: [{
              role: 'user',
              content: `Generate the new file: ${edit.file}\n\nPurpose: ${edit.description}\n${edit.exports_added ? `Must export: ${edit.exports_added.join(', ')}` : ''}`
            }]
          })

          outputFiles[edit.file] = response.content[0].type === 'text'
            ? response.content[0].text
            : ''
          newFiles.push(edit.file)
          editsApplied++
        }

      } else if (edit.type === 'edit') {
        const currentContent = existingFiles[edit.file] || ''

        if (!currentContent) {
          editsSkipped.push(`${edit.file}: file not found in repo`)
          continue
        }

        // Try surgical find/replace first
        const { result, applied, reason } = applySurgicalEdit(currentContent, edit)

        if (applied) {
          outputFiles[edit.file] = result
          editsApplied++
        } else {
          console.log(`[Surgeon] Falling back to LLM for ${edit.file}: ${reason}`)
          // Fall back to LLM
          const updated = await applyEditWithLLM(currentContent, edit, discovery)
          if (updated !== currentContent) {
            outputFiles[edit.file] = updated
            editsApplied++
          } else {
            editsSkipped.push(`${edit.file}: LLM returned unchanged content — ${reason}`)
          }
        }

      } else if (edit.type === 'delete') {
        // Mark for deletion (file-writer handles this)
        outputFiles[edit.file] = '__DELETE__'
        editsApplied++
      }

    } catch (err) {
      editsSkipped.push(`${edit.file}: ${String(err)}`)
      console.error(`[Surgeon] Error applying edit to ${edit.file}:`, err)
    }
  }

  const notes = [
    `Applied ${editsApplied}/${manifest.files_to_change.length} edits`,
    editsSkipped.length > 0 ? `Skipped: ${editsSkipped.join('; ')}` : null,
    newFiles.length > 0 ? `New files: ${newFiles.join(', ')}` : null,
  ].filter(Boolean).join('. ')

  return {
    files: outputFiles,
    edits_applied: editsApplied,
    edits_skipped: editsSkipped,
    new_files: newFiles,
    notes
  }
}
