/**
 * The AgentEvent protocol — the single shared vocabulary between this server
 * (emits) and the client (parses). Field names are exact and case-sensitive
 * (`added`/`removed`, not `addedLines`); see SPEC.md section 5b. Keep this file
 * language-neutral in spirit: the Kotlin client mirrors these exact shapes.
 */

export type Risk = "LOW" | "HIGH" | "TOO_BIG_FOR_VOICE";
export type ToolKind = "read_file" | "list_dir" | "write_file";
export type Action = "approve" | "reject" | "defer";

/** A choice option the user picks by voice (or tap as a glance fallback). */
export interface ChoiceOption {
  id: string;
  label: string;
}

/**
 * The payload the agent emits when it needs a human decision. Two variants are
 * implemented for the voice build; both are answerable hands-free.
 *
 * RESERVED (designed, not implemented): a third `prompt` variant
 * `{ kind: "prompt"; question; hint? }` for free-form input, unlocked only by
 * `mode === "text"` (the desktop handoff). Voice mode must stay bounded, so it
 * is intentionally absent from this union until text mode exists.
 */
export type Decision =
  | {
      kind: "choice";
      question: string;
      options: ChoiceOption[];
      recommendedOptionId?: string;
    }
  | {
      kind: "confirmation";
      summary: string;
      risk: Risk;
      files: number;
      added: number;
      removed: number;
      recommendedAction: Action;
      actions: Action[];
    };

/**
 * Every `/turn` emits a stream of these, one per SSE `data:` line. Stream
 * invariant: a turn ends with exactly one `Done` OR one `Error`; a
 * `DecisionRequest` is immediately followed by `Done` (the turn pauses and the
 * user's answer arrives as a NEW `/turn`).
 */
export type AgentEvent =
  | { type: "IntentProposed"; text: string }
  | { type: "Thinking"; label: string }
  | { type: "ToolCall"; kind: ToolKind; target: string }
  | { type: "FileEdit"; path: string; diff: string; added: number; removed: number }
  | { type: "DecisionRequest"; decision: Decision }
  | { type: "Applied"; summary: string }
  | { type: "Deferred"; summary: string }
  | { type: "Error"; reason: string }
  | { type: "Done" };

export type AgentEventType = AgentEvent["type"];

/**
 * Typed factory helpers. Using these instead of raw object literals keeps the
 * emitted shapes correct in one place and makes call sites read like the
 * protocol.
 */
export const events = {
  intentProposed: (text: string): AgentEvent => ({ type: "IntentProposed", text }),
  thinking: (label: string): AgentEvent => ({ type: "Thinking", label }),
  toolCall: (kind: ToolKind, target: string): AgentEvent => ({ type: "ToolCall", kind, target }),
  fileEdit: (path: string, diff: string, added: number, removed: number): AgentEvent => ({
    type: "FileEdit",
    path,
    diff,
    added,
    removed,
  }),
  decision: (decision: Decision): AgentEvent => ({ type: "DecisionRequest", decision }),
  applied: (summary: string): AgentEvent => ({ type: "Applied", summary }),
  deferred: (summary: string): AgentEvent => ({ type: "Deferred", summary }),
  error: (reason: string): AgentEvent => ({ type: "Error", reason }),
  done: (): AgentEvent => ({ type: "Done" }),
} as const;

/** The two events that terminate a turn. */
export function isTerminal(event: AgentEvent): boolean {
  return event.type === "Done" || event.type === "Error";
}
