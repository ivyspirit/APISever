import { join } from "node:path";
import type { WorkspaceInfo } from "./types.js";

/**
 * Resolves workspace ids to their on-disk locations. The set is hardcoded (the
 * brief allows pre-registered local dirs; the client selects, never creates).
 * Later slices add a `get(id): Workspace` that hands back a file-access object
 * bound to this path; Slice 1 only needs to list and look up the registry.
 */
export interface WorkspaceRegistry {
  list(): WorkspaceInfo[];
  find(id: string): WorkspaceInfo | undefined;
}

export class StaticWorkspaceRegistry implements WorkspaceRegistry {
  private readonly byId: Map<string, WorkspaceInfo>;

  constructor(private readonly workspaces: WorkspaceInfo[]) {
    this.byId = new Map(workspaces.map((w) => [w.id, w]));
  }

  list(): WorkspaceInfo[] {
    return this.workspaces;
  }

  find(id: string): WorkspaceInfo | undefined {
    return this.byId.get(id);
  }
}

/**
 * Builds the default registry under `workspacesRoot`. The directories are
 * seeded in a later slice; listing them here does not require them to exist.
 */
export function createDefaultRegistry(workspacesRoot: string): WorkspaceRegistry {
  const workspaces: WorkspaceInfo[] = [
    { id: "signup-app", name: "signup-app", path: join(workspacesRoot, "signup-app") },
    { id: "backend-api", name: "backend-api", path: join(workspacesRoot, "backend-api") },
  ];
  return new StaticWorkspaceRegistry(workspaces);
}
