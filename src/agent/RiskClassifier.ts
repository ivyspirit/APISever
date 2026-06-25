import type { Action, Risk } from "../protocol.js";
import type { StagedChange } from "./Changeset.js";
import { computeEdit } from "./diffUtil.js";

export interface RiskAssessment {
  risk: Risk;
  files: number;
  added: number;
  removed: number;
  recommendedAction: Action;
}

/**
 * A deterministic, crude-on-purpose policy gating a probabilistic agent. The
 * agent proposes a changeset; this decides apply / confirm / defer. It is NOT
 * the LLM and must never call one.
 */
export interface RiskClassifier {
  classify(changes: StagedChange[]): RiskAssessment;
}

/** Thresholds per SPEC.md 5b. Tunable in one place. */
export const RISK_THRESHOLDS = {
  maxFilesForVoice: 3,
  maxLinesForVoice: 30,
} as const;

export class DefaultRiskClassifier implements RiskClassifier {
  classify(changes: StagedChange[]): RiskAssessment {
    let added = 0;
    let removed = 0;
    let hasFileDelete = false;
    const paths = new Set<string>();

    for (const change of changes) {
      paths.add(change.path);
      if (change.op === "delete") hasFileDelete = true;
      const stats = computeEdit(change.path, change.before, change.after);
      added += stats.added;
      removed += stats.removed;
    }

    const files = paths.size;
    const totalLines = added + removed;

    let risk: Risk;
    let recommendedAction: Action;

    if (files > RISK_THRESHOLDS.maxFilesForVoice || totalLines > RISK_THRESHOLDS.maxLinesForVoice) {
      // Too much to review by ear — recommend handing off to the desktop.
      risk = "TOO_BIG_FOR_VOICE";
      recommendedAction = "defer";
    } else if (hasFileDelete || files > 1) {
      // Deletes or multi-file edits warrant a spoken confirmation.
      risk = "HIGH";
      recommendedAction = "approve";
    } else {
      // Single-file, no file deletion, within size limits: safe to auto-apply.
      risk = "LOW";
      recommendedAction = "approve";
    }

    return { risk, files, added, removed, recommendedAction };
  }
}
