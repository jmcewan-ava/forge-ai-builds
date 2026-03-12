import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall, getCostSummary } from '@/lib/costTracker';

export interface WrappedCallOptions {
  model: 'opus' | 'sonnet';
  agent_role: 'office_manager' | 'builder' | 'qa';
  workstream_name: string | null;
  messages: Anthropic.MessageParam[];
  system?: string;
  max_tokens: number;
}

const MODEL_IDS: Record<'opus' | 'sonnet', string> = {
  opus: 'claude-opus-4-5',
  sonnet: 'claude-sonnet-4-5',
};

export async function trackedAnthropicCall(
  client: Anthropic,
  options: WrappedCallOptions
): Promise<Anthropic.Message> {
  const { model, agent_role, workstream_name, messages, system, max_tokens } =
    options;

  // Pre-call limit check
  const preCallSummary = getCostSummary();
  if (preCallSummary.is_session_exceeded) {
    throw new Error(
      `Session cost limit exceeded: $${preCallSummary.session_cost_usd.toFixed(
        4
      )} >= $${preCallSummary.session_limit_usd.toFixed(
        2
      )}. Reset the session to continue.`
    );
  }
  if (preCallSummary.is_total_exceeded) {
    throw new Error(
      `Total project cost limit exceeded: $${preCallSummary.total_project_cost_usd.toFixed(
        4
      )} >= $${preCallSummary.total_limit_usd.toFixed(
        2
      )}. Project budget exhausted.`
    );
  }

  const modelId = MODEL_IDS[model];

  const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelId,
    max_tokens,
    messages,
    ...(system !== undefined ? { system } : {}),
  };

  let response: Anthropic.Message;
  try {
    response = await client.messages.create(requestParams);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error during Anthropic API call';
    throw new Error(`Anthropic API call failed [${model}/${agent_role}]: ${message}`);
  }

  const { input_tokens, output_tokens } = response.usage;

  recordApiCall({
    timestamp: new Date().toISOString(),
    model,
    input_tokens,
    output_tokens,
    agent_role,
    workstream_name,
  });

  // Post-call warning log (non-throwing)
  const postCallSummary = getCostSummary();
  if (postCallSummary.is_session_exceeded) {
    console.warn(
      `[CostTracker] Session limit exceeded after call. Session total: $${postCallSummary.session_cost_usd.toFixed(4)}`
    );
  } else if (postCallSummary.is_session_warning) {
    console.warn(
      `[CostTracker] Session cost warning: $${postCallSummary.session_cost_usd.toFixed(
        4
      )} of $${postCallSummary.session_limit_usd.toFixed(2)} used (>= 80%)`
    );
  }
  if (postCallSummary.is_total_exceeded) {
    console.warn(
      `[CostTracker] Total project limit exceeded. Project total: $${postCallSummary.total_project_cost_usd.toFixed(4)}`
    );
  } else if (postCallSummary.is_total_warning) {
    console.warn(
      `[CostTracker] Project cost warning: $${postCallSummary.total_project_cost_usd.toFixed(
        4
      )} of $${postCallSummary.total_limit_usd.toFixed(2)} used (>= 80%)`
    );
  }

  return response;
}
