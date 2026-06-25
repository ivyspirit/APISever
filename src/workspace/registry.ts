import { join } from "node:path";
import type { WorkspaceInfo } from "./types.js";
import { LocalWorkspace, type Workspace } from "./Workspace.js";

/**
 * Resolves workspace ids to their on-disk locations. The set is hardcoded (the
 * brief allows pre-registered local dirs; the client selects, never creates).
 * `list()` powers GET /workspaces; `get()` hands back a file-access Workspace
 * bound to the entry's path for the agent to operate on.
 */
export interface WorkspaceRegistry {
  list(): WorkspaceInfo[];
  get(id: string): Workspace | undefined;
}

export class StaticWorkspaceRegistry implements WorkspaceRegistry {
  private readonly byId: Map<string, Workspace>;

  constructor(private readonly workspaces: WorkspaceInfo[]) {
    this.byId = new Map(workspaces.map((w) => [w.id, new LocalWorkspace(w)]));
  }

  list(): WorkspaceInfo[] {
    return this.workspaces;
  }

  get(id: string): Workspace | undefined {
    return this.byId.get(id);
  }
}

/**
 * Builds the default registry under `workspacesRoot`. The directories are
 * seeded by `npm run seed`; listing them here does not require them to exist.
 */
export function createDefaultRegistry(workspacesRoot: string): WorkspaceRegistry {
  const workspaces: WorkspaceInfo[] = [
    { id: "signup-app", name: "signup-app", path: join(workspacesRoot, "signup-app") },
    { id: "backend-api", name: "backend-api", path: join(workspacesRoot, "backend-api") },
  ];
  return new StaticWorkspaceRegistry(workspaces);
}
