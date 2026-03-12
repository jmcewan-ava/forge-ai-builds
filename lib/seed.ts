/**
 * FORGE AI — Seed Data
 * 
 * Initialises the database with the Forge AI project as its own first project.
 * "The machine that builds itself."
 * 
 * Idempotent: checks if project exists before inserting.
 */

import { getServiceClient } from './supabase'

export async function seedDatabase(): Promise<{ message: string; already_seeded?: boolean }> {
  const db = getServiceClient()

  // Check if already seeded
  const { data: existing } = await db
    .from('projects')
    .select('id')
    .eq('name', 'Forge AI')
    .single()

  if (existing) {
    return { message: 'Database already seeded', already_seeded: true }
  }

  // ── CREATE PROJECT ────────────────────────────────────────────────────────

  const { data: project, error: projectError } = await db
    .from('projects')
    .insert({
      name: 'Forge AI',
      tagline: 'The machine that builds the machine',
      vision: 'An autonomous multi-agent software factory that allows a single founder to brief a software outcome and walk away while AI agents architect, build, test, and iterate on code. Forge AI builds itself.',
      founder: 'Josh',
      status: 'active',
      tech_stack: ['Next.js 14', 'TypeScript', 'Supabase', 'Vercel', 'Claude API'],
      github_default_branch: 'main'
    })
    .select()
    .single()

  if (projectError || !project) {
    throw new Error(`Failed to create project: ${projectError?.message}`)
  }

  // ── CREATE LIVING SPEC ───────────────────────────────────────────────────

  const { error: specError } = await db.from('living_specs').insert({
    project_id: project.id,
    version: 1,
    content: {
      vision: 'An autonomous multi-agent software factory. Single founder briefs → AI builds.',
      goals: [
        'Run for hours without founder input on a typical build session',
        'Produce production-grade TypeScript/Next.js 14 code that passes QA on first or second iteration',
        'Compound: get smarter with every build via Failure Pattern Library',
        'Fully deployed to Vercel with GitHub integration by end of Phase 3'
      ],
      constraints: [
        'Next.js 14 App Router + TypeScript — no exceptions',
        'Supabase for all persistence — no other databases',
        'Direct Claude API (no LangChain or LangGraph in v1)',
        'Max 5 parallel agents in v1',
        'GitHub PAT for file writer (not GitHub App in v1)'
      ],
      tech_stack: [
        { layer: 'Frontend', choice: 'Next.js 14 App Router', rationale: 'Josh\'s preferred stack', decided_at: '2026-03-11', reversible: false },
        { layer: 'Language', choice: 'TypeScript strict mode', rationale: 'Type safety required for agent contracts', decided_at: '2026-03-11', reversible: false },
        { layer: 'Database', choice: 'Supabase (Postgres)', rationale: 'Realtime subscriptions, RLS, managed', decided_at: '2026-03-11', reversible: true },
        { layer: 'AI Orchestration', choice: 'Direct Anthropic SDK', rationale: 'Simpler, no framework lock-in, v1', decided_at: '2026-03-11', reversible: true },
        { layer: 'AI Models', choice: 'Opus (Office Manager) + Sonnet (Builders + QA)', rationale: 'Cost/quality tradeoff', decided_at: '2026-03-11', reversible: true },
        { layer: 'Deployment', choice: 'Vercel', rationale: 'Auto-deploy from GitHub, zero config Next.js', decided_at: '2026-03-11', reversible: true },
        { layer: 'Version Control', choice: 'GitHub (PAT)', rationale: 'File writer uses GitHub REST API', decided_at: '2026-03-11', reversible: true }
      ],
      architecture: [
        { component: 'Office Manager', description: 'Opus-powered orchestrator. Receives briefs, decomposes into workstreams, maintains spec.', dependencies: ['Living Spec', 'Supabase'], status: 'decided', file_paths: ['lib/claude.ts', 'app/api/brief/route.ts'], api_routes: ['POST /api/brief'] },
        { component: 'Builder Agents', description: 'Sonnet-powered code generators. Receive scoped briefs, produce complete TypeScript files.', dependencies: ['Office Manager', 'Context Packet'], status: 'decided', file_paths: ['lib/claude.ts'], api_routes: ['POST /api/agent/run', 'POST /api/agent/run-phase'] },
        { component: 'QA Manager', description: 'Sonnet-powered code reviewer. Tests builder output, creates failure patterns, escalates.', dependencies: ['Builder Agents'], status: 'decided', file_paths: ['lib/claude.ts'] },
        { component: 'Orchestrator', description: 'Dependency graph resolver + parallel executor. No LLM calls.', dependencies: ['Builder Agents', 'QA Manager', 'File Lock', 'Cost Controller'], status: 'decided', file_paths: ['lib/orchestrator.ts'] },
        { component: 'File Writer', description: 'GitHub REST API integration. Commits code to feature branches, creates PRs.', dependencies: ['GitHub API'], status: 'decided', file_paths: ['lib/file-writer.ts'] },
        { component: 'Failure Pattern Library', description: 'Cross-session error accumulator. Injected into builder context packets.', dependencies: ['QA Manager', 'Supabase'], status: 'decided', file_paths: ['lib/context-packet.ts'] },
        { component: 'Dashboard', description: 'Real-time founder interface. Shows workstreams, agents, cost, questions.', dependencies: ['Supabase Realtime'], status: 'decided', file_paths: ['components/Dashboard.tsx', 'app/page.tsx'] }
      ],
      out_of_scope: [
        'Voice input (Phase 6+)',
        'Multi-user / team features (v2)',
        'LangChain or LangGraph (v1 uses direct SDK)',
        'GitHub App authentication (v1 uses PAT)',
        'Custom model fine-tuning',
        'Non-Next.js projects in v1'
      ],
      file_conventions: {
        components_dir: 'components/',
        lib_dir: 'lib/',
        api_dir: 'app/api/',
        naming_pattern: 'PascalCase for React components, camelCase for utilities, kebab-case for routes',
        test_dir: '__tests__/',
        test_pattern: '*.test.ts'
      },
      env_vars: [
        { name: 'ANTHROPIC_API_KEY', required: true, purpose: 'Claude API authentication' },
        { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, purpose: 'Supabase project URL' },
        { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, purpose: 'Supabase anon key (client-safe)' },
        { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, purpose: 'Supabase service role (server only)' },
        { name: 'GITHUB_TOKEN', required: false, purpose: 'GitHub PAT for file writer' },
        { name: 'GITHUB_OWNER', required: false, purpose: 'GitHub username or org' },
        { name: 'GITHUB_REPO', required: false, purpose: 'Target repository name' },
        { name: 'GITHUB_WEBHOOK_SECRET', required: false, purpose: 'Webhook signature verification' },
        { name: 'SEED_KEY', required: true, purpose: 'Protects /api/seed in production' },
        { name: 'MAX_QA_ITERATIONS', required: false, default: '3', purpose: 'Max builder→QA cycles before escalation' },
        { name: 'MAX_PARALLEL_AGENTS', required: false, default: '5', purpose: 'Max simultaneous builder agents' },
        { name: 'SESSION_COST_LIMIT_USD', required: false, default: '10.00', purpose: 'Pause agents at this session cost' },
        { name: 'TOTAL_COST_LIMIT_USD', required: false, default: '100.00', purpose: 'Pause agents at this total project cost' }
      ]
    },
    last_updated_by: 'founder',
    change_summary: 'Initial spec — Founding session',
    updated_at: new Date().toISOString()
  })

  if (specError) throw new Error(`Failed to create spec: ${specError.message}`)

  // ── CREATE AGENTS ─────────────────────────────────────────────────────────

  const agentDefs = [
    { role: 'office_manager', model: 'claude-opus-4-6' },
    { role: 'builder', model: 'claude-sonnet-4-6' },
    { role: 'builder', model: 'claude-sonnet-4-6' },
    { role: 'builder', model: 'claude-sonnet-4-6' },
    { role: 'qa_manager', model: 'claude-sonnet-4-6' },
    { role: 'interview', model: 'claude-sonnet-4-6' },
    { role: 'file_writer', model: 'deterministic' }
  ]

  for (const agent of agentDefs) {
    await db.from('agents').insert({
      project_id: project.id,
      role: agent.role,
      status: 'idle',
      model: agent.model,
      iteration: 0,
      token_usage: { input: 0, output: 0, cost_usd: 0 }
    })
  }

  // ── CREATE FOUNDING SESSION ───────────────────────────────────────────────

  await db.from('sessions').insert({
    project_id: project.id,
    date: new Date().toISOString().split('T')[0],
    title: 'Forge AI — Founding Session',
    summary: 'System seeded. Forge AI is ready to build itself. Submit your first brief to begin.',
    key_outputs: ['Project created', 'Living spec v1 established', 'Agents initialised', '7 agents standing by'],
    decisions_made: [],
    open_questions: [],
    workstreams_created: [],
    workstreams_completed: [],
    token_usage: 0,
    cost_usd: 0
  })

  // ── CREATE FOUNDING DECISIONS ─────────────────────────────────────────────

  const decisions = [
    { decision: 'Use GitHub PAT for file writer (not GitHub App)', rationale: 'Simpler setup for v1 solo use. GitHub App adds auth complexity not needed until multi-user.', reversible: true, impact: 'low' },
    { decision: '60-second auto-run countdown after brief submission', rationale: 'Builds trust before full automation. Founder can cancel. Better than instant or manual.', reversible: true, impact: 'low' },
    { decision: 'API cost limits: $10 per session, $100 total project', rationale: 'Safe defaults for active build phase. Founder can raise via env var.', reversible: true, impact: 'low' },
    { decision: 'Custom orchestration (no LangGraph in v1)', rationale: 'Full control, simpler debugging, already have the pattern. Revisit LangGraph in v2.', reversible: true, impact: 'medium' },
    { decision: 'Single project focus in v1 dashboard', rationale: 'Add project switcher only if Josh confirms need for multiple concurrent projects.', reversible: true, impact: 'low' },
    { decision: 'Office Manager uses Opus, Builders + QA use Sonnet', rationale: 'Opus reasoning needed for decomposition. Sonnet sufficient for code gen at lower cost.', reversible: true, impact: 'medium' }
  ]

  for (const d of decisions) {
    await db.from('decisions').insert({
      project_id: project.id,
      ...d,
      made_by: 'founding_session',
      date: new Date().toISOString().split('T')[0]
    })
  }

  // ── CREATE INITIAL OPEN QUESTIONS ─────────────────────────────────────────

  const questions = [
    { question: 'What GitHub username should GITHUB_OWNER be set to?', context: 'Required to configure the file writer. Without this, built code stays in Supabase only.', urgency: 'high' },
    { question: 'What GitHub repo name should Forge AI write code into?', context: 'GITHUB_REPO env var. Can be the forge-ai repo itself (recursive!) or a target project.', urgency: 'high' },
    { question: 'Should Forge AI first build Bunny DTC or continue building itself?', context: 'The May deadline for Bunny DTC integration layer is 6 weeks away. Building Bunny DTC through Forge AI proves the concept and hits the deadline simultaneously.', urgency: 'medium' },
    { question: 'Do you want Slack or email notification when a phase completes or agent escalates?', context: 'Currently: open questions appear in dashboard only. Notifications would allow truly walking away.', urgency: 'low' }
  ]

  for (const q of questions) {
    await db.from('open_questions').insert({
      project_id: project.id,
      ...q,
      raised_by: 'founding_session',
      raised_at: new Date().toISOString(),
      answered: false
    })
  }

  return { message: 'Database seeded successfully. Forge AI is ready.' }
}
