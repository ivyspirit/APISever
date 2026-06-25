import express from "express";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDefaultRegistry } from "./workspace/registry.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { turnRouter } from "./routes/turn.js";
import { FakeAgentRunner } from "./agent/fakeAgent.js";
import { LlmAgentRunner } from "./agent/LlmAgentRunner.js";
import { DefaultRiskClassifier } from "./agent/RiskClassifier.js";
import { MemoryUndoStore } from "./agent/EditRecord.js";
import { defaultTools } from "./agent/tools.js";
import { createOpenAILLMClient } from "./openai/openaiClient.js";
import type { AgentRunner, TurnInput } from "./agent/AgentRunner.js";

/**
 * Composition root: load config, build dependencies, wire thin routes, start
 * the server. Each slice adds its dependencies and routes here.
 */
function main(): void {
  const config = loadConfig();
  const log = createLogger("server");

  const registry = createDefaultRegistry(config.workspacesRoot);

  // The undo store is the one bit of cross-request state (Slice 4 adds /undo).
  const undo = new MemoryUndoStore();

  // Pick the agent engine. FAKE_AGENT short-circuits to scripted events; the
  // real engine needs a key; absent both, stream a clear Error.
  const runner = selectRunner(config, undo, log);

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

function selectRunner(
  config: ReturnType<typeof loadConfig>,
  undo: MemoryUndoStore,
  log: ReturnType<typeof createLogger>,
): AgentRunner {
  if (config.fakeAgent) {
    log.info("agent engine: FAKE_AGENT (scripted, no OpenAI)");
    return new FakeAgentRunner(log.child("fake"));
  }
  if (config.openaiApiKey) {
    log.info("agent engine: OpenAI", { model: config.openaiModel });
    return new LlmAgentRunner({
      llm: createOpenAILLMClient(config.openaiApiKey, config.openaiModel, log.child("openai")),
      tools: defaultTools,
      risk: new DefaultRiskClassifier(),
      undo,
      log: log.child("agent"),
    });
  }
  log.warn("no OPENAI_API_KEY and FAKE_AGENT not set — /turn will stream an error");
  return missingKeyRunner();
}

/** Streams a single Error when neither a key nor FAKE_AGENT is configured. */
function missingKeyRunner(): AgentRunner {
  return {
    async run({ emit }: TurnInput): Promise<void> {
      emit({ type: "Error", reason: "no agent configured — set OPENAI_API_KEY or FAKE_AGENT=true" });
    },
  };
}

main();
