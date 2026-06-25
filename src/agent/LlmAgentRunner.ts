import { events } from "../protocol.js";
import type { Logger } from "../logger.js";
import type { Workspace } from "../workspace/Workspace.js";
import type { AgentRunner, TurnInput, TurnRequest } from "./AgentRunner.js";
import type { ChatMessage, LLMClient } from "./llm.js";
import { Changeset, type StagedChange } from "./Changeset.js";
import type { RiskClassifier } from "./RiskClassifier.js";
import type { EditRecord, UndoStore } from "./EditRecord.js";
import type { ToolContext, ToolDefinition } from "./tools.js";

export interface LlmAgentRunnerDeps {
  llm: LLMClient;
  tools: ToolDefinition[];
  risk: RiskClassifier;
  undo: UndoStore;
  log: Logger;
  /** Safety cap on tool-loop iterations. */
  maxSteps?: number;
}

/**
 * The model-agnostic agent engine. Runs a tool-call loop against a Workspace,
 * STAGES mutations (never writes mid-loop), then gates the whole changeset
 * through the RiskClassifier: LOW auto-applies, HIGH/TOO_BIG pauses with a
 * confirmation, a tool-issued choice pauses with a question. Emits the shared
 * AgentEvent stream throughout. OpenAI lives only inside the injected LLMClient.
 */
export class LlmAgentRunner implements AgentRunner {
  private readonly maxSteps: number;
  private readonly toolsByName: Map<string, ToolDefinition>;

  constructor(private readonly deps: LlmAgentRunnerDeps) {
    this.maxSteps = deps.maxSteps ?? 8;
    this.toolsByName = new Map(deps.tools.map((t) => [t.schema.name, t]));
  }

  async run(input: TurnInput): Promise<void> {
    const { request, workspace, emit, signal } = input;
    emit(events.intentProposed(request.instruction));

    const changeset = new Changeset();
    const ctx: ToolContext = { workspace, changeset, emit };
    const toolSchemas = this.deps.tools.map((t) => t.schema);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(request) },
      ...mapHistory(request.history ?? []),
      { role: "user", content: request.instruction },
    ];

    emit(events.thinking("Reading workspace"));

    let finalText = "";
    for (let step = 0; step < this.maxSteps; step += 1) {
      if (signal.aborted) return;

      const result = await this.deps.llm.chat(messages, toolSchemas);
      if (signal.aborted) return;

      if (result.toolCalls.length === 0) {
        finalText = result.content?.trim() ?? "";
        break;
      }

      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const tool = this.toolsByName.get(call.name);
        if (!tool) {
          messages.push({ role: "tool", toolCallId: call.id, content: `Error: unknown tool ${call.name}` });
          continue;
        }
        const args = safeParseArgs(call.arguments);
        const toolResult = await tool.execute(args, ctx);
        messages.push({ role: "tool", toolCallId: call.id, content: toolResult.output });

        // A choice short-circuits the turn: the user's answer is a new /turn.
        if (toolResult.decision) {
          this.deps.log.info("decision: choice");
          emit(events.decision(toolResult.decision));
          emit(events.done());
          return;
        }
      }
    }

    if (signal.aborted) return;
    await this.finalize(request, changeset, finalText, ctx);
  }

  /** Gate the staged changeset and either apply, confirm, or just speak. */
  private async finalize(
    request: TurnRequest,
    changeset: Changeset,
    finalText: string,
    ctx: ToolContext,
  ): Promise<void> {
    const { emit, workspace } = ctx;
    const changes = changeset.list();

    if (changes.length === 0) {
      // No edits: an "ask about code" turn. Speak the model's answer.
      emit(events.applied(finalText || "Done."));
      emit(events.done());
      return;
    }

    emit(events.thinking("Reviewing changes"));
    const assessment = this.deps.risk.classify(changes);
    this.deps.log.info("risk", {
      risk: assessment.risk,
      files: assessment.files,
      added: assessment.added,
      removed: assessment.removed,
    });

    if (assessment.risk === "LOW") {
      await this.apply(request.workspaceId, changes, changeset, workspace, emit);
      emit(events.applied(finalText || summarize(changes, assessment)));
      emit(events.done());
      return;
    }

    // HIGH / TOO_BIG: nothing written; ask for a spoken confirmation.
    emit(
      events.decision({
        kind: "confirmation",
        summary: finalText || summarize(changes, assessment),
        risk: assessment.risk,
        files: assessment.files,
        added: assessment.added,
        removed: assessment.removed,
        recommendedAction: assessment.recommendedAction,
        actions: ["approve", "reject", "defer"],
      }),
    );
    emit(events.done());
  }

  /** Apply each staged change atomically per file, recording inverses for undo. */
  private async apply(
    workspaceId: string,
    changes: StagedChange[],
    changeset: Changeset,
    workspace: Workspace,
    emit: TurnInput["emit"],
  ): Promise<void> {
    const records: EditRecord[] = [];
    for (const change of changes) {
      const { diff, added, removed } = changeset.stats(change);
      records.push({ path: change.path, before: change.before, after: change.after });
      if (change.op === "delete") {
        await workspace.deleteFile(change.path);
      } else {
        await workspace.writeFile(change.path, change.after ?? "");
      }
      this.deps.log.info("applied edit", { path: change.path, op: change.op, added, removed });
      emit(events.fileEdit(change.path, diff, added, removed));
    }
    this.deps.undo.record(workspaceId, records);
  }
}

// --- helpers ----------------------------------------------------------------

function systemPrompt(request: TurnRequest): string {
  const mode = request.mode ?? "voice";
  return [
    `You are a coding agent operating in ${mode}-control mode.`,
    "The developer is away from their desk and listening hands-free; they cannot",
    "read diffs or type. Act autonomously and keep changes small and reversible.",
    "",
    "Tools: read_file, list_dir to explore; write_file (FULL new file contents,",
    "not a patch) and delete_file to propose edits; request_choice to ask the user.",
    "",
    "Rules:",
    "- Inspect the relevant files before editing.",
    "- Make the smallest change that satisfies the instruction.",
    "- In voice mode, if you must ask the user something, use request_choice with",
    "  2-4 short bounded options. NEVER ask an open-ended question.",
    "- When finished, reply with ONE short sentence summarizing what you did,",
    "  suitable for text-to-speech: plain prose, no code, no markdown, no file dumps.",
  ].join("\n");
}

function mapHistory(history: { role: "user" | "agent"; text: string }[]): ChatMessage[] {
  return history.map((turn) =>
    turn.role === "user"
      ? { role: "user", content: turn.text }
      : { role: "assistant", content: turn.text },
  );
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function summarize(changes: StagedChange[], assessment: { added: number; removed: number }): string {
  const files = changes.map((c) => c.path).join(", ");
  return `Updated ${changes.length} file(s) (${files}): +${assessment.added} -${assessment.removed}.`;
}
