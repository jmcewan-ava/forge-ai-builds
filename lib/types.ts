// ─── FORGE AI — Complete Type Definitions v3 ─────────────────────────────────
// Single source of truth for all agents, routes, and UI components.
// Session 3 update: added all fields from engineering spec v1.0

export type WorkstreamStatus =
  | 'queued' | 'in_progress' | 'qa_review' | 'complete'
  | 'blocked' | 'failed' | 'escalated' | 'paused'

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'
export type AgentRole =
  | 'office_manager'
  | 'builder'
  | 'qa_manager'
  | 'interview'
  | 'file_writer'
  // Dream Team agents
  | 'discovery'
  | 'architect'
  | 'surgeon'
  | 'type_checker'
  | 'behaviour_qa'
  | 'product_advisor'
  | 'product_manager'
  | 'consultant'
  | 'orchestrator' 
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'
export type QAStatus = 'pending' | 'pass' | 'fail' | 'escalated'
export type Urgency = 'low' | 'medium' | 'high' | 'blocking'
export type Impact = 'low' | 'medium' | 'high'
export type Severity = 'low' | 'medium' | 'high'

export interface Project {
  id: string; name: string; tagline: string; vision: string; founder: string
  status: 'active' | 'paused' | 'complete'
  created_at: string; updated_at: string; tech_stack: string[]
  repository_url?: string; deployment_url?: string; github_default_branch?: string
  auto_merge_prs?: boolean
}

export interface LivingSpec {
  id: string; project_id: string; version: number; content: LivingSpecContent
  last_updated_by: string; change_summary?: string; updated_at: string
}

export interface LivingSpecContent {
  vision: string; goals: string[]; constraints: string[]
  tech_stack: TechDecision[]; architecture: ArchNode[]; out_of_scope: string[]
  file_conventions?: FileConvention; env_vars?: EnvVar[]
}

export interface TechDecision {
  layer: string; choice: string; rationale: string
  alternatives?: string[]; decided_at: string; reversible: boolean
}

export interface ArchNode {
  component: string; description: string; dependencies: string[]
  status: 'decided' | 'open' | 'revisit'
  file_paths?: string[]; api_routes?: string[]
}

export interface FileConvention {
  components_dir: string; lib_dir: string; api_dir: string; naming_pattern: string
  test_dir?: string; test_pattern?: string
}

export interface EnvVar { name: string; required: boolean; default?: string; purpose: string }

export interface Workstream {
  id: string; project_id: string; name: string; description: string
  status: WorkstreamStatus; priority: Priority; phase: number; completion_pct: number
  blocked_by: string[]; assigned_agent?: string; qa_status?: QAStatus; qa_iterations: number
  tasks: Task[]; brief: string; context_packet?: string; output_files: string[]
  output_code?: Record<string, string>; github_pr_url?: string; estimated_files?: string[]
  created_at: string; updated_at: string; started_at?: string; completed_at?: string
  github_merge_sha?: string; github_merged_at?: string
}


export interface Task {
  id: string; workstream_id: string; text: string; done: boolean; done_at?: string
}

export interface Agent {
  id: string; project_id: string; role: AgentRole; status: AgentStatus
  current_workstream?: string; model: string; iteration: number
  started_at?: string; completed_at?: string
  token_usage: { input: number; output: number; cost_usd: number }
  error_message?: string
}

export interface Decision {
  id: string; project_id: string; decision: string; rationale: string
  alternatives_considered?: string[]; made_by: string; date: string
  workstream_id?: string; reversible: boolean; impact: Impact
}

export interface Session {
  id: string; project_id: string; date: string; title: string; summary: string
  brief_submitted?: string; key_outputs: string[]; decisions_made: string[]
  open_questions: string[]; workstreams_created: string[]; workstreams_completed: string[]
  token_usage: number; cost_usd: number
}

export interface OpenQuestion {
  id: string; project_id: string; question: string; context: string
  raised_by: string; raised_at: string; answered: boolean; answer?: string
  answered_at?: string; workstream_id?: string; urgency: Urgency
}

export interface FailurePattern {
  id: string; project_id: string; pattern_type: string; description: string
  trigger_context: string; first_seen: string; last_seen: string
  occurrence_count: number; resolution: string; prevention: string
  workstream_ids: string[]; severity: Severity
}

export interface ExecutionPlan {
  levels: ExecutionLevel[]; total_ws: number; estimated_time: string
}

export interface ExecutionLevel {
  level: number; workstreams: Workstream[]; blocked_until: string[]
}

export interface OfficeManagerState {
  project: Project; living_spec: LivingSpec; active_workstreams: Workstream[]
  recent_decisions: Decision[]; open_questions: OpenQuestion[]
  failure_patterns: FailurePattern[]; session_history: string[]
}

export interface BriefRequest { brief: string; project_id: string }

export interface BriefResponse {
  session_id: string; workstreams_created: Workstream[]; decisions_logged: Decision[]
  questions_raised: OpenQuestion[]; spec_updated: boolean; spec_version?: number
  office_manager_message: string; estimated_cost_usd: number
}

export interface AgentRunRequest { workstream_id: string; project_id: string; force?: boolean }

export interface AgentRunResponse {
  workstream_id: string; status: string; iterations: number; passed: boolean
  escalated: boolean; failures: string[]; files_produced: string[]
  github_pr_url?: string; cost_usd: number; duration_ms: number
}

export interface DashboardStats {
  overall_pct: number; active_workstreams: number; queued_workstreams: number
  completed_workstreams: number; total_cost_usd: number; total_tokens: number; spec_version: number
}

export interface DashboardData {
  project: Project; living_spec: LivingSpec; workstreams: Workstream[]
  decisions: Decision[]; sessions: Session[]; open_questions: OpenQuestion[]
  failure_patterns: FailurePattern[]; agents: Agent[]; stats: DashboardStats
}

export interface BuilderOutput {
  code: Record<string, string>; notes: string; handoff: string; open_questions?: string[]
}

export interface QAResult {
  passed: boolean; failed_check?: string; failures: string[]
  revised_brief?: string; pattern_type?: string; pattern_prevention?: string
  escalate: boolean; escalation_reason?: string
}

export interface GitHubConfig {
  owner: string; repo: string; token: string; defaultBranch: string
}

export interface CommitResult { pr_url?: string; pr_number?: number; files_committed: string[]; branch: string }

export interface CostRecord {
  session_delta_usd: number; session_total_usd: number
  project_total_usd: number; limit_hit: boolean; limit_reason?: string
}

export interface CostLimitCheck {
  within_limits: boolean; reason?: string
  session_total_usd: number; project_total_usd: number
}

export interface GitHubWebhookPayload {
  action: string
  pull_request?: {
    number: number; title: string; state: string; merged: boolean
    merged_at?: string; html_url: string
    head: { ref: string; sha: string }; base: { ref: string }
  }
  repository: { name: string; full_name: string; owner: { login: string } }
}

// ─── INTERVIEW AGENT ─────────────────────────────────────────────────────────

export interface InterviewResult {
  question: string
  context: string
  urgency: Urgency
  spec_section: string  // which part of the spec this helps fill
}
