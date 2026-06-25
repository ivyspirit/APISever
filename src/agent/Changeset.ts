import { computeEdit, type EditStats } from "./diffUtil.js";

/** One staged file mutation, with its current on-disk content as the inverse. */
export interface StagedChange {
  path: string;
  op: "write" | "delete";
  /** Current disk content; null = the file does not exist yet. */
  before: string | null;
  /** New content; null = delete. */
  after: string | null;
}

/**
 * In-turn staging area. Tools record proposed writes/deletes here instead of
 * touching disk, so the RiskClassifier can score the WHOLE change before
 * anything is applied. Later writes to the same path overwrite earlier stages.
 */
export class Changeset {
  private readonly changes = new Map<string, StagedChange>();

  stageWrite(path: string, before: string | null, after: string): void {
    // Preserve the ORIGINAL before if this path was already staged (so the
    // inverse still points at the real pre-turn content).
    const original = this.changes.get(path)?.before ?? before;
    this.changes.set(path, { path, op: "write", before: original, after });
  }

  stageDelete(path: string, before: string): void {
    const original = this.changes.get(path)?.before ?? before;
    this.changes.set(path, { path, op: "delete", before: original, after: null });
  }

  list(): StagedChange[] {
    return [...this.changes.values()];
  }

  isEmpty(): boolean {
    return this.changes.size === 0;
  }

  /** Per-change diff + counts, used for FileEdit events and risk scoring. */
  stats(change: StagedChange): EditStats {
    return computeEdit(change.path, change.before, change.after);
  }
}
