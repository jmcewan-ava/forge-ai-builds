/**
 * FORGE AI — Architect Agent
 *
 * Takes: brief + Discovery report
 * Produces: a precise ChangeManifest — what to change, where, why
 *
 * The Architect plans the work. The Surgeon executes it.
 * No code is written here. Only decisions.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { DiscoveryReport } from './discovery'
import { formatDiscoveryForPrompt } from './discovery'
import type { LivingSpec } from '../types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface FileEdit {
  file: string
  type: 'create' | 'edit' | 'delete'
  description: string           // what this change does
  find?: string                 // for edits: exact text to find (must be unique in file)
  replace?: string              // for edits: exact replacement text
  content?: string              // for creates: full file content
  imports_needed?: string[]     // new imports this change requires
  exports_added?: string[]      // new exports this change creates
  exports_changed?: string[]    // existing exports whose signatures change (RISKY)
  callers_to_update?: string[]  // files that call changed exports (must also be in manifest)
}

export interface ChangeManifest {
  approach: string              // 1-paragraph explanation of the chosen approach
  why_this_approach: string     // why this approach vs alternatives
  risks: string[]               // what could go wrong
  files_to_change: FileEdit[]
  files_to_leave_alone: string[] // explicitly NOT touching these
  estimated_tokens: number       // rough estimate for builder
  requires_migration: boolean    // does this need a DB migration?
  migration_sql?: string         // if yes, the SQL
  test_cases: string[]           // what Behaviour QA should verify
}

const ARCHITECT_MODEL = process.env.ARCHITECT_MODEL || 'claude-opus-4-6'

export async function runArchitectAgent(
  workstreamName: string,
  brief: string,
  discovery: DiscoveryReport,
  livingSpec: LivingSpec
): Promise<ChangeManifest> {

  const discoveryContext = formatDiscoveryForPrompt(discovery)
  const stack = livingSpec.content.tech_stack.map(t => `${t.layer}: ${t.choice}`).join(' | ')

  const systemPrompt = `You are the Architect Agent in the Forge AI system.

Your job: read the brief and the discovery report, then produce a precise change manifest.
You do NOT write code. You plan what code needs to change and exactly how.

Stack: ${stack}
Project: ${livingSpec.content.vision}

${discoveryContext}

ARCHITECT PRINCIPLES:
1. Surgical precision — change the minimum number of files to achieve the goal
2. Dependency safety — if you change a function signature, list ALL callers that need updating
3. Import safety — every new import must reference a function that actually exists with that exact name
4. No orphan changes — every file edit is complete and consistent with every other edit
5. Prefer editing existing files over creating new ones when sensible
6. New files should follow existing patterns in the codebase

For each file edit, you must provide either:
- For EXISTING files: an exact "find" string (must be unique in the file) and "replace" string
- For NEW files: complete file content

The find string must be copy-pasted from the actual file content — do NOT paraphrase it.

Output ONLY valid JSON:
{
  "approach": "We will modify lib/orchestrator.ts to add X by changing function Y...",
  "why_this_approach": "Alternative was to create a new file but X already handles...",
  "risks": ["Changing runWorkstream signature affects run/route.ts caller"],
  "files_to_change": [
    {
      "file": "lib/orchestrator.ts",
      "type": "edit",
      "description": "Add agent status cleanup at end of runPhase",
      "find": "  return phaseResult\\n}",
      "replace": "  await cleanupAgents(projectId)\\n  return phaseResult\\n}",
      "imports_needed": [],
      "exports_added": [],
      "exports_changed": [],
      "callers_to_update": []
    },
    {
      "file": "lib/agents/new-helper.ts",
      "type": "create",
      "description": "New helper for X",
      "content": "// complete file content here",
      "exports_added": ["helperFunction"]
    }
  ],
  "files_to_leave_alone": ["lib/file-lock.ts", "lib/supabase.ts"],
  "estimated_tokens": 3000,
  "requires_migration": false,
  "test_cases": [
    "Agent status should be idle after runPhase completes",
    "No ghost 'running' agents visible in dashboard after build"
  ]
}`

  try {
    const response = await anthropic.messages.create({
      model: ARCHITECT_MODEL,
      max_tokens: 8000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Plan the changes for workstream: "${workstreamName}"\n\nBrief:\n${brief}`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    return parsed as ChangeManifest

  } catch (err) {
    console.error('[Architect] Failed to produce change manifest:', err)
    throw new Error(`Architect agent failed: ${String(err)}`)
  }
}

/**
 * Format manifest for Surgeon prompt injection
 */
export function formatManifestForPrompt(manifest: ChangeManifest): string {
  const risks = manifest.risks.length > 0
    ? `\nRISKS THE ARCHITECT IDENTIFIED:\n${manifest.risks.map(r => `  ⚠ ${r}`).join('\n')}`
    : ''

  const changes = manifest.files_to_change.map((edit, i) => {
    if (edit.type === 'create') {
      return `[${i + 1}] CREATE ${edit.file}\n    ${edit.description}`
    }
    return `[${i + 1}] EDIT ${edit.file}\n    ${edit.description}\n    Callers to update: ${edit.callers_to_update?.join(', ') || 'none'}`
  }).join('\n')

  return `=== ARCHITECT MANIFEST ===
Approach: ${manifest.approach}
${risks}

PLANNED CHANGES (${manifest.files_to_change.length} files):
${changes}

FILES TO LEAVE ALONE: ${manifest.files_to_leave_alone.join(', ') || 'none specified'}

TEST CASES FOR QA:
${manifest.test_cases.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}
=== END MANIFEST ===`
}
