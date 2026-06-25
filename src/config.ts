import "dotenv/config";

/**
 * Central, validated view of the process environment. Nothing else in the
 * codebase reads `process.env` directly, so configuration has one source of
 * truth and secrets never leak into logs (see logger.ts).
 */
export interface Config {
  port: number;
  workspacesRoot: string;
  fakeAgent: boolean;
  /** Present only when set; absent is fine for FAKE_AGENT mode. */
  openaiApiKey: string | undefined;
  /** Chat model for the agent loop. Fixed params elsewhere for determinism. */
  openaiModel: string;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadConfig(): Config {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  return {
    port,
    workspacesRoot:
      process.env.WORKSPACES_ROOT ?? "/Users/ivyli/Documents/Projects/workspace",
    fakeAgent: parseBool(process.env.FAKE_AGENT, false),
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  };
}
