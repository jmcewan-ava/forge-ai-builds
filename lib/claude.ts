import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  content: string;
  model: string;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Office Manager agent — uses Opus to decompose founder briefs into workstreams.
 * max_tokens set to 16000 to prevent truncation of large JSON responses.
 */
export async function callOfficeManager(
  systemPrompt: string,
  messages: ClaudeMessage[]
): Promise<ClaudeResponse> {
  try {
    const response = await client.messages.create({
      model: process.env.OPUS_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: systemPrompt,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return {
      content,
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error calling Office Manager';
    throw new Error(`Office Manager API call failed: ${message}`);
  }
}

/**
 * Builder agent — uses Sonnet to generate scoped code from decomposed briefs.
 * max_tokens kept at 4096 (sufficient for individual file generation).
 */
export async function callBuilder(
  systemPrompt: string,
  messages: ClaudeMessage[]
): Promise<ClaudeResponse> {
  try {
    const response = await client.messages.create({
      model: process.env.SONNET_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return {
      content,
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error calling Builder';
    throw new Error(`Builder API call failed: ${message}`);
  }
}

/**
 * QA agent — uses Sonnet to review generated code for correctness.
 * max_tokens kept at 4096.
 */
export async function callQA(
  systemPrompt: string,
  messages: ClaudeMessage[]
): Promise<ClaudeResponse> {
  try {
    const response = await client.messages.create({
      model: process.env.SONNET_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return {
      content,
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error calling QA';
    throw new Error(`QA API call failed: ${message}`);
  }
}

export { client };
