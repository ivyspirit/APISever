/**
 * The registry entry for a workspace the agent can operate on. Today these map
 * to hardcoded local directories; in production the same shape could point at a
 * cloned repo or a remote VM without changing the client contract.
 */
export interface WorkspaceInfo {
  id: string;
  name: string;
  /** Absolute path to the workspace root on the harness machine. */
  path: string;
}
