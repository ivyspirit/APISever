import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Seeds the hardcoded sample workspaces under WORKSPACES_ROOT so the demo beats
 * have real files to read and edit. Idempotent: re-run to reset the sample to a
 * known state (e.g. after the agent has applied edits).
 *
 *   npm run seed
 */
const root = process.env.WORKSPACES_ROOT ?? "/Users/ivyli/Documents/Projects/workspace";

const files: Record<string, string> = {
  // signup-app: targets for all five demo beats.
  "signup-app/signup.ts": `import { legacyValidate } from "./validators";
import { db } from "./db";

export function signup(email, password) {
  legacyValidate(email, password);
  return db.users.insert({ email, password });
}
`,
  "signup-app/validators.ts": `// Old, minimal validation helper. Beat 3 removes this and its import.
export function legacyValidate(email, password) {
  if (!email) {
    throw new Error("email required");
  }
}
`,
  "signup-app/db.ts": `export const db = {
  users: {
    insert(user) {
      return { id: Math.random().toString(36).slice(2), ...user };
    },
  },
};
`,
  "signup-app/README.md": `# signup-app

Tiny sample app used by the voice-agent demo. The signup function is the target
for the demo beats (doc comment, validation, remove helper, refactor).
`,

  // backend-api: minimal second entry so the registry/switcher has two.
  "backend-api/index.ts": `export function health() {
  return { ok: true };
}
`,
};

for (const [relPath, content] of Object.entries(files)) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  console.log(`seeded ${abs}`);
}

console.log(`\nDone. Seeded ${Object.keys(files).length} files under ${root}`);
