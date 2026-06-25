import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkspace, PathEscapeError } from "../src/workspace/Workspace.js";

let dir: string;
let ws: LocalWorkspace;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-test-"));
  ws = new LocalWorkspace({ id: "t", name: "t", path: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("LocalWorkspace path confinement", () => {
  it("resolves paths inside the root", () => {
    expect(ws.resolve("a/b.ts")).toBe(join(dir, "a/b.ts"));
  });

  it("rejects parent-traversal escapes", () => {
    expect(() => ws.resolve("../escape.ts")).toThrow(PathEscapeError);
    expect(() => ws.resolve("a/../../escape.ts")).toThrow(PathEscapeError);
  });

  it("rejects absolute paths outside the root", () => {
    expect(() => ws.resolve("/etc/passwd")).toThrow(PathEscapeError);
  });
});

describe("LocalWorkspace file ops", () => {
  it("write, read, exists, list, delete round-trip", async () => {
    expect(await ws.exists("foo.ts")).toBe(false);
    await ws.writeFile("foo.ts", "hello\n");
    expect(await ws.exists("foo.ts")).toBe(true);
    expect(await ws.readFile("foo.ts")).toBe("hello\n");

    await ws.writeFile("nested/bar.ts", "x\n");
    const entries = await ws.listDir(".");
    expect(entries.map((e) => e.name).sort()).toEqual(["foo.ts", "nested"]);

    await ws.deleteFile("foo.ts");
    expect(await ws.exists("foo.ts")).toBe(false);
  });
});
