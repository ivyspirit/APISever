import type { AgentEvent } from "../protocol.js";
import type { Workspace } from "../workspace/Workspace.js";

/** One summarized conversational turn the client carries as history. */
export interface HistoryTurn {
  role: "user" | "agent";
  text: string;
}

/**
 * The body of a `POST /turn`. The server is stateless: the client owns the
 * conversation and sends recent `history` each turn. `mode` tells the agent its
 * modality — `voice` (default) constrains it to bounded decisions; `text` is
 * the reserved desktop-handoff seam (not implemented in the voice build).
 */
export interface TurnRequest {
  workspaceId: string;
  instruction: string;
  history?: HistoryTurn[];
  mode?: "voice" | "text";
}

/**
 * Everything a runner needs to execute one turn. `workspace` is the file-access
 * object the agent reads/edits through (resolved from the registry by the
 * route). `emit` streams events the moment they occur; `signal` aborts when the
 * client disconnects.
 */
export interface TurnInput {
  request: TurnRequest;
  workspace: Workspace;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

/**
 * The agent engine. Implementations: `FakeAgentRunner` (scripted, no LLM —
 * Slice 2) and `LlmAgentRunner` (real OpenAI tool loop — Slice 3). The route
 * handler depends only on this interface.
 */
export interface AgentRunner {
  run(input: TurnInput): Promise<void>;
}
