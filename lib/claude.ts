/**
 * FORGE AI — Claude Agent Wrappers v3
 * 
 * All LLM calls go through here. Never call Anthropic SDK directly from routes.
 * 
 * Agents:
 * - runOfficeManager:   Opus — orchestration, decomposition
 * - runBuilderAgent:    Sonnet — code generation
 * - runQAManager:       Sonnet — code review, failure diagnosis
 * - runInterviewAgent:  Sonnet — spec gap questions
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  Workstream, LivingSpec, FailurePattern, OfficeManagerState,
  BriefResponse, BuilderOutput, QAResult, InterviewResult
} from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const OFFICE_MANAGER_MODEL = process.env.OFFICE_MANAGER_MODEL || 'claude-opus-4-6'
const BUILDER_MODEL        = process.env.BUILDER_MODEL        || 'claude-sonnet-4-6'
const QA_MODEL             = process.env.QA_MODEL             || 'claude-sonnet-4-6'

// ─── OFFICE MANAGER ───────────────────────────────────────────────────────────

export async function runOfficeManager(
  brief: string,
  state: OfficeManagerState
): Promise<BriefResponse> {

  const systemPrompt = buildOfficeManagerPrompt(state)

  const response = await anthropic.messages.create({
    model: OFFICE_MANAGER_MODEL,
    max_tokens: 8192,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: 'user', content: brief }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return {
      session_id: '',
      workstreams_created: parsed.workstreams || [],
      decisions_logged: parsed.decisions || [],
      questions_raised: parsed.questions || [],
      spec_updated: !!(parsed.spec_updates?.goals || parsed.spec_updates?.constraints),
      spec_version: undefined,
      office_manager_message: parsed.session_summary || 'Brief processed.',
      estimated_cost_usd: estimateCost(OFFICE_MANAGER_MODEL, 6000, 4000)
    }
  } catch (e) {
    console.error('Office Manager parse error:', text.substring(0, 2000))
    return {
      session_id: '',
      workstreams_created: [],
      decisions_logged: [],
      questions_raised: [],
      spec_updated: false,
      office_manager_message: 'Office Manager encountered a parsing error. Please try again with a clearer brief.',
      estimated_cost_usd: 0
    }
  }
}

function buildOfficeManagerPrompt(state: OfficeManagerState): string {
  const activeWsSummary = state.active_workstreams
    .slice(0, 20)
    .map(w => `  - [${w.status}] Phase ${w.phase} P${w.priority}: ${w.name}`)
    .join('\n') || '  (none yet)'

  const recentDecisions = state.recent_decisions
    .slice(0, 10)
    .map(d => `  - ${d.date}: ${d.decision}`)
    .join('\n') || '  (none yet)'

  const openQs = state.open_questions
    .filter(q => !q.answered)
    .slice(0, 5)
    .map(q => `  - [${q.urgency}] ${q.question}`)
    .join('\n') || '  (none)'

  const patterns = state.failure_patterns
    .slice(0, 5)
    .map(fp => `  - AVOID: ${fp.pattern_type} — ${fp.prevention}`)
    .join('\n') || '  (none yet — system is learning)'

  return `You are the Office Manager for Forge AI — an autonomous multi-agent software factory.

Your responsibilities:
1. Receive founder briefs and decompose into discrete, parallelisable workstreams
2. Maintain the living spec — update when briefs change direction
3. Log all architectural decisions with rationale
4. Surface questions ONLY the founder can answer (not implementation details)
5. Write the exact brief each Builder Agent receives — it must be completely self-contained
6. Assign priorities P0-P3 and phases based on dependencies

Current Project: ${state.project.name}
Vision: ${state.project.vision}

Tech Stack:
${state.living_spec.content.tech_stack.map(t => `  ${t.layer}: ${t.choice}`).join('\n')}

Active Workstreams:
${activeWsSummary}

Recent Decisions:
${recentDecisions}

Open Questions (unanswered):
${openQs}

Known Failure Patterns (inject prevention into builder briefs):
${patterns}

File Conventions:
- Components: components/ (PascalCase.tsx)
- Lib/utils: lib/ (camelCase.ts)
- API routes: app/api/*/route.ts
- Tests: __tests__/*.test.ts

CRITICAL RULES:
- Builder briefs must be completely self-contained — the builder has NO other context
- Every brief must state: tech stack, exact file paths, TypeScript interfaces required, what NOT to build
- Every brief must end with: Output as JSON: {"files": {"path": "content"}}
- Never create a workstream for something already complete
- Never ask questions the system can answer itself
- Log decisions even if obvious — the log is institutional memory

Respond ONLY with valid JSON (no markdown, no preamble):
{
  "workstreams": [
    {
      "name": "string — short unique name",
      "description": "string — 1-2 sentences for display",
      "priority": "P0|P1|P2|P3",
      "phase": 1,
      "blocked_by_names": [],
      "tasks": [{"text": "task description", "done": false}],
      "brief": "COMPLETE SELF-CONTAINED BRIEF — all context included",
      "estimated_files": ["lib/example.ts"]
    }
  ],
  "decisions": [
    {
      "decision": "string",
      "rationale": "string",
      "reversible": true,
      "impact": "low|medium|high"
    }
  ],
  "questions": [
    {
      "question": "string — precise question",
      "context": "string — what unblocks when answered",
      "urgency": "low|medium|high|blocking"
    }
  ],
  "spec_updates": {
    "goals": null,
    "constraints": null,
    "out_of_scope": null
  },
  "session_title": "5 word max title",
  "session_summary": "plain English summary for founder"
}`
}

// ─── BUILDER AGENT ────────────────────────────────────────────────────────────

export async function runBuilderAgent(
  workstream: Workstream,
  livingSpec: LivingSpec,
  failurePatterns: FailurePattern[]
): Promise<BuilderOutput> {

  const patterns = failurePatterns
    .sort((a, b) => b.occurrence_count - a.occurrence_count)
    .slice(0, 5)
    .map(fp => `CRITICAL — AVOID: ${fp.pattern_type}\n  Prevention: ${fp.prevention}`)
    .join('\n\n')

  const systemPrompt = `You are a Builder Agent in the Forge AI autonomous software factory.

You produce production-grade Next.js 14 + TypeScript code.

Project: ${livingSpec.content.vision}
Stack: ${livingSpec.content.tech_stack.map(t => `${t.layer}: ${t.choice}`).join(' | ')}

${patterns ? `\nKNOWN FAILURE PATTERNS — AVOID THESE:\n${patterns}\n` : ''}

ABSOLUTE RULES:
1. Write COMPLETE files — zero placeholders, zero TODOs, zero "// implement later"
2. Every function has explicit TypeScript types — never use 'any'
3. Every async function has try/catch or .catch()
4. Every import is from real packages or relative paths that exist
5. Code runs on first execution — no additional setup required
6. NEVER hardcode secrets, API keys, or env-specific values
7. Use process.env.VARIABLE_NAME for all config

${workstream.context_packet ? `\nCONTEXT:\n${workstream.context_packet}\n` : ''}

Output ONLY valid JSON — no explanation, no markdown:
{
  "files": {
    "exact/path/to/file.ts": "complete file content here"
  },
  "notes": "brief explanation of decisions made",
  "handoff": "what QA needs to verify",
  "open_questions": ["questions that blocked you — be specific"]
}`

  const response = await anthropic.messages.create({
    model: BUILDER_MODEL,
    max_tokens: 8192,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Build workstream: "${workstream.name}"\n\nBrief:\n${workstream.brief}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return {
      code: parsed.files || {},
      notes: parsed.notes || '',
      handoff: parsed.handoff || '',
      open_questions: parsed.open_questions || []
    }
  } catch (e) {
    console.error('Builder Agent parse error for workstream:', workstream.name)
    return { code: {}, notes: 'Build failed — JSON parse error', handoff: '', open_questions: [] }
  }
}

// ─── QA MANAGER ───────────────────────────────────────────────────────────────

export async function runQAManager(
  workstream: Workstream,
  builderOutput: BuilderOutput,
  iterationCount: number
): Promise<QAResult> {

  const MAX_ITERATIONS = parseInt(process.env.MAX_QA_ITERATIONS || '3')

  if (iterationCount >= MAX_ITERATIONS) {
    return {
      passed: false,
      failures: [`Max iterations (${MAX_ITERATIONS}) reached without passing QA`],
      escalate: true,
      escalation_reason: `QA failed after ${iterationCount} iterations. Builder brief may need to be rewritten.`
    }
  }

  if (!builderOutput.code || Object.keys(builderOutput.code).length === 0) {
    return {
      passed: false,
      failures: ['Builder produced no files'],
      revised_brief: `${workstream.brief}\n\nCRITICAL: Your previous response produced no files. You must return a JSON object with a "files" key containing at least one file. Do not explain — just produce the code.`,
      escalate: false
    }
  }

  const fileReview = Object.entries(builderOutput.code)
    .map(([path, content]) => `\n=== ${path} ===\n${content}`)
    .join('\n')

  // Quick pre-checks before sending to LLM (saves tokens)
  const preCheckFailures: string[] = []
  
  for (const [path, content] of Object.entries(builderOutput.code)) {
    if (content.includes(': any') || content.includes(' any,') || content.includes('<any>')) {
      preCheckFailures.push(`${path}: contains 'any' TypeScript type — use proper types`)
    }
    if (content.includes('TODO') || content.includes('FIXME') || content.includes('// implement')) {
      preCheckFailures.push(`${path}: contains placeholder comments — code must be complete`)
    }
    if (content.includes('YOUR_') || content.includes('REPLACE_') || content.includes('PLACEHOLDER')) {
      preCheckFailures.push(`${path}: contains placeholder values — use env vars or real values`)
    }
  }
  
  if (preCheckFailures.length > 0) {
    const revisedBrief = `${workstream.brief}

FAILURES FROM PREVIOUS ATTEMPT — FIX THESE:
${preCheckFailures.map(f => `- ${f}`).join('\n')}

These are hard failures. Do not proceed until fixed.`
    
    return {
      passed: false,
      failed_check: 'Pre-check: TypeScript/placeholder violations',
      failures: preCheckFailures,
      revised_brief: revisedBrief,
      pattern_type: preCheckFailures.some(f => f.includes("'any'")) ? 'TypeScript any type' : 'Placeholder code',
      pattern_prevention: "Always use explicit TypeScript types. Never use 'any'. Never leave TODO comments.",
      escalate: false
    }
  }

  const systemPrompt = `You are the QA Manager in the Forge AI system. You review code produced by Builder Agents.

Workstream brief: ${workstream.brief}
Builder notes: ${builderOutput.notes}
Builder handoff: ${builderOutput.handoff}
Iteration: ${iterationCount + 1} of ${MAX_ITERATIONS}

Review checklist (check in order, fail on first issue):
1. All required files are present
2. No TypeScript 'any' types
3. No TODO/FIXME/placeholder comments  
4. All imports are valid (real npm packages or relative paths)
5. All async functions have error handling
6. All env vars used are standard or in the spec
7. Code logic actually matches what the brief asked for
8. No hardcoded secrets or env-specific values

Files to review:
${fileReview}

Respond ONLY with valid JSON:
{
  "passed": boolean,
  "failed_check": "CHECK N — description" | null,
  "failures": ["specific failure — actionable description"],
  "revised_brief": "complete revised brief if not passed — include all original context plus specific fix instructions" | null,
  "pattern_type": "short category name if this is a recurring type of error" | null,
  "pattern_prevention": "text to inject into future builder briefs to prevent this" | null,
  "escalate": false
}`

  const response = await anthropic.messages.create({
    model: QA_MODEL,
    max_tokens: 2048,
    temperature: 0.1,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Review this builder output.' }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      passed: false,
      failures: ['QA Manager parse error — will retry'],
      revised_brief: workstream.brief,
      escalate: false
    }
  }
}

// ─── INTERVIEW AGENT ──────────────────────────────────────────────────────────

export async function runInterviewAgent(
  currentSpec: LivingSpec,
  sessionHistory: string[],
  existingQuestions: Array<{ question: string; answered: boolean }>
): Promise<InterviewResult> {

  const unansweredQuestions = existingQuestions
    .filter(q => !q.answered)
    .map(q => q.question)

  const systemPrompt = `You are the Interview Agent for Forge AI.

Your job: identify the single most important gap in the project spec and ask the founder one precise question.

Rules:
- Ask ONE question only — the highest value gap
- Do not repeat questions already in the open questions list
- Do not ask implementation questions (the builders handle those)
- Focus on: vision clarity, scope boundaries, user personas, success metrics, non-obvious constraints
- Be specific — vague questions waste founder time

Current spec vision: ${currentSpec.content.vision}
Current goals: ${currentSpec.content.goals.join(', ')}
Out of scope: ${currentSpec.content.out_of_scope.join(', ') || 'not defined yet'}

Already asked (do not repeat):
${unansweredQuestions.map(q => `- ${q}`).join('\n') || '(none yet)'}

Session history:
${sessionHistory.slice(-5).join('\n') || '(first session)'}

Respond ONLY with valid JSON:
{
  "question": "precise, specific question",
  "context": "why this matters and what it unblocks",
  "urgency": "low|medium|high|blocking",
  "spec_section": "vision|goals|constraints|out_of_scope|tech_stack|architecture"
}`

  const response = await anthropic.messages.create({
    model: BUILDER_MODEL,
    max_tokens: 500,
    temperature: 0.4,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'What is the most important question to ask right now?' }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      question: 'What is the single most critical outcome this system must achieve in the next 30 days?',
      context: 'Fallback question — clarifies immediate priority',
      urgency: 'medium',
      spec_section: 'goals'
    }
  }
}

// ─── COST ESTIMATION ─────────────────────────────────────────────────────────

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6':    { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000 },
    'claude-sonnet-4-6':  { input: 0.30 / 1_000_000, output: 1.50 / 1_000_000 },
  }
  const rate = rates[model] || rates['claude-sonnet-4-6']
  return (inputTokens * rate.input) + (outputTokens * rate.output)
}
