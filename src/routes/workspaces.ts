import { Router } from "express";
import type { Logger } from "../logger.js";
import type { WorkspaceRegistry } from "../workspace/registry.js";

/**
 * GET /workspaces -> { workspaces: [{ id, name, path }] }
 * The hardcoded registry. Thin handler: all it does is read the registry.
 */
export function workspacesRouter(registry: WorkspaceRegistry, log: Logger): Router {
  const router = Router();

  router.get("/workspaces", (_req, res) => {
    const workspaces = registry.list();
    log.info("listed workspaces", { count: workspaces.length });
    res.json({ workspaces });
  });

  return router;
}
