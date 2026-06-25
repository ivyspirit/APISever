import express from "express";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDefaultRegistry } from "./workspace/registry.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { turnRouter } from "./routes/turn.js";
import { FakeAgentRunner } from "./agent/fakeAgent.js";
import type { AgentRunner, TurnInput } from "./agent/AgentRunner.js";

/**
 * Composition root: load config, build dependencies, wire thin routes, start
 * the server. Each slice adds its dependencies and routes here.
 */
function main(): void {
  const config = loadConfig();
  const log = createLogger("server");

  const registry = createDefaultRegistry(config.workspacesRoot);

  // Slice 2 ships only the scripted runner. The real OpenAI-backed
  // `LlmAgentRunner` arrives in Slice 3; until then non-fake mode streams a
  // clear Error so the seam stays honest rather than silently faking.
  const runner: AgentRunner = config.fakeAgent
    ? new FakeAgentRunner(log.child("fake"))
    : notImplementedRunner();

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    log.info("request", { method: req.method, path: req.path });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, fakeAgent: config.fakeAgent });
  });

  app.use(workspacesRouter(registry, log.child("workspaces")));
  app.use(turnRouter(registry, runner, log.child("turn")));

  app.listen(config.port, () => {
    log.info("harness server listening", {
      port: config.port,
      workspacesRoot: config.workspacesRoot,
      fakeAgent: config.fakeAgent,
    });
  });
}

/** Placeholder until Slice 3: streams a single Error explaining how to run. */
function notImplementedRunner(): AgentRunner {
  return {
    async run({ emit }: TurnInput): Promise<void> {
      emit({
        type: "Error",
        reason: "real agent not wired yet — run with FAKE_AGENT=true (Slice 2)",
      });
    },
  };
}

main();
