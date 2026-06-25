import { createPatch, structuredPatch } from "diff";

export interface EditStats {
  /** Unified-diff string for the FileEdit event / diff view. */
  diff: string;
  added: number;
  removed: number;
}

/**
 * Compute the unified diff and the added/removed line counts between two file
 * contents. `null` means the file is absent (new file or deletion).
 */
export function computeEdit(path: string, before: string | null, after: string | null): EditStats {
  const beforeText = before ?? "";
  const afterText = after ?? "";

  const diff = createPatch(path, beforeText, afterText);

  let added = 0;
  let removed = 0;
  for (const hunk of structuredPatch(path, path, beforeText, afterText).hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) removed += 1;
    }
  }

  return { diff, added, removed };
}
