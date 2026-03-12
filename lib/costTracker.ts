import { v4 as uuidv4 } from 'uuid';

export interface ApiCallCost {
  id: string;
  timestamp: string;
  model: 'opus' | 'sonnet';
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  agent_role: 'office_manager' | 'builder' | 'qa';
  workstream_name: string | null;
}

export interface CostSummary {
  session_cost_usd: number;
  total_project_cost_usd: number;
  session_limit_usd: number;
  total_limit_usd: number;
  session_remaining_usd: number;
  total_remaining_usd: number;
  call_count: number;
  is_session_warning: boolean;
  is_total_warning: boolean;
  is_session_exceeded: boolean;
  is_total_exceeded: boolean;
}

const SESSION_LIMIT_USD = 10.0;
const TOTAL_LIMIT_USD = 100.0;
const WARNING_THRESHOLD = 0.8;

// Pricing per 1M tokens (Anthropic 2025)
const PRICING = {
  opus: {
    input_per_million: 15.0,
    output_per_million: 75.0,
  },
  sonnet: {
    input_per_million: 3.0,
    output_per_million: 15.0,
  },
} as const;

// Module-level in-memory storage
let allCalls: ApiCallCost[] = [];
let currentSessionId: string = uuidv4();
let sessionCalls: ApiCallCost[] = [];

export function calculateCallCost(
  model: 'opus' | 'sonnet',
  input_tokens: number,
  output_tokens: number
): number {
  const pricing = PRICING[model];
  const inputCost = (input_tokens / 1_000_000) * pricing.input_per_million;
  const outputCost = (output_tokens / 1_000_000) * pricing.output_per_million;
  return inputCost + outputCost;
}

export function recordApiCall(
  call: Omit<ApiCallCost, 'id' | 'cost_usd'>
): ApiCallCost {
  const cost_usd = calculateCallCost(
    call.model,
    call.input_tokens,
    call.output_tokens
  );

  const fullCall: ApiCallCost = {
    ...call,
    id: uuidv4(),
    cost_usd,
  };

  allCalls.push(fullCall);
  sessionCalls.push(fullCall);

  return fullCall;
}

export function getSessionCosts(session_id: string): ApiCallCost[] {
  // For v1 in-memory: if session_id matches current session, return sessionCalls
  if (session_id === currentSessionId) {
    return [...sessionCalls];
  }
  return [];
}

export function getCostSummary(): CostSummary {
  const session_cost_usd = sessionCalls.reduce(
    (sum, call) => sum + call.cost_usd,
    0
  );
  const total_project_cost_usd = allCalls.reduce(
    (sum, call) => sum + call.cost_usd,
    0
  );

  const session_remaining_usd = Math.max(
    0,
    SESSION_LIMIT_USD - session_cost_usd
  );
  const total_remaining_usd = Math.max(
    0,
    TOTAL_LIMIT_USD - total_project_cost_usd
  );

  const session_pct = session_cost_usd / SESSION_LIMIT_USD;
  const total_pct = total_project_cost_usd / TOTAL_LIMIT_USD;

  return {
    session_cost_usd,
    total_project_cost_usd,
    session_limit_usd: SESSION_LIMIT_USD,
    total_limit_usd: TOTAL_LIMIT_USD,
    session_remaining_usd,
    total_remaining_usd,
    call_count: sessionCalls.length,
    is_session_warning: session_pct >= WARNING_THRESHOLD && session_pct < 1.0,
    is_total_warning: total_pct >= WARNING_THRESHOLD && total_pct < 1.0,
    is_session_exceeded: session_cost_usd >= SESSION_LIMIT_USD,
    is_total_exceeded: total_project_cost_usd >= TOTAL_LIMIT_USD,
  };
}

export function resetSession(): void {
  currentSessionId = uuidv4();
  sessionCalls = [];
}

export function getCurrentSessionId(): string {
  return currentSessionId;
}
