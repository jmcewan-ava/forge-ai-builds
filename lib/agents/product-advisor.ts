/**
 * FORGE AI — Product Advisor Agent
 *
 * Thinks like a user. Uses the running app to find what's broken,
 * confusing, or missing. Generates improvement briefs unprompted.
 *
 * This is the agent that would have said:
 * "the log panel is too small and you can't tell when a PR merges"
 *
 * Runs after every successful deploy. Produces a list of briefs
 * that can be auto-submitted or queued for human approval.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LivingSpec, Workstream } from '../types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface ImprovementBrief {
  title: string
  brief: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  category: 'ux' | 'reliability' | 'performance' | 'feature' | 'observability'
  why: string              // one line: why this matters
  what_triggered_it: string  // what the advisor observed that led to this
  estimated_effort: 'small' | 'medium' | 'large'
  auto_submit: boolean     // safe to auto-submit without human approval?
}

export interface ProductAdvisorResult {
  observations: string[]           // what the advisor noticed
  briefs: ImprovementBrief[]
  deferred: string[]               // things noticed but not yet worth a brief
  overall_health: 'green' | 'yellow' | 'red'
  health_reason: string
}

const ADVISOR_MODEL = process.env.ADVISOR_MODEL || 'claude-sonnet-4-6'

export async function runProductAdvisorAgent(
  projectVision: string,
  livingSpec: LivingSpec,
  recentWorkstreams: Workstream[],
  deploymentUrl: string
): Promise<ProductAdvisorResult> {

  const completedWork = recentWorkstreams
    .filter(ws => ws.status === 'complete')
    .slice(0, 10)
    .map(ws => `- ${ws.name}: ${ws.description}`)
    .join('\n')

  const escalatedWork = recentWorkstreams
    .filter(ws => ws.status === 'escalated' || ws.status === 'failed')
    .map(ws => `- ${ws.name}: ${ws.description}`)
    .join('\n')

  const systemPrompt = `You are the Product Advisor Agent in the Forge AI system.

You think like an experienced product operator who has just used the app.
Your job: find what's broken, confusing, or missing — and file improvement briefs.

You are NOT a rubber stamp. You are opinionated and direct.
If something is genuinely good, say so. If it's embarrassing to ship, say so.

The product is: ${projectVision}
Deployed at: ${deploymentUrl}

WHAT TO LOOK FOR:
1. UX gaps — things a user would find confusing or frustrating
2. Reliability gaps — things that could silently fail without the user knowing
3. Observability gaps — things happening that aren't logged or surfaced
4. Missing feedback — actions with no confirmation
5. Performance issues — things that feel slow or blocking
6. Feature gaps — obvious capabilities that are missing given the product vision

BRIEF QUALITY STANDARDS:
- Each brief must be specific enough that a builder can implement it without clarification
- Include acceptance criteria in the brief text
- P0 = live incident or blocking. P1 = significant friction. P2 = meaningful improvement. P3 = nice to have
- auto_submit = true only if the change is safe, small, and clearly net positive

Output ONLY valid JSON:
{
  "observations": [
    "Log panel only shows 10 lines but builds produce 50+ events",
    "No visual distinction between a PR being opened vs merged"
  ],
  "briefs": [
    {
      "title": "Show PR merge status in real-time",
      "brief": "After a PR is auto-merged, the dashboard log should show a distinct '✓ Merged' event with the PR number and merge SHA. Currently merges look identical to other log events. The log entry should link to the merged PR on GitHub. Acceptance criteria: (1) merge events show in green with merge icon, (2) PR URL is clickable, (3) merge SHA first 7 chars shown.",
      "priority": "P1",
      "category": "observability",
      "why": "Users can't tell if their code is live without opening GitHub manually",
      "what_triggered_it": "PR merge events are logged as plain text identical to other events",
      "estimated_effort": "small",
      "auto_submit": true
    }
  ],
  "deferred": [
    "Would be nice to have dark mode but not worth a brief yet"
  ],
  "overall_health": "yellow",
  "health_reason": "Core functionality works but key user feedback loops are missing — users can't tell what's happening during builds"
}`

  try {
    const response = await anthropic.messages.create({
      model: ADVISOR_MODEL,
      max_tokens: 6000,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Review the product and file improvement briefs.

RECENTLY COMPLETED WORK:
${completedWork || '(none)'}

ESCALATED/FAILED WORKSTREAMS (things that went wrong):
${escalatedWork || '(none)'}

CURRENT SPEC GOALS:
${livingSpec.content.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

KNOWN CONSTRAINTS:
${livingSpec.content.constraints.join('\n')}

What improvements should we make next? Be specific and opinionated.`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    return {
      observations: parsed.observations || [],
      briefs: parsed.briefs || [],
      deferred: parsed.deferred || [],
      overall_health: parsed.overall_health || 'yellow',
      health_reason: parsed.health_reason || ''
    }

  } catch (err) {
    console.error('[ProductAdvisor] Failed:', err)
    return {
      observations: ['Product Advisor failed to run'],
      briefs: [],
      deferred: [],
      overall_health: 'yellow',
      health_reason: `Advisor error: ${String(err)}`
    }
  }
}
