import type { AgentEvent } from "../protocol.js";
import { events } from "../protocol.js";
import type { Logger } from "../logger.js";
import type { AgentRunner, TurnInput } from "./AgentRunner.js";

/**
 * Scripted agent: emits a hardcoded AgentEvent sequence per turn with NO
 * OpenAI call, no tool loop, and no file writes. This is the FAKE_AGENT=true
 * demo fallback and the harness for building/verifying the SSE + protocol
 * surface before the real model is wired in (Slice 3). It also ships an
 * Error-terminated script so the failure path can be mock-tested on demand.
 *
 * Which script runs is chosen deterministically from keywords in the
 * instruction, so the five demo beats (and their follow-up answers) replay the
 * same way every time.
 */

/** One scripted event with the delay (ms) to wait before emitting it. */
interface Step {
  after: number;
  event: AgentEvent;
}

type Script = (instruction: string) => Step[];

/** A named script, so logs can report which beat ran. */
interface SelectedScript {
  name: string;
  script: Script;
}

const DEFAULT_STEP_DELAY = 350;

export interface FakeAgentOptions {
  /** Per-step delay; tests pass 0 to run instantly. Defaults to ~350ms. */
  stepDelayMs?: number;
}

export class FakeAgentRunner implements AgentRunner {
  private readonly delay: number;

  constructor(
    private readonly log: Logger,
    options: FakeAgentOptions = {},
  ) {
    this.delay = options.stepDelayMs ?? DEFAULT_STEP_DELAY;
  }

  async run(input: TurnInput): Promise<void> {
    const instruction = input.request.instruction.trim();
    const { name, script } = selectScript(instruction);
    this.log.info("fake turn", { script: name, instruction });

    const steps = script(instruction);
    for (const step of steps) {
      await sleep(this.delay, input.signal);
      if (input.signal.aborted) return;
      input.emit(step.event);
    }
  }
}

// --- script selection -------------------------------------------------------

/**
 * Maps an instruction to a script by keyword. Order matters: more specific
 * answers (decision follow-ups) are matched before the broad intent triggers.
 */
function selectScript(instruction: string): SelectedScript {
  const text = instruction.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  // Error path (mock failures on demand).
  if (has("error", "fail", "boom", "crash")) return { name: "error", script: errorScript };

  // Decision follow-up answers (the user's spoken reply = a new turn).
  if (has("defer")) return { name: "deferred", script: deferredScript };
  if (has("approve", "yes, do it", "do it", "go ahead")) return { name: "applyApprove", script: applyApproveScript };
  if (has("reject", "cancel", "never mind", "no thanks")) return { name: "rejected", script: rejectedScript };
  if (has("empty", "email and password", "email + password", "rules", "full validation"))
    return { name: "applyChoice", script: applyChoiceScript };

  // Demo beat intents. Order matters: destructive intents (remove/refactor) are
  // matched before the broad "validation" keyword, since e.g. "remove the old
  // validation helper" contains both.
  if (has("refactor", "everywhere", "rename across", "migrate"))
    return { name: "confirmTooBig", script: confirmTooBigScript };
  if (has("remove", "delete", "drop")) return { name: "confirmHigh", script: confirmHighScript };
  if (has("doc comment", "docstring", "comment")) return { name: "lowRisk", script: lowRiskScript };
  if (has("robust", "validation", "validate")) return { name: "choice", script: choiceScript };

  // Fallback: a safe low-risk apply so any instruction still demos.
  return { name: "default", script: lowRiskScript };
}

// --- scripts ----------------------------------------------------------------

const SIGNUP_DOC_DIFF = `@@ -1,3 +1,6 @@
+/**
+ * Registers a new user from an email + password.
+ */
 export function signup(email, password) {
   return db.users.insert({ email, password });
 }`;

const SIGNUP_VALIDATION_DIFF = `@@ -1,3 +1,11 @@
 export function signup(email, password) {
+  if (!email || !email.includes("@")) {
+    throw new Error("A valid email is required");
+  }
+  if (!password || password.length < 8) {
+    throw new Error("Password must be at least 8 characters");
+  }
   return db.users.insert({ email, password });
 }`;

const REMOVE_HELPER_DIFF = `@@ -1,4 +1,1 @@
-import { legacyValidate } from "./validators";
-
 export function signup(email, password) {
-  legacyValidate(email, password);
   return db.users.insert({ email, password });
 }`;

