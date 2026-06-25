/**
 * The inverse of one applied file change, captured BEFORE writing so undo is a
 * deterministic rewrite. `before === null` means the file did not exist (undo
 * deletes it); `after === null` means the change deleted the file (undo
 * recreates it from `before`).
 */
export interface EditRecord {
  path: string;
  before: string | null;
  after: string | null;
}

/**
 * Per-workspace stack of applied edit batches. This is the only cross-request
 * state the server keeps (lost on restart; production would persist it). The
 * `/undo` route (Slice 4) pops the last batch and restores each `before`.
 */
export interface UndoStore {
  record(workspaceId: string, edits: EditRecord[]): void;
  popLast(workspaceId: string): EditRecord[] | undefined;
}

export class MemoryUndoStore implements UndoStore {
  private readonly stacks = new Map<string, EditRecord[][]>();

  record(workspaceId: string, edits: EditRecord[]): void {
    if (edits.length === 0) return;
    const stack = this.stacks.get(workspaceId) ?? [];
    stack.push(edits);
    this.stacks.set(workspaceId, stack);
  }

  popLast(workspaceId: string): EditRecord[] | undefined {
    return this.stacks.get(workspaceId)?.pop();
  }
}
