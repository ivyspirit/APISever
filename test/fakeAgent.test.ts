import { describe, it, expect } from "vitest";
import { FakeAgentRunner } from "../src/agent/fakeAgent.js";
import type { AgentEvent } from "../src/protocol.js";
import type { Logger } from "../src/logger.js";
import type { WorkspaceInfo } from "../src/workspace/types.js";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const workspace: WorkspaceInfo = { id: "signup-app", name: "signup-app", path: "/tmp/signup-app" };

/** Run the fake runner instantly (no delays) and collect the emitted events. */
async function collect(instruction: string, opts?: { abortFirst?: boolean }): Promise<AgentEvent[]> {
  const runner = new FakeAgentRunner(noopLogger, { stepDelayMs: 0 });
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  if (opts?.abortFirst) controller.abort();
  await runner.run({
    request: { workspaceId: "signup-app", instruction, history: [], mode: "voice" },
    workspace,
    emit: (e) => events.push(e),
    signal: controller.signal,
  });
  return events;
}

const types = (evts: AgentEvent[]) => evts.map((e) => e.type);
const terminals = (evts: AgentEvent[]) => evts.filter((e) => e.type === "Done" || e.type === "Error");

describe("FakeAgentRunner — stream invariants", () => {
  it("every non-error script ends with exactly one Done and no Error", async () => {
    for (const instruction of [
      "add a doc comment to signup",
      "make validation more robust",
      "remove the old validation helper",
      "refactor signup to the new pattern everywhere",
      "email and password",
      "approve",
      "defer",
      "reject",
    ]) {
      const evts = await collect(instruction);
      const term = terminals(evts);
      expect(term, instruction).toHaveLength(1);
      expect(term[0]?.type, instruction).toBe("Done");
      expect(evts[0]?.type, instruction).toBe("IntentProposed");
    }
  });

  it("aborted-before-start emits nothing", async () => {
    expect(await collect("add a doc comment", { abortFirst: true })).toEqual([]);
  });
});

describe("FakeAgentRunner — demo beats", () => {
  it("beat 1: low-risk applies and auto-completes", async () => {
    const evts = await collect("add a doc comment to signup");
    expect(types(evts)).toContain("FileEdit");
    expect(types(evts)).toContain("Applied");
    expect(types(evts)).not.toContain("DecisionRequest");
  });

  it("beat 2: choice pauses on a DecisionRequest, no FileEdit", async () => {
    const evts = await collect("make the validation more robust");
    const decision = evts.find((e) => e.type === "DecisionRequest");
    expect(decision).toBeDefined();
    expect(decision).toHaveProperty("decision.kind", "choice");
    expect(decision).toHaveProperty("decision.recommendedOptionId", "rules");
    expect((decision as any).decision.options).toHaveLength(3);
    expect(types(evts)).not.toContain("FileEdit");
    // DecisionRequest is immediately followed by Done.
    const i = types(evts).indexOf("DecisionRequest");
    expect(types(evts)[i + 1]).toBe("Done");
  });

  it("beat 3: remove helper is HIGH risk, recommends approve", async () => {
    const evts = await collect("remove the old validation helper");
    const d = evts.find((e) => e.type === "DecisionRequest") as any;
    expect(d.decision.kind).toBe("confirmation");
    expect(d.decision.risk).toBe("HIGH");
    expect(d.decision.recommendedAction).toBe("approve");
  });

  it("beat 4: refactor is TOO_BIG, recommends defer", async () => {
    const evts = await collect("refactor signup to the new pattern everywhere");
    const d = evts.find((e) => e.type === "DecisionRequest") as any;
    expect(d.decision.risk).toBe("TOO_BIG_FOR_VOICE");
    expect(d.decision.recommendedAction).toBe("defer");
  });

  it("follow-ups: approve applies, defer queues", async () => {
    expect(types(await collect("approve"))).toContain("Applied");
    expect(types(await collect("defer"))).toContain("Deferred");
  });
});

describe("FakeAgentRunner — error script", () => {
  it("terminates on Error, never Done", async () => {
    const evts = await collect("trigger an error please");
    const term = terminals(evts);
    expect(term).toHaveLength(1);
    expect(term[0]?.type).toBe("Error");
    expect(types(evts)).not.toContain("Done");
    expect(evts.at(-1)).toMatchObject({ type: "Error" });
  });
});
