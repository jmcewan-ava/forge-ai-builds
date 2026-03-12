/**
 * FORGE AI — Type Checker Agent
 *
 * Validates TypeScript correctness of surgeon output BEFORE QA.
 * Binary: pass or fail with exact error lines.
 *
 * Uses the Anthropic API to simulate tsc — checks:
 * 1. Function call signatures match definitions
 * 2. Import paths resolve to actual exports
 * 3. Type assignments are compatible
 * 4. No implicit any in critical paths
 *
 * This is the agent that would have caught every single error today.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { DiscoveryReport } from './discovery'
import { formatDiscoveryForPrompt } from './discovery'
import type { SurgeonOutput } from './surgeon'
import type { ChangeManifest } from './architect'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface TypeCheckResult {
  passed: boolean
  errors: TypeCheckError[]
  warnings: string[]
  files_checked: string[]
}

export interface TypeCheckError {
  file: string
  line_hint?: string      // approximate location
  error: string           // TypeScript error message
  severity: 'error' | 'warning'
  fix_hint?: string       // suggested fix
}

const TYPE_CHECKER_MODEL = process.env.TYPE_CHECKER_MODEL || 'claude-sonnet-4-6'

export async function runTypeCheckerAgent(
  surgeonOutput: SurgeonOutput,
  manifest: ChangeManifest,
  discovery: DiscoveryReport
): Promise<TypeCheckResult> {

  if (Object.keys(surgeonOutput.files).length === 0) {
    return {
      passed: false,
      errors: [{ file: 'unknown', error: 'No files produced by surgeon', severity: 'error' }],
      warnings: [],
      files_checked: []
    }
  }

  const discoveryContext = formatDiscoveryForPrompt(discovery)

  // Build a code snapshot for the type checker to analyse
  const codeSnapshot = Object.entries(surgeonOutput.files)
    .filter(([, content]) => content !== '__DELETE__')
    .map(([path, content]) => `\n\n=== ${path} ===\n${content}`)
    .join('')

  const systemPrompt = `You are a TypeScript type checker. Your job is to find real TypeScript errors in code.

You have the full discovery report showing all exported functions and their exact signatures.
Use this to verify every function call has the correct arguments.

${discoveryContext}

CHECK FOR THESE SPECIFIC ERROR TYPES:
1. Wrong number of arguments to a function call
2. Wrong argument types (e.g. passing a Workstream where string is expected)
3. Wrong argument ORDER (e.g. passing (builderOutput, workstream) when signature is (workstream, builderOutput))
4. Importing a name that doesn't exist in the source module
5. Calling a function that was renamed (e.g. runAutonomous vs runFullProject)
6. Chaining .catch() on a Supabase query builder (not a real Promise)
7. Type assertion errors (casting to incompatible types without 'unknown' intermediary)

Be strict. Only report real TypeScript errors, not style issues.
If the code looks correct, say it passes.

Output ONLY valid JSON:
{
  "passed": true,
  "errors": [],
  "warnings": ["Minor: consider explicit return type on line X"],
  "files_checked": ["lib/orchestrator.ts"]
}

Or if there are errors:
{
  "passed": false,
  "errors": [
    {
      "file": "lib/orchestrator.ts",
      "line_hint": "near: await releaseLocks(estimatedFiles, workstream.id)",
      "error": "Expected 1 arguments, but got 2. releaseLocks(workstreamId: string): Promise<void>",
      "severity": "error",
      "fix_hint": "Remove estimatedFiles — releaseLocks only needs workstream.id"
    }
  ],
  "warnings": [],
  "files_checked": ["lib/orchestrator.ts"]
}`

  try {
    const response = await anthropic.messages.create({
      model: TYPE_CHECKER_MODEL,
      max_tokens: 4000,
      temperature: 0,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Type-check these files for TypeScript errors:\n${codeSnapshot}`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    return {
      passed: parsed.passed ?? false,
      errors: parsed.errors || [],
      warnings: parsed.warnings || [],
      files_checked: parsed.files_checked || Object.keys(surgeonOutput.files)
    }

  } catch (err) {
    console.error('[TypeChecker] Failed:', err)
    return {
      passed: false,
      errors: [{
        file: 'type-checker',
        error: `Type checker agent failed: ${String(err)}`,
        severity: 'error'
      }],
      warnings: [],
      files_checked: []
    }
  }
}

/**
 * Format type check result as feedback for the Surgeon to fix
 */
export function formatTypeErrorsForSurgeon(result: TypeCheckResult): string {
  if (result.passed) return 'Type check passed ✓'

  return `TYPE CHECK FAILED — Fix these errors before proceeding:\n\n${
    result.errors.map((e, i) =>
      `${i + 1}. [${e.file}] ${e.error}${e.line_hint ? `\n   Near: ${e.line_hint}` : ''}${e.fix_hint ? `\n   Fix: ${e.fix_hint}` : ''}`
    ).join('\n\n')
  }`
}
