import { describe, it, expect } from "vitest";
import { DefaultRiskClassifier } from "../src/agent/RiskClassifier.js";
import type { StagedChange } from "../src/agent/Changeset.js";

const risk = new DefaultRiskClassifier();

const write = (path: string, before: string | null, after: string): StagedChange => ({
  path,
  op: "write",
  before,
  after,
});
const del = (path: string, before: string): StagedChange => ({ path, op: "delete", before, after: null });

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n";

describe("DefaultRiskClassifier", () => {
  it("LOW: single file, additive, no delete -> auto-apply", () => {
    const a = risk.classify([write("signup.ts", "a\n", "a\nb\n")]);
    expect(a.risk).toBe("LOW");
    expect(a.files).toBe(1);
  });

  it("HIGH: a file delete", () => {
    const a = risk.classify([del("validators.ts", "x\n")]);
    expect(a.risk).toBe("HIGH");
    expect(a.recommendedAction).toBe("approve");
  });

  it("HIGH: multi-file edit (no delete)", () => {
    const a = risk.classify([write("a.ts", "1\n", "2\n"), write("b.ts", "1\n", "2\n")]);
    expect(a.risk).toBe("HIGH");
  });

  it("TOO_BIG_FOR_VOICE: more than ~30 changed lines -> defer", () => {
    const a = risk.classify([write("big.ts", "", lines(40))]);
    expect(a.risk).toBe("TOO_BIG_FOR_VOICE");
    expect(a.recommendedAction).toBe("defer");
  });

  it("TOO_BIG_FOR_VOICE: more than 3 files -> defer", () => {
    const a = risk.classify([
      write("a.ts", "", "x\n"),
      write("b.ts", "", "x\n"),
      write("c.ts", "", "x\n"),
      write("d.ts", "", "x\n"),
    ]);
    expect(a.risk).toBe("TOO_BIG_FOR_VOICE");
  });
});
