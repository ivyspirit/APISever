import { describe, it, expect } from "vitest";
import { events, isTerminal } from "../src/protocol.js";

describe("protocol factories", () => {
  it("produce the exact wire shapes (case-sensitive field names)", () => {
    expect(events.intentProposed("x")).toEqual({ type: "IntentProposed", text: "x" });
    expect(events.thinking("Reading")).toEqual({ type: "Thinking", label: "Reading" });
    expect(events.toolCall("read_file", "a.ts")).toEqual({
      type: "ToolCall",
      kind: "read_file",
      target: "a.ts",
    });
    expect(events.fileEdit("a.ts", "@@", 3, 1)).toEqual({
      type: "FileEdit",
      path: "a.ts",
      diff: "@@",
      added: 3,
      removed: 1,
    });
    expect(events.applied("done")).toEqual({ type: "Applied", summary: "done" });
    expect(events.deferred("queued")).toEqual({ type: "Deferred", summary: "queued" });
    expect(events.error("nope")).toEqual({ type: "Error", reason: "nope" });
    expect(events.done()).toEqual({ type: "Done" });
  });

  it("wraps a decision under DecisionRequest.decision", () => {
    const ev = events.decision({
      kind: "choice",
      question: "q",
      options: [{ id: "a", label: "A" }],
      recommendedOptionId: "a",
    });
    expect(ev.type).toBe("DecisionRequest");
    expect(ev).toHaveProperty("decision.kind", "choice");
  });

  it("isTerminal only for Done and Error", () => {
    expect(isTerminal(events.done())).toBe(true);
    expect(isTerminal(events.error("x"))).toBe(true);
    expect(isTerminal(events.thinking("x"))).toBe(false);
    expect(isTerminal(events.applied("x"))).toBe(false);
  });
});
