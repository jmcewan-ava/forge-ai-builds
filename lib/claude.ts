/**
 * FORGE AI — Claude Agent Wrappers v4
 *
 * All LLM calls go through here. Never call Anthropic SDK directly from routes.
 *
 * Agents:
 * - runOfficeManager:   Opus — orchestration, decomposition (max_tokens: 16000)
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

// ─── RETRY WRAPPER ────────────────────────────────────────────────────────────
// Anthropic API can be slow or overloaded — retry up to 3x with backoff.
// Never retries on auth errors (401) or invalid request (400).

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const status = err?.status || err?.statusCode
      // Don't retry client errors
      if (status && status < 500 && status !== 429) throw err
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
        console.warn(`[claude] ${label} attempt ${attempt} failed (${status || 'network'}), retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

const OFFICE_MANAGER_MODEL = process.env.OFFICE_MANAGER_MODEL || 'claude-opus-4-6'
const BUILDER_MODEL        = process.env.BUILDER_MODEL        || 'claude-sonnet-4-6'
const QA_MODEL             = process.env.QA_MODEL             || 'claude-sonnet-4-6'

// ─── OFFICE MANAGER ───────────────────────────────────────────────────────────

export async function runOfficeManager(
  brief: string,
  state: OfficeManagerState
): Promise<BriefResponse> {

  const systemPrompt = buildOfficeManagerPrompt(state)

  const response = await withRetry(() => anthropic.messages.create({
    model: OFFICE_MANAGER_MODEL,
    max_tokens: 16000,
    temperature: 0.15,  // Lower = more deliberate, less creative decomposition
    system: systemPrompt,
    messages: [{ role: 'user', content: brief }]
  }), 'OfficeManager')

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return {
      session_id: '',
      workstreams_created: parsed.workstreams || [],
      decisions_logged: parsed.decisions || [],
      questions_raised: parsed.questions || [],
      spec_updated: !!(parsed.spec_updates?.goals || parsed.spec_updates?.constraints || parsed.spec_updates?.out_of_scope),
      spec_version: undefined,
      office_manager_message: parsed.session_summary || 'Brief processed.',
      estimated_cost_usd: estimateCost(OFFICE_MANAGER_MODEL, response.usage.input_tokens, response.usage.output_tokens),
      // Pass spec_updates through so the route can persist them
      ...(parsed.spec_updates ? { spec_updates: parsed.spec_updates } : {}),
    } as BriefResponse & { spec_updates?: any }
  } catch (e) {
    console.error('Office Manager parse error. Raw output (first 3000 chars):', text.substring(0, 3000))
    return {
      session_id: '',
      workstreams_created: [],
      decisions_logged: [],
      questions_raised: [],
      spec_updated: false,
      office_manager_message: 'Office Manager encountered a JSON parsing error. Try a shorter or more structured brief.',
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
- Before creating any workstream ask: does this already exist? Is this genuinely the highest value action? Could this be combined with another workstream? Each workstream costs real money — be selective
- Prefer fewer, deeper workstreams over many shallow ones
- Each workstream should represent at least 2-4 hours of real engineering work

Respond ONLY with valid JSON (no markdown, no preamble):
{
  "assessment": {
    "current_state": "what exists now and what is working",
    "gaps_identified": ["gap 1", "gap 2"],
    "risks": ["risk if we proceed wrong"],
    "recommended_approach": "why this decomposition makes sense"
  },
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

  const systemPrompt = `You are a Surgeon Agent in the Forge AI autonomous software factory.

You make SURGICAL, PRECISE edits to existing code. You do NOT rewrite entire files.

Project: ${livingSpec.content.vision}
Stack: ${livingSpec.content.tech_stack.map(t => `${t.layer}: ${t.choice}`).join(' | ')}

${patterns ? `\nKNOWN FAILURE PATTERNS — AVOID THESE:\n${patterns}\n` : ''}

${workstream.context_packet ? `\nCONTEXT (includes existing file contents — READ THESE CAREFULLY):\n${workstream.context_packet}\n` : ''}

YOUR PROCESS — follow this exactly:

STEP 1 — DISCOVERY: Read every existing file provided in context. Note:
- Every exported function name and its EXACT signature (parameters and types)
- Every import in every file
- What each file's responsibility is

STEP 2 — PLAN: Write out in your notes exactly what you will change and why.
For each file: list which functions/lines you will touch and what the change is.

STEP 3 — SURGICAL EDIT: For existing files, output ONLY the changed sections as find/replace pairs.
For new files, output the complete file content.

ABSOLUTE RULES:
1. NEVER change a function signature without checking every file that calls it
2. NEVER rename an exported function — update all callers in the same edit
3. Every import must reference a function that actually exists with that exact name
4. Function call arguments must match the function signature exactly
5. For existing files: prefer targeted edits over full rewrites
6. Every async function has try/catch
7. Never use 'any' — use explicit TypeScript types
8. NEVER hardcode secrets — use process.env.VARIABLE_NAME

Output ONLY valid JSON — no explanation, no markdown:
{
  "files": {
    "path/to/new-file.ts": "complete content — only for NEW files"
  },
  "edits": [
    {
      "file": "path/to/existing-file.ts",
      "find": "exact existing code block to replace (must be unique in the file)",
      "replace": "new code to replace it with"
    }
  ],
  "notes": "STEP 1 discovery findings + STEP 2 plan + decisions made",
  "handoff": "what QA needs to verify",
  "open_questions": ["questions that blocked you — be specific"]
}`

  const response = await withRetry(() => anthropic.messages.create({
    model: BUILDER_MODEL,
    max_tokens: 16000,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Build workstream: "${workstream.name}"\n\nBrief:\n${workstream.brief}`
    }]
  }), `Builder:${workstream.name}`)

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Attempt to extract valid JSON even from truncated or markdown-wrapped responses
  function extractJSON(raw: string): string {
    // Strip markdown fences
    let s = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    // Find first { and last } — handles trailing text after JSON
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      s = s.slice(start, end + 1)
    }
    return s
  }

  try {
    const clean = extractJSON(text)
    const parsed = JSON.parse(clean)

    // Brief 4: Log agent conversation for debugging
    await logAgentCall({
      workstream_id: workstream.id,
      project_id: (workstream as any).project_id || '',
      agent_role: 'builder',
      model: BUILDER_MODEL,
      system_prompt: systemPrompt,
      user_message: `Build workstream: "${workstream.name}"\n\nBrief:\n${workstream.brief}`,
      response_text: text,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      iteration: 0,
    })

    // Merge new files + apply surgical edits into a single code map
    const code: Record<string, string> = { ...(parsed.files || {}) }

    // Apply edits: fetch existing file content and apply find/replace
    if (Array.isArray(parsed.edits)) {
      for (const edit of parsed.edits) {
        if (!edit.file || edit.find === undefined || edit.replace === undefined) continue
        // Get current content from existing files (injected via repo-reader)
        const existingContent = (workstream as any).existing_files?.[edit.file] || code[edit.file] || ''
        if (existingContent && existingContent.includes(edit.find)) {
          code[edit.file] = existingContent.replace(edit.find, edit.replace)
        } else if (existingContent) {
          // find block not found — log and skip rather than corrupting the file
          console.warn(`Builder edit: could not find block in ${edit.file} — skipping edit`)
          console.warn(`Looking for: ${edit.find.slice(0, 100)}`)
        } else {
          // No existing content — treat as new file with just the replacement
          code[edit.file] = edit.replace
        }
      }
    }

    return {
      code,
      notes: parsed.notes || '',
      handoff: parsed.handoff || '',
      open_questions: parsed.open_questions || [],
      usage: response.usage,
    } as BuilderOutput & { usage: any }
  } catch (e) {
    // Log first 1000 chars of raw response to help diagnose truncation/format issues
    console.error('Builder Agent parse error for workstream:', workstream.name)
    console.error('Raw response (first 1000 chars):', text.slice(0, 1000))
    console.error('Raw response (last 500 chars):', text.slice(-500))
    return { 
      code: {}, 
      notes: `Build failed — JSON parse error. Response length: ${text.length} chars. Check logs for raw output.`, 
      handoff: '', 
      open_questions: [`Builder returned unparseable response (${text.length} chars) — may need to split this workstream into smaller pieces`] 
    }
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
    return {
      passed: false,
      failed_check: 'Pre-check: TypeScript/placeholder violations',
      failures: preCheckFailures,
      revised_brief: `${workstream.brief}\n\nFAILURES FROM PREVIOUS ATTEMPT — FIX THESE:\n${preCheckFailures.map(f => `- ${f}`).join('\n')}\n\nThese are hard failures. Do not proceed until fixed.`,
      pattern_type: preCheckFailures.some(f => f.includes("'any'")) ? 'TypeScript any type' : 'Placeholder code',
      pattern_prevention: "Always use explicit TypeScript types. Never use 'any'. Never leave TODO comments.",
      escalate: false
    }
  }

  const fileReview = Object.entries(builderOutput.code)
    .map(([path, content]) => `\n=== ${path} ===\n${content}`)
    .join('\n')

  const response = await withRetry(() => anthropic.messages.create({
    model: QA_MODEL,
    max_tokens: 2048,
    temperature: 0.1,
    system: `You are the QA Manager in the Forge AI system. You review code produced by Builder Agents.

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
  "revised_brief": "complete revised brief if not passed" | null,
  "pattern_type": "short category name if recurring error" | null,
  "pattern_prevention": "text to inject into future builder briefs" | null,
  "escalate": false
}`,
    messages: [{ role: 'user', content: 'Review this builder output.' }]
  }), `QA:${workstream.name}`)

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return { ...JSON.parse(clean), usage: response.usage }
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

  const response = await anthropic.messages.create({
    model: BUILDER_MODEL,
    max_tokens: 500,
    temperature: 0.4,
    system: `You are the Interview Agent for Forge AI.

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
}`,
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

// ─── AGENT LOG ────────────────────────────────────────────────────────────────

interface AgentLogEntry {
  workstream_id: string
  project_id: string
  agent_role: string
  model: string
  system_prompt: string
  user_message: string
  response_text: string
  input_tokens: number
  output_tokens: number
  iteration: number
}

async function logAgentCall(entry: AgentLogEntry): Promise<void> {
  try {
    const { getServiceClient } = await import('./supabase')
    const db = getServiceClient()
    await db.from('agent_logs').insert({
      ...entry,
      cost_usd: estimateCost(entry.model, entry.input_tokens, entry.output_tokens),
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    // Non-fatal — logging failure should never break a build
    console.warn('[claude] Failed to log agent call:', err)
  }
}

// ─── COST ESTIMATION ─────────────────────────────────────────────────────────

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6':   { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000 },
    'claude-sonnet-4-6': { input: 0.30 / 1_000_000, output: 1.50 / 1_000_000 },
  }
  const rate = rates[model] || rates['claude-sonnet-4-6']
  return (inputTokens * rate.input) + (outputTokens * rate.output)
}
