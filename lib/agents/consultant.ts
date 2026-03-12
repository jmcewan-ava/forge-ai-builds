/**
 * FORGE AI — Consultant Agent
 *
 * Called on-demand when the Architect hits genuine ambiguity.
 * Senior opinion. Hands back a recommendation, doesn't implement.
 *
 * This is the "phone a friend" of the dream team.
 * When requirements are contradictory, when there are two valid
 * architectural paths and the brief doesn't specify — call the Consultant.
 *
 * The Consultant is Opus. It costs more. Use it sparingly.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LivingSpec } from '../types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface ConsultantRecommendation {
  decision: string                    // the recommended approach, clearly stated
  rationale: string                   // why this approach
  trade_offs: string[]                // what we're giving up
  alternative_considered: string      // the other main option
  why_not_alternative: string         // why we're not doing that
  confidence: 'high' | 'medium' | 'low'
  requires_spec_update: boolean       // should this be written into the living spec?
  spec_update_suggestion?: string     // if yes, what to add to the spec
  reversible: boolean                 // can we change our mind later easily?
}

const CONSULTANT_MODEL = process.env.CONSULTANT_MODEL || 'claude-opus-4-6'

export async function runConsultantAgent(
  question: string,
  context: string,
  livingSpec: LivingSpec,
  workstreamName: string
): Promise<ConsultantRecommendation> {

  const stack = livingSpec.content.tech_stack.map(t => `${t.layer}: ${t.choice}`).join('\n')
  const constraints = livingSpec.content.constraints.join('\n')
  const decisions = (livingSpec.content.architecture || [])
    .filter(a => a.status === 'decided')
    .map(a => `${a.component}: ${a.description}`)
    .join('\n')

  const systemPrompt = `You are the Consultant Agent in the Forge AI system.

You are the most senior engineer on the team. When there is genuine ambiguity,
you are asked for a recommendation. You give one clear, actionable answer.

You do NOT implement. You do NOT hedge with "it depends" without resolution.
You pick an approach, explain why, and move on.

Tech stack:
${stack}

Hard constraints:
${constraints}

Prior architectural decisions:
${decisions}

Product vision: ${livingSpec.content.vision}

Give a direct recommendation. Be decisive. The team needs to move.

Output ONLY valid JSON:
{
  "decision": "Use find/replace surgical edits rather than whole-file rewrites. The Surgeon agent should always receive the current file content and return only the changed lines wrapped in a find/replace structure.",
  "rationale": "Whole-file rewrites cause merge conflicts and destroy context about code the Surgeon didn't read. Surgical edits are auditable, reversible, and composable.",
  "trade_offs": ["Slightly more complex prompt engineering", "Find strings must be unique in file"],
  "alternative_considered": "Return complete new file content for every changed file",
  "why_not_alternative": "Whole file rewrites have caused 100% of the type errors seen today because the agent rewrites function signatures it didn't understand",
  "confidence": "high",
  "requires_spec_update": true,
  "spec_update_suggestion": "Add to architecture decisions: Builder agents must use surgical find/replace edits, never whole-file rewrites for existing files",
  "reversible": true
}`

  try {
    const response = await anthropic.messages.create({
      model: CONSULTANT_MODEL,
      max_tokens: 4000,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Workstream: "${workstreamName}"

Question requiring your recommendation:
${question}

Context:
${context}

What do you recommend?`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    return parsed as ConsultantRecommendation

  } catch (err) {
    console.error('[Consultant] Failed:', err)
    return {
      decision: `Consultant failed to respond: ${String(err)}`,
      rationale: 'Agent error',
      trade_offs: [],
      alternative_considered: '',
      why_not_alternative: '',
      confidence: 'low',
      requires_spec_update: false,
      reversible: true
    }
  }
}
