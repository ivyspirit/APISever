import type { AgentEvent, Decision } from "../protocol.js";
import { events } from "../protocol.js";
import type { Workspace } from "../workspace/Workspace.js";
import type { Changeset } from "./Changeset.js";
import type { ToolSchema } from "./llm.js";

/** What a tool can touch during a turn. */
export interface ToolContext {
  workspace: Workspace;
  changeset: Changeset;
  emit: (event: AgentEvent) => void;
}

/**
 * The result fed back to the model. `output` becomes the tool message; a
 * `decision` short-circuits the loop (the runner emits DecisionRequest + Done).
 */
export interface ToolResult {
  output: string;
  decision?: Decision;
}

export interface ToolDefinition {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const readFileTool: ToolDefinition = {
  schema: {
    name: "read_file",
    description: "Read a UTF-8 text file in the workspace. Returns its full contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative file path" } },
      required: ["path"],
    },
  },
  async execute(args, ctx) {
    const path = str(args.path);
    ctx.emit(events.toolCall("read_file", path));
    try {
      return { output: await ctx.workspace.readFile(path) };
    } catch {
      return { output: `Error: could not read file: ${path}` };
    }
  },
};

const listDirTool: ToolDefinition = {
  schema: {
    name: "list_dir",
    description: "List entries in a workspace directory (use \".\" for the root).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative dir path" } },
      required: ["path"],
    },
  },
  async execute(args, ctx) {
    const path = str(args.path) || ".";
    ctx.emit(events.toolCall("list_dir", path));
    try {
      const entries = await ctx.workspace.listDir(path);
      return { output: entries.map((e) => `${e.type === "dir" ? "d" : "-"} ${e.name}`).join("\n") || "(empty)" };
    } catch {
      return { output: `Error: could not list dir: ${path}` };
    }
  },
};

const writeFileTool: ToolDefinition = {
  schema: {
    name: "write_file",
    description:
      "Propose writing the FULL new contents of a file (created if absent). " +
      "Staged for review, not written immediately. Provide the complete file, not a patch.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        content: { type: "string", description: "The complete new file contents" },
      },
      required: ["path", "content"],
    },
  },
  async execute(args, ctx) {
    const path = str(args.path);
    const content = str(args.content);
    ctx.emit(events.toolCall("write_file", path));
    const before = (await ctx.workspace.exists(path)) ? await ctx.workspace.readFile(path) : null;
    ctx.changeset.stageWrite(path, before, content);
    return { output: `Staged write to ${path} (${content.split("\n").length} lines).` };
  },
};

const deleteFileTool: ToolDefinition = {
  schema: {
    name: "delete_file",
    description: "Propose deleting a workspace file. Staged for review, not deleted immediately.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative file path" } },
      required: ["path"],
    },
  },
  async execute(args, ctx) {
    const path = str(args.path);
    ctx.emit(events.thinking(`Removing ${path}`));
    if (!(await ctx.workspace.exists(path))) {
      return { output: `Error: file does not exist: ${path}` };
    }
    const before = await ctx.workspace.readFile(path);
    ctx.changeset.stageDelete(path, before);
    return { output: `Staged delete of ${path}.` };
  },
};

const requestChoiceTool: ToolDefinition = {
  schema: {
    name: "request_choice",
    description:
      "Ask the user to pick ONE of a few bounded options by voice. Use only when " +
      "there is a genuine fork you cannot resolve from the instruction. Never ask " +
      "open-ended questions in voice mode.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, label: { type: "string" } },
            required: ["id", "label"],
          },
        },
        recommendedOptionId: { type: "string" },
      },
      required: ["question", "options"],
    },
  },
  async execute(args) {
    const rawOptions = Array.isArray(args.options) ? args.options : [];
    const options = rawOptions.map((o) => {
      const obj = (o ?? {}) as Record<string, unknown>;
      return { id: str(obj.id), label: str(obj.label) };
    });
    const decision: Decision = {
      kind: "choice",
      question: str(args.question),
      options,
      ...(typeof args.recommendedOptionId === "string"
        ? { recommendedOptionId: args.recommendedOptionId }
        : {}),
    };
    return { output: "Asked the user to choose.", decision };
  },
};

/** The registry handed to the runner. */
export const defaultTools: ToolDefinition[] = [
  readFileTool,
  listDirTool,
  writeFileTool,
  deleteFileTool,
  requestChoiceTool,
];
