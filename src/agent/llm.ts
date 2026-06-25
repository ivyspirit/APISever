/**
 * The model seam. The agent engine (LlmAgentRunner) depends only on this, so
 * OpenAI is swappable for another provider by writing a new LLMClient — the
 * loop logic does not change. Types are SDK-neutral on purpose.
 */

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** A tool invocation the model requested; `arguments` is a raw JSON string. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatResult {
  /** The assistant's text for this step (may be null when it only calls tools). */
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LLMClient {
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult>;
}
