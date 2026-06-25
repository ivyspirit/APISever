/**
 * Plain, prefixed, human-readable logging. The dev verifies behavior from
 * these lines + curl, not by reading code, so every meaningful step logs one
 * line. Never log secrets (e.g. the OpenAI key).
 */
type Fields = Record<string, unknown>;

function format(level: string, scope: string, msg: string, fields?: Fields): string {
  const ts = new Date().toISOString();
  let line = `${ts} ${level} [${scope}] ${msg}`;
  if (fields && Object.keys(fields).length > 0) {
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${stringify(v)}`);
    line += ` ${parts.join(" ")}`;
  }
  return line;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    info: (msg, fields) => console.log(format("INFO ", scope, msg, fields)),
    warn: (msg, fields) => console.warn(format("WARN ", scope, msg, fields)),
    error: (msg, fields) => console.error(format("ERROR", scope, msg, fields)),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}
