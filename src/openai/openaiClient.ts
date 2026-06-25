import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { Logger } from "../logger.js";
import type { ChatMessage, ChatResult, LLMClient, ToolSchema } from "../agent/llm.js";

/**
 * OpenAI-backed LLMClient. The ONLY place (besides voice, later) that imports
 * the OpenAI SDK. Fixed `temperature: 0` for repeatable demos.
 */
export class OpenAILLMClient implements LLMClient {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
    private readonly log: Logger,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    this.log.info("openai chat", { model: this.model, messages: messages.length, tools: tools.length });

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: messages.map(toOpenAiMessage),
      tools: tools.map(toOpenAiTool),
      tool_choice: "auto",
    });

    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
    return { content: message?.content ?? null, toolCalls };
  }
}

export function createOpenAILLMClient(apiKey: string, model: string, log: Logger): OpenAILLMClient {
  return new OpenAILLMClient(new OpenAI({ apiKey }), model, log);
}

function toOpenAiTool(tool: ToolSchema): ChatCompletionTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function toOpenAiMessage(message: ChatMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
  }
}
