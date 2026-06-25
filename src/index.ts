import express from "express";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDefaultRegistry } from "./workspace/registry.js";
import { workspacesRouter } from "./routes/workspaces.js";

/**
 * Composition root: load config, build dependencies, wire thin routes, start
 * the server. Each slice adds its dependencies and routes here.
 */
function main(): void {
  const config = loadConfig();
  const log = createLogger("server");

  const registry = createDefaultRegistry(config.workspacesRoot);

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

  app.listen(config.port, () => {
    log.info("harness server listening", {
      port: config.port,
      workspacesRoot: config.workspacesRoot,
      fakeAgent: config.fakeAgent,
    });
  });
}

main();
