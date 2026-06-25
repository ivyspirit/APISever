import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkspaceInfo } from "./types.js";

export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

/**
 * The files the agent edits. The ONLY path into `fs` — handlers and the runner
 * never touch the filesystem directly, so the backing store (a local dir today)
 * can become a cloned repo or remote VM later behind the same interface. Every
 * method confines paths under the workspace root.
 */
export interface Workspace {
  readonly info: WorkspaceInfo;
  /** Absolute, root-confined path for a workspace-relative path. Throws on escape. */
  resolve(relPath: string): string;
  exists(relPath: string): Promise<boolean>;
  readFile(relPath: string): Promise<string>;
  listDir(relPath: string): Promise<DirEntry[]>;
  writeFile(relPath: string, content: string): Promise<void>;
  deleteFile(relPath: string): Promise<void>;
}

/** Thrown when a path would escape the workspace root. */
export class PathEscapeError extends Error {
  constructor(relPath: string) {
    super(`path escapes workspace root: ${relPath}`);
    this.name = "PathEscapeError";
  }
}

export class LocalWorkspace implements Workspace {
  private readonly root: string;

  constructor(readonly info: WorkspaceInfo) {
    this.root = resolve(info.path);
  }

  resolve(relPath: string): string {
    // Reject absolute inputs outright; resolve relative ones against the root
    // and verify the result stays inside it (blocks `..`, symlink-free escapes).
    const candidate = isAbsolute(relPath) ? resolve(relPath) : resolve(this.root, relPath);
    const rel = relative(this.root, candidate);
    const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (escapes) throw new PathEscapeError(relPath);
    return candidate;
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(relPath: string): Promise<string> {
    return fs.readFile(this.resolve(relPath), "utf8");
  }

  async listDir(relPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(this.resolve(relPath), { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = this.resolve(relPath);
    await fs.mkdir(join(abs, ".."), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  async deleteFile(relPath: string): Promise<void> {
    await fs.rm(this.resolve(relPath), { force: true });
  }
}
