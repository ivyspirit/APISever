import { Router } from "express";
import type { Logger } from "../logger.js";
import { sendError } from "../http.js";
import { openSse } from "../sse.js";
import type { WorkspaceRegistry } from "../workspace/registry.js";
import type { AgentRunner, TurnRequest } from "../agent/AgentRunner.js";

/**
 * POST /turn — the only endpoint that runs the agent. Validates the request
 * BEFORE opening the stream (so request errors are normal JSON, not SSE), then
 * streams AgentEvents until the runner terminates the turn (Done or Error).
 */
export function turnRouter(registry: WorkspaceRegistry, runner: AgentRunner, log: Logger): Router {
  const router = Router();

  router.post("/turn", async (req, res) => {
    const body = (req.body ?? {}) as Partial<TurnRequest>;
    const { workspaceId, instruction } = body;

    if (typeof instruction !== "string" || instruction.trim().length === 0) {
      log.warn("rejected turn", { reason: "missing instruction" });
      return sendError(res, 400, "bad_request", "instruction required");
    }
    if (typeof workspaceId !== "string") {
      log.warn("rejected turn", { reason: "missing workspaceId" });
      return sendError(res, 400, "bad_request", "workspaceId required");
    }
    const workspace = registry.find(workspaceId);
    if (!workspace) {
      log.warn("rejected turn", { reason: "unknown workspaceId", workspaceId });
      return sendError(res, 404, "no_workspace", "unknown workspaceId");
    }

    log.info("turn", {
      workspaceId,
      mode: body.mode ?? "voice",
      historyLen: body.history?.length ?? 0,
      instruction: instruction.trim(),
    });

    const channel = openSse(req, res, log);
    try {
      await runner.run({
        request: {
          workspaceId,
          instruction: instruction.trim(),
          history: body.history ?? [],
          mode: body.mode ?? "voice",
        },
        workspace,
        emit: (event) => channel.send(event),
        signal: channel.signal,
      });
    } catch (err) {
      // Agent failures are reported in-stream as an Error event, never as an
      // HTTP error (the stream is already open).
      const reason = err instanceof Error ? err.message : "agent service error";
      log.error("turn failed mid-stream", { reason });
      channel.send({ type: "Error", reason: "agent service error" });
    } finally {
      channel.close();
    }
  });

  return router;
}
