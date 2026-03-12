/**
 * FORGE AI — Behaviour QA Agent
 *
 * Checks: did we actually build what was asked?
 *
 * This is SEPARATE from type checking.
 * TypeChecker asks: "Does it compile?"
 * BehaviourQA asks: "Does it do what the brief said?"
 *
 * Reads the brief, reads the produced code diff, asks:
 * - Are all requirements implemented?
 * - Are there edge cases the brief mentioned that aren't handled?
 * - Is anything implemented that wasn't asked for (scope creep)?
 * - Are error states handled?
 * - Are there obvious bugs in the logic?
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SurgeonOutput } from './surgeon'
import type { ChangeManifest } from './architect'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface BehaviourQAResult {
  passed: boolean
  requirements_met: string[]      // requirements from brief that are implemented
  requirements_missing: string[]  // requirements from brief that are NOT implemented
  bugs_found: string[]            // logic errors in the code
  scope_creep: string[]           // things implemented but not asked for
  revised_brief?: string          // if failed: updated brief with specific gaps
  escalate: boolean               // true if needs human review
  escalation_reason?: string
}

const QA_MODEL = process.env.QA_MODEL || 'claude-sonnet-4-6'

export async function runBehaviourQAAgent(
  workstreamName: string,
  brief: string,
  surgeonOutput: SurgeonOutput,
  manifest: ChangeManifest,
  iteration: number
): Promise<BehaviourQAResult> {

  const MAX_ITERATIONS = parseInt(process.env.MAX_QA_ITERATIONS || '3')

  if (iteration >= MAX_ITERATIONS) {
    return {
      passed: false,
      requirements_met: [],
      requirements_missing: ['Max QA iterations reached'],
      bugs_found: [],
      scope_creep: [],
      escalate: true,
      escalation_reason: `Behaviour QA failed after ${iteration} iterations. Brief may need to be rewritten by human.`
    }
  }

  if (surgeonOutput.edits_applied === 0 && Object.keys(surgeonOutput.files).length === 0) {
    return {
      passed: false,
      requirements_met: [],
      requirements_missing: ['No files were produced'],
      bugs_found: ['Surgeon produced no output'],
      scope_creep: [],
      escalate: iteration >= MAX_ITERATIONS - 1,
      escalation_reason: 'No code was produced — workstream may be too vague or too large'
    }
  }

  const codeSnapshot = Object.entries(surgeonOutput.files)
    .filter(([, content]) => content !== '__DELETE__')
    .map(([path, content]) => `\n\n=== ${path} ===\n${content}`)
    .join('')

  const systemPrompt = `You are the Behaviour QA Agent in the Forge AI system.

Your job: verify the code does what the brief asked.
You are NOT checking TypeScript types — a separate agent does that.
You ARE checking: logic, behaviour, completeness, edge cases.

Be practical and focused on what matters. Don't nitpick style.
If the core requirements are met and the logic is sound, pass it.

Output ONLY valid JSON:
{
  "passed": true,
  "requirements_met": ["User can toggle autonomous mode", "State persists across page reloads"],
  "requirements_missing": [],
  "bugs_found": [],
  "scope_creep": [],
  "escalate": false
}

Or if failed:
{
  "passed": false,
  "requirements_met": ["Toggle is visible"],
  "requirements_missing": ["State is not persisted — localStorage not used"],
  "bugs_found": ["Missing null check on line with localStorage.getItem"],
  "scope_creep": [],
  "revised_brief": "Original brief + specific gaps: Must use localStorage key 'forge_autonomous'. Must handle case where localStorage is unavailable (SSR). Must read initial state from localStorage on component mount.",
  "escalate": false
}`

  try {
    const response = await anthropic.messages.create({
      model: QA_MODEL,
      max_tokens: 4000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Review this workstream: "${workstreamName}"

ORIGINAL BRIEF:
${brief}

ARCHITECT'S PLAN:
${manifest.approach}

TEST CASES TO VERIFY:
${manifest.test_cases.map((t, i) => `${i + 1}. ${t}`).join('\n')}

CODE PRODUCED:
${codeSnapshot}

Surgeon notes: ${surgeonOutput.notes}
Skipped edits: ${surgeonOutput.edits_skipped.join(', ') || 'none'}

Does this code satisfy the brief? Check every requirement.`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    return {
      passed: parsed.passed ?? false,
      requirements_met: parsed.requirements_met || [],
      requirements_missing: parsed.requirements_missing || [],
      bugs_found: parsed.bugs_found || [],
      scope_creep: parsed.scope_creep || [],
      revised_brief: parsed.revised_brief,
      escalate: parsed.escalate ?? false,
      escalation_reason: parsed.escalation_reason
    }

  } catch (err) {
    console.error('[BehaviourQA] Failed:', err)
    return {
      passed: false,
      requirements_met: [],
      requirements_missing: ['QA agent failed to run'],
      bugs_found: [String(err)],
      scope_creep: [],
      escalate: false
    }
  }
}
