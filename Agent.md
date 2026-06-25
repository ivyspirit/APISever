# AGENTS.md — harness server

Thin harness server for a voice coding agent (one-day interview build,
AI-assisted). It does as little as possible: receive a turn, run the coding
agent against a local workspace, stream events back. Architecture quality is
the priority; keep it simple, don't over-engineer.

The client (separate Android app) talks to this server. SPEC.md (shared) is
the system design and defines the AgentEvent protocol — implement it exactly,
do not redefine it here.

## Stack
Node + TypeScript, Express, Server-Sent Events for streaming, the OpenAI SDK,
Node fs for the workspace. No DB, no auth, no git/GitHub, no remote VMs.
No new deps without asking. Pin versions; don't upgrade tooling mid-build.

## Secrets
NEVER hardcode the OpenAI API key (or any secret) in source. Read it from
`process.env.OPENAI_API_KEY` only (load via dotenv from a `.env` file). The
first commit must include a `.gitignore` containing `.env` and `node_modules/`.
Never log the key.

## Core principle — stateless turns
The server holds NO session state between requests. Every turn is a pure
function of (workspaceId, instruction, recent history) that the client sends.
The client owns the conversation; the server forwards history into the OpenAI
messages array and runs. This makes turns trivially restartable and makes
decision-answers just another turn with history. Cap incoming history to the
last few turns (client-supplied); don't accumulate server-side.

## Endpoints (only these)
The OpenAI key lives only in the server env; the client holds no key, so voice
is proxied here too. The client talks only to this server.
- `GET /workspaces` → the hardcoded registry: [{ id, name, path }].
- `POST /stt` → audio in → { text }. Calls OpenAI Whisper. (Voice slice.)
- `POST /turn` → SSE stream. Body { workspaceId, instruction, history[] }.
  Streams AgentEvents as they happen (never buffer the whole turn then dump).
- `POST /tts` → { text } → audio bytes. Calls OpenAI TTS. (Voice slice.)
- `POST /undo` → revert the last EditRecord for the workspace (deterministic,
  no LLM call).
Build text-first (/workspaces, /turn, /undo) and curl-test before adding the
voice endpoints. Keep handlers thin. All logic lives in the modules below.

## Modules (the abstractions)
- `Workspace` — the files the agent edits. Resolve workspaceId → path from the
  registry. All file access goes through this, never raw fs in handlers, so the
  backing store (local dir today) can become a clone/VM later. Confine all
  paths under the workspace root (no escaping it).
- `AgentRunner` — the agent loop: build OpenAI messages from (history +
  instruction), expose tools (read_file, list_dir, write_file), run the
  tool-call loop against a Workspace, emit the AgentEvent stream. ~100–150
  lines. You build the harness, not the model.
- `RiskClassifier` — deterministic policy over a proposed edit →
  LOW / HIGH / TOO_BIG_FOR_VOICE. Not the LLM. Thresholds: LOW = single file,
  additive, no deletes; HIGH = deletes or multi-file; TOO_BIG = > ~30 lines or
  > 3 files. The agent proposes; this decides apply / confirm / defer.
- `EditRecord { path, before, after }` — record the inverse BEFORE writing, so
  undo = rewrite `before`. Apply edits atomically per file.

## Streaming
Emit each AgentEvent the moment it occurs over SSE. Set the right headers
(text/event-stream, no-cache, keep-alive). Flush per event. Handle client
disconnect (abort the run).

## Observability (required — the dev verifies behavior via logs + curl, not by reading code)
Log every step in plain, prefixed, human-readable lines: each incoming request
(method, path, body summary), each OpenAI call (model, message count), each
tool call (name, target), each file write (path, bytes), each emitted
AgentEvent (type), and any error with a clear message. A `FAKE_AGENT=true` env
flag must make `/turn` stream scripted events with NO OpenAI call, as a
fallback path that always works.

## Determinism
Fixed model params for demo stability where sensible. Deterministic seed/
sample workspace so the demo is repeatable.

## Workflow
One slice per task; implement only that slice, no outside refactors. Fresh
chat per slice — read the SPEC.md section first. Don't commit unless asked.
Each slice ships as ONE pull request (see "Pull requests" below).

## Done (every slice)
1. Server builds (tsc) and runs; its tests pass.
2. Slice's listed tests implemented — RiskClassifier policy, EditRecord
   inverse/undo, AgentRunner tool loop applies edits, Workspace path
   confinement. No flaky end-to-end tests as the only coverage.
3. Self-review the diff vs SPEC.md; list deviations.
4. End with the handoff: Changes / Deviations / Tests (+passing run) / Manual
   verification (an end-to-end /turn via curl) / Out-of-scope noticed.

## Pull requests (one slice = one PR)
Every slice ships as a single PR off `main`. Before opening it, the PR must be
BOTH self-reviewed (read your own diff against SPEC.md; list any deviations)
AND test-verified (tests written and passing, `tsc` clean, server runs, and the
manual curl checks pass). Don't open the PR until both hold.

The PR description MUST use exactly these sections, in this order:

```
## Title
<concise, slice-scoped, e.g. "Slice 2: AgentEvent protocol + SSE + FAKE_AGENT /turn">

## Architecture changes
<new/changed abstractions, interfaces, and seams; what swaps in production>

## Files changed
<bulleted path list with a few words on each>

## Behavior added
<endpoints/events/flows now working; reference the SPEC contract>

## Tests / verification
<unit tests added + a copy of the passing run; tsc clean>

## Manual verification
<the exact curl commands run and their observed output>
```

Keep it honest: note deviations from SPEC.md and anything left out of scope.