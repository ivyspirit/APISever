import type { Request, Response } from "express";
import type { AgentEvent } from "./protocol.js";
import type { Logger } from "./logger.js";

/**
 * A live Server-Sent Events channel for one `/turn`. Owns the response stream:
 * sets the streaming headers, serializes each AgentEvent as it occurs (never
 * buffers the whole turn), and exposes an AbortSignal that fires when the
 * client disconnects so the agent run can stop.
 */
export interface SseChannel {
  /** Emit one AgentEvent immediately as a `data:` line. No-op once closed. */
  send(event: AgentEvent): void;
  /** End the stream (idempotent). */
  close(): void;
  /** Aborts when the client disconnects or the stream is closed. */
  readonly signal: AbortSignal;
  readonly closed: boolean;
}

export function openSse(req: Request, res: Response, log: Logger): SseChannel {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering so events flush immediately (e.g. nginx).
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    controller.abort();
    res.end();
  };

  // Client hung up (closed app, lost network) before we finished: abort the
  // run. Listen on the RESPONSE, not the request — a body-parsed POST's request
  // stream closes as soon as the body is read, which is not a disconnect.
  res.on("close", () => {
    if (!closed && !res.writableFinished) {
      log.info("client disconnected; aborting turn");
      closed = true;
      controller.abort();
    }
  });

  return {
    send(event: AgentEvent): void {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      log.info("event", { type: event.type });
    },
    close,
    get signal() {
      return controller.signal;
    },
    get closed() {
      return closed;
    },
  };
}