/** Beat 1 — low-risk, auto-applied (SPEC Case A). */
const lowRiskScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Add a doc comment to signup")) },
  { after: 1, event: events.thinking("Reading workspace") },
  { after: 1, event: events.toolCall("read_file", "signup.ts") },
  { after: 1, event: events.thinking("Planning changes") },
  { after: 1, event: events.fileEdit("signup.ts", SIGNUP_DOC_DIFF, 3, 0) },
  { after: 1, event: events.applied("Added a doc comment to signup.ts, 3 lines") },
  { after: 1, event: events.done() },
];

/** Beat 2 — choice, the hero interaction (SPEC Case B). Pauses on the decision. */
const choiceScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Make signup validation more robust")) },
  { after: 1, event: events.thinking("Reading workspace") },
  { after: 1, event: events.toolCall("read_file", "signup.ts") },
  {
    after: 1,
    event: events.decision({
      kind: "choice",
      question: "How thorough should validation be?",
      options: [
        { id: "empty", label: "Empty checks only" },
        { id: "rules", label: "Email + password rules" },
        { id: "full", label: "Full validation" },
      ],
      recommendedOptionId: "rules",
    }),
  },
  { after: 1, event: events.done() },
];

/** Follow-up to the choice — applies the chosen validation. */
const applyChoiceScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Email + password rules")) },
  { after: 1, event: events.thinking("Planning changes") },
  { after: 1, event: events.fileEdit("signup.ts", SIGNUP_VALIDATION_DIFF, 8, 0) },
  { after: 1, event: events.applied("Added email and password validation to signup.ts, 8 lines") },
  { after: 1, event: events.done() },
];

/** Beat 3 — HIGH risk: deletes + multi-file (SPEC Case C). Pauses for confirm. */
const confirmHighScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Remove the old validation helper")) },
  { after: 1, event: events.thinking("Reading workspace") },
  { after: 1, event: events.toolCall("read_file", "validators.ts") },
  { after: 1, event: events.thinking("Planning changes") },
  {
    after: 1,
    event: events.decision({
      kind: "confirmation",
      summary: "Removes validators.ts and updates its import in signup.ts",
      risk: "HIGH",
      files: 2,
      added: 0,
      removed: 13,
      recommendedAction: "approve",
      actions: ["approve", "reject", "defer"],
    }),
  },
  { after: 1, event: events.done() },
];

/** Beat 4 — TOO_BIG: recommends defer (SPEC Case C, rec=defer). Pauses. */
const confirmTooBigScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Refactor signup to the new pattern everywhere")) },
  { after: 1, event: events.thinking("Planning changes") },
  {
    after: 1,
    event: events.decision({
      kind: "confirmation",
      summary: "Refactor touches 4 files including a delete",
      risk: "TOO_BIG_FOR_VOICE",
      files: 4,
      added: 38,
      removed: 12,
      recommendedAction: "defer",
      actions: ["approve", "reject", "defer"],
    }),
  },
  { after: 1, event: events.done() },
];

/** Follow-up "approve"/"approve anyway" — applies the previously-proposed change. */
const applyApproveScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Approve")) },
  { after: 1, event: events.thinking("Applying changes") },
  { after: 1, event: events.fileEdit("signup.ts", REMOVE_HELPER_DIFF, 0, 4) },
  { after: 1, event: events.applied("Removed the old validation helper and updated its import") },
  { after: 1, event: events.done() },
];

/** Follow-up "defer" — queues for desktop review (SPEC Case D). */
const deferredScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Defer")) },
  { after: 1, event: events.deferred("Queued 'refactor signup' for desktop review (4 files)") },
  { after: 1, event: events.done() },
];

/** Follow-up "reject" — abandons the proposed change, nothing applied. */
const rejectedScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Reject")) },
  { after: 1, event: events.thinking("Discarding the proposed change") },
  { after: 1, event: events.done() },
];

/** Error path (SPEC Case E) — terminates on Error, NOT Done. */
const errorScript: Script = (instruction) => [
  { after: 0, event: events.intentProposed(echo(instruction, "Edit the login flow")) },
  { after: 1, event: events.toolCall("read_file", "login.ts") },
  { after: 1, event: events.error("file not found: login.ts") },
];

// --- helpers ----------------------------------------------------------------

/** Echo the real instruction when present, else a sensible default label. */
function echo(instruction: string, fallback: string): string {
  return instruction.length > 0 ? instruction : fallback;
}

/** Abortable delay: resolves after `ms`, or immediately once aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
