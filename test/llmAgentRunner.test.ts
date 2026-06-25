import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LlmAgentRunner } from "../src/agent/LlmAgentRunner.js";
import { DefaultRiskClassifier } from "../src/agent/RiskClassifier.js";
import { MemoryUndoStore } from "../src/agent/EditRecord.js";
import { defaultTools } from "../src/agent/tools.js";
import { LocalWorkspace } from "../src/workspace/Workspace.js";
import type { ChatMessage, ChatResult, LLMClient, ToolSchema } from "../src/agent/llm.js";
import type { AgentEvent } from "../src/protocol.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => noopLogger };

/** Replays a fixed list of model responses, ignoring the prompt. */
class StubLLM implements LLMClient {
  private i = 0;
  constructor(private readonly steps: ChatResult[]) {}
  async chat(_m: ChatMessage[], _t: ToolSchema[]): Promise<ChatResult> {
    return this.steps[this.i++] ?? { content: "", toolCalls: [] };
  }
}

const toolCall = (name: string, args: object, id = "c1") => ({ id, name, arguments: JSON.stringify(args) });

let dir: string;
let ws: LocalWorkspace;
let undo: MemoryUndoStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runner-test-"));
  ws = new LocalWorkspace({ id: "signup-app", name: "signup-app", path: dir });
  undo = new MemoryUndoStore();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(steps: ChatResult[], instruction: string): Promise<AgentEvent[]> {
  const runner = new LlmAgentRunner({
    llm: new StubLLM(steps),
    tools: defaultTools,
    risk: new DefaultRiskClassifier(),
    undo,
    log: noopLogger,
  });
  const evts: AgentEvent[] = [];
  await runner.run({
    request: { workspaceId: "signup-app", instruction, history: [], mode: "voice" },
    workspace: ws,
    emit: (e) => evts.push(e),
    signal: new AbortController().signal,
  });
  return evts;
}

const types = (e: AgentEvent[]) => e.map((x) => x.type);

describe("LlmAgentRunner", () => {
  it("LOW-risk single write: stages, applies to disk, records undo", async () => {
    await ws.writeFile("signup.ts", "old\n");
    const evts = await run(
      [
        { content: null, toolCalls: [toolCall("write_file", { path: "signup.ts", content: "new\n" })] },
        { content: "Updated signup.ts.", toolCalls: [] },
      ],
      "edit signup",
    );

    expect(types(evts)).toEqual(
      expect.arrayContaining(["IntentProposed", "ToolCall", "FileEdit", "Applied", "Done"]),
    );
    expect(await ws.readFile("signup.ts")).toBe("new\n"); // applied to disk
    expect(evts.at(-1)).toMatchObject({ type: "Done" });

    const record = undo.popLast("signup-app");
    expect(record).toHaveLength(1);
    expect(record?.[0]).toMatchObject({ path: "signup.ts", before: "old\n", after: "new\n" });
  });

  it("HIGH-risk delete: pauses for confirmation and writes NOTHING to disk", async () => {
    await ws.writeFile("validators.ts", "x\n");
    const evts = await run(
      [
        { content: null, toolCalls: [toolCall("delete_file", { path: "validators.ts" })] },
        { content: "Ready to remove validators.ts.", toolCalls: [] },
      ],
      "remove validators",
    );

    const decision = evts.find((e) => e.type === "DecisionRequest") as any;
    expect(decision?.decision.kind).toBe("confirmation");
    expect(decision?.decision.risk).toBe("HIGH");
    expect(types(evts)).not.toContain("FileEdit");
    expect(await ws.exists("validators.ts")).toBe(true); // staged, not deleted
    expect(evts.at(-1)).toMatchObject({ type: "Done" });
  });

  it("request_choice short-circuits with a choice then Done", async () => {
    const evts = await run(
      [
        {
          content: null,
          toolCalls: [
            toolCall("request_choice", {
              question: "How thorough?",
              options: [
                { id: "a", label: "A" },
                { id: "b", label: "B" },
              ],
              recommendedOptionId: "a",
            }),
          ],
        },
      ],
      "make validation robust",
    );
    const decision = evts.find((e) => e.type === "DecisionRequest") as any;
    expect(decision?.decision.kind).toBe("choice");
    expect(decision?.decision.options).toHaveLength(2);
    expect(evts.at(-1)).toMatchObject({ type: "Done" });
  });

  it("no edits (ask-about-code): speaks the answer", async () => {
    const evts = await run(
      [
        { content: null, toolCalls: [toolCall("read_file", { path: "signup.ts" })] },
        { content: "It inserts a user into the db.", toolCalls: [] },
      ],
      "what does signup do?",
    );
    const applied = evts.find((e) => e.type === "Applied") as any;
    expect(applied?.summary).toBe("It inserts a user into the db.");
    expect(types(evts)).not.toContain("FileEdit");
  });
});
