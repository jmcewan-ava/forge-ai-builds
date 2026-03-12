export interface SpecDecision {
  date: string;
  decision: string;
  rationale: string;
}

export interface SpecSection {
  id: string;
  title: string;
  items: string[];
}

export interface ProjectSpec {
  projectName: string;
  vision: string;
  goals: SpecSection;
  techStack: SpecSection;
  constraints: SpecSection;
  outOfScope: SpecSection;
  architectureDecisions: SpecDecision[];
  fileConventions: SpecSection;
}

export const currentSpec: ProjectSpec = {
  projectName: 'Forge AI',
  vision:
    'An autonomous multi-agent software factory that allows a single founder to brief a software outcome and walk away while AI agents architect, build, test, and iterate on code.',
  goals: {
    id: 'goals',
    title: 'Goals',
    items: [
      'Founder submits a brief and walks away',
      'Office Manager (Opus) decomposes briefs into parallelisable workstreams',
      'Builder Agents (Sonnet) receive self-contained briefs and produce code',
      'QA Agent validates output before commit',
      'Code is written to GitHub via PAT',
      'Forge AI builds itself',
    ],
  },
  techStack: {
    id: 'tech-stack',
    title: 'Tech Stack',
    items: [
      'Frontend: Next.js 14 App Router',
      'Language: TypeScript strict mode',
      'Database: Supabase (Postgres)',
      'AI Orchestration: Direct Anthropic SDK',
      'AI Models: Opus (Office Manager) + Sonnet (Builders + QA)',
      'Deployment: Vercel',
      'Version Control: GitHub (PAT)',
    ],
  },
  constraints: {
    id: 'constraints',
    title: 'Constraints',
    items: [
      'API cost limits: $10 per session, $100 total project',
      '60-second auto-run countdown after brief submission',
      'Single project focus in v1 dashboard',
      'Custom orchestration — no LangGraph in v1',
      'Builder briefs must be completely self-contained',
    ],
  },
  outOfScope: {
    id: 'out-of-scope',
    title: 'Out of Scope (v1)',
    items: [
      'Multi-project support',
      'Team collaboration / multi-user',
      'LangGraph or third-party orchestration frameworks',
      'GitHub App integration (using PAT instead)',
      'Slack/email notifications (pending founder decision)',
    ],
  },
  architectureDecisions: [
    {
      date: '2026-03-12',
      decision: 'Use GitHub PAT for file writer (not GitHub App)',
      rationale: 'Simpler setup for v1, avoids OAuth complexity',
    },
    {
      date: '2026-03-12',
      decision: '60-second auto-run countdown after brief submission',
      rationale: 'Gives founder a window to cancel while maintaining autonomous feel',
    },
    {
      date: '2026-03-12',
      decision: 'API cost limits: $10 per session, $100 total project',
      rationale: 'Prevents runaway costs during autonomous operation',
    },
    {
      date: '2026-03-12',
      decision: 'Custom orchestration (no LangGraph in v1)',
      rationale: 'Full control over agent flow, fewer dependencies',
    },
    {
      date: '2026-03-12',
      decision: 'Single project focus in v1 dashboard',
      rationale: 'Reduces complexity, Forge AI is the only project initially',
    },
    {
      date: '2026-03-12',
      decision: 'Office Manager uses Opus, Builders + QA use Sonnet',
      rationale: 'Opus for complex decomposition, Sonnet for cost-effective code generation',
    },
  ],
  fileConventions: {
    id: 'file-conventions',
    title: 'File Conventions',
    items: [
      'Components: components/ (PascalCase.tsx)',
      'Lib/utils: lib/ (camelCase.ts)',
      'API routes: app/api/*/route.ts',
      'Tests: __tests__/*.test.ts',
    ],
  },
};
