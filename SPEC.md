# SPEC.md — Voice-mode coding agent

What to build. How to work lives in AGENTS.md.

## 1. Product

**Thesis.** Laptop coding is synchronous — you watch the agent, read every
diff, intervene continuously. Voice coding (driving, biking) can't do any of
that. So this is **asynchronous delegation**: you state intent by voice, the
agent works autonomously on a real codebase, acts on its own for low-risk
work and reports by voice, and **interrupts you only when it needs a human
decision** — in a form answerable hands-free. Heavy review defers to laptop.
Everything reversible.

**Persona.** A developer away from their desk who can speak and glance, but
can't type or read carefully.

**Answers to the brief's questions:**
- *Different from laptop?* Dispatching, not piloting. The agent interrupts;
  you don't supervise. Output must be audio-summarizable; turns small and
  reversible.
- *Use cases to nail?* Targeted edits, spoken-choice decisions, and asking
  about code — not bulk codegen you can't verify by ear.
- *Non-voice handoff?* A change too big to review by voice is **deferred to
  desktop** — same workspace, richer surface. Handoff is a first-class
  behavior, not an afterthought.
- *Agent architecture?* An autonomous loop on a thin harness server that
  emits a stream of events, including decision-request pauses it blocks on
  until the human answers.

## 2. Core loop (one turn)

```
Idle (orb listening)
  → user speaks intent
  → STT → instruction text
  → Intent Confirmation: agent echoes understanding → run / edit / cancel
  → Agent loop runs on the workspace, streaming events:
       Thinking → ToolCall(read/write) → FileEdit(diff)
  → RiskClassifier scores the proposed change:
       LOW       → auto-apply → speak summary → Idle
       HIGH      → DecisionRequest.Confirmation (approve/reject/defer) → act
       TOO_BIG   → DecisionRequest.Confirmation, recommendation = DEFER
  → DecisionRequest.Choice when the agent hits an n-way fork
  → any stage → Error → spoken error + retry → Idle
```

Confirmation and Choice are one abstraction (`DecisionRequest`); the agent
emits it, the UI renders it as a bottom sheet, the user answers by voice
(tap as glance fallback), the agent continues.

## 3. Screens

Visual source of truth: the mock PNG (8-state storyboard).

**Session (home, the whole app).** Voice-first. Persistent voice orb encodes
state (idle / listening / hearing / thinking / speaking; tap to start, tap to
interrupt). Context header: active workspace + repo + harness-connection
status. States cycle in place: Ready → Listening → Intent Confirmation
(echo + Run/Edit/Cancel) → Working (streamed events as a live checklist) →
Done (spoken summary; Diff + Undo). Transcript + inline edit cards accrue.
A "Workspace ›" link (top-right) steps to the workspace screen.

**Decision bottom sheet (over Session).** One component, two variants:
- *Choice* — spoken question + option cards (suggested one marked); answer by
  voice or tap.
- *Confirmation* — semantic summary + file/line counts + risk pill; actions
  Approve / Reject / Defer-to-desktop, recommendation scaled to risk, dev
  authority preserved (can override a defer recommendation).

**Workspace (side-trip, optional for demo).** Reached via "Workspace ›", back
arrow returns. Active workspace/repo (+ switch), files changed this session,
and the desktop-deferral queue (the only persistent list; outbound, not an
inbox). DECISION DEFERRED: may be cut if the conversation surface suffices —
build Session first, add this only if its absence is felt.

**Diff detail.** Tapping an edit card opens one file's diff; Revert / Keep.
The "when stopped" surface — detail allowed here, nowhere else.

## 4. Demo (one evolving task: harden the signup feature)

1. **Autonomy.** "Add a doc comment to the signup function." → auto-applies →
   "Done, added to signup.kt." No interruption.
2. **Choice (hero).** "Make the input validation more robust." → agent asks:
   empty-checks / email+password / full → user says "email and password" →
   applies → summarizes.
3. **Confirmation (risk).** "Remove the old validation helper." → deletes +
   updates an import → HIGH risk → "confirm?" → "yes" → done.
4. **Defer + override.** "Refactor signup to the new pattern everywhere." →
   TOO_BIG → recommends defer → user can say "approve anyway" (override) or
   "defer". Shows the judgment about voice's limits.
5. **Undo.** "Undo that." → reverts the last applied edit.

Each turn passes through Intent Confirmation on the way in.

## 5. Architecture & abstractions (the scored part)

```
[Android client]                       [Thin harness server — Node/TS, stateless]
 VoiceSession (STT/TTS adapter)          POST /turn {workspaceId, instruction, history[]}
   → AgentClient.sendTurn() ──HTTP/SSE──►   AgentRunner loop on Workspace → SSE events
   ◄──── Flow<AgentEvent> ───────────────   GET  /workspaces   (registry)
 ViewModel → UiState → Compose            POST /undo          {workspaceId}
```

```
[Android client]                       [Thin harness server — Node/TS, stateless]
 VoiceSession ──audio──────────────────►  POST /stt   {audio}        → {text}
 (no API key on client)                   POST /turn  {instruction,history[]} → SSE
 AgentClient.sendTurn() ──HTTP/SSE──────►  POST /tts   {text}         → {audio}
 ViewModel → UiState → Compose            GET  /workspaces  (registry)
                                          POST /undo  {workspaceId}
```

### REST API (5 endpoints, all OpenAI calls server-side, client holds no key)

The OpenAI API key lives ONLY in the server env. The client never holds a
credential — so voice (STT/TTS) is proxied through the server too. The client
talks only to this server.

**`GET /workspaces`** → the hardcoded registry.
```
→ { "workspaces": [ { "id":"signup-app", "name":"signup-app", "path":"/abs/path" }, ... ] }
```

**`POST /stt`** → transcribe speech (voice in). Server calls OpenAI Whisper.
```
body: multipart/form-data { audio: <clip> }     (or base64 in JSON)
→ { "text": "add input validation to the signup function" }
```
The client shows this text as the Intent Confirmation step (run / edit /
cancel) BEFORE calling /turn — the STT safety net. /turn stays text-based
because the transcript must exist and be confirmed on the client first.

**`POST /turn`** → SSE stream of AgentEvents. The only endpoint that runs the agent.
```
body: { "workspaceId":"signup-app",
        "instruction":"add validation to signup",
        "history":[ {"role":"user","text":"..."}, {"role":"agent","text":"..."} ] }  // history optional
→ 200 text/event-stream, one AgentEvent per `data:` line until Done|Error
```

**`POST /tts`** → synthesize the agent's spoken summary (voice out). Server calls OpenAI TTS.
```
body: { "text": "Done — added email and password checks to signup.kt, 8 lines." }
→ audio bytes (audio/mpeg)   // client plays it
```

**`POST /undo`** → revert the last applied edit (deterministic, no LLM, no stream).
```
body: { "workspaceId":"signup-app" }
→ { "reverted": true, "path": "signup.kt", "summary": "Restored signup.kt" }
```

**One turn, end to end:**
```
speak → POST /stt {audio} → {text}
      → client shows "I heard: …" → run/edit/cancel        (Intent Confirmation)
      → POST /turn {instruction:text, history} → SSE AgentEvents (working/decision/applied)
      → POST /tts {summary text} → audio → client plays      (spoken summary)
```

**Stateless turns (core principle).** The server holds NO state between
requests. The client owns the conversation and sends recent `history` (cap a
few turns) on each `/turn`; the server forwards it into the OpenAI messages
array. A decision answer (choice / approve / reject / defer) is simply the
NEXT `/turn` whose `instruction` is the answer and whose `history` carries the
prior exchange — so there is no separate decision endpoint. The only
cross-request state is a tiny in-memory `workspaceId → lastEditRecord` map for
`/undo` (lost on restart; production would persist it). /stt and /tts are
pure pass-throughs to OpenAI; they hold no state either.

**No endpoint for these — they fall out of the stream or live on the client:**
- The "working" checklist, intent echo, decisions, and diffs are all
  `AgentEvent`s within the `/turn` SSE stream. The client renders the stream
  as it arrives; there is no `/working`, `/decision`, or `/diff` endpoint.
- Task history (home screen) is client-side — the client's accumulated past
  turns this session. The listening waveform is local mic level. The server
  serves neither and stays stateless. (Production would persist history
  server-side; out of scope.)
- `history` sent on `/turn` is SUMMARIZED conversational turns (e.g. "asked
  which validation approach", "applied email+password to signup.kt"), mapped
  to OpenAI messages (user→user, agent→assistant). Do NOT stuff the raw event
  stream or full tool transcript into history. Cap to the last few turns.

**Build order / fallback.** Build text-first: /workspaces → /turn (fake events)
→ /turn (real agent) → /undo, all testable by curl with NO audio. Add /stt and
/tts last (the voice slice). If time-pressured, voice may be done client-side
with a key in the app as a fallback — but the designed, secure architecture is
proxied STT/TTS with the key server-only. State that tradeoff explicitly.

## 5a. API reference — request/response examples (build to match these)

All errors share one shape: `{ "error": { "code": "...", "message": "..." } }`
with an appropriate HTTP status. Success bodies are shown per endpoint.

---

### GET /workspaces

```
GET /workspaces
→ 200
{ "workspaces": [
    { "id":"signup-app",  "name":"signup-app",  "path":"/Users/ivy/demo/signup-app" },
    { "id":"backend-api", "name":"backend-api", "path":"/Users/ivy/demo/backend-api" }
] }
```

---

### POST /stt   (voice in → text; calls OpenAI Whisper)

```
POST /stt        Content-Type: multipart/form-data   (audio file field "audio")
→ 200
{ "text": "add input validation to the signup function" }

# empty / unintelligible audio
→ 200  { "text": "" }            # client treats empty as "didn't catch that", re-prompts

# bad/missing audio
→ 400  { "error": { "code":"bad_audio", "message":"missing or unreadable audio" } }

# OpenAI failure
→ 502  { "error": { "code":"stt_failed", "message":"transcription service error" } }
```

---

### POST /turn   (the agent; SSE stream of AgentEvents)

Request:
```
POST /turn       Content-Type: application/json
{ "workspaceId":"signup-app",
  "instruction":"add input validation to the signup function",
  "history":[ {"role":"user","text":"..."}, {"role":"agent","text":"..."} ] }   # history optional
```
Response: `200, Content-Type: text/event-stream`. One AgentEvent per `data:`
line, in order, terminating in exactly one `Done` OR one `Error`.

**Case A — low risk, auto-applied (no decision):**
```
data: {"type":"IntentProposed","text":"Add input validation to signup"}
data: {"type":"Thinking","label":"Reading workspace"}
data: {"type":"ToolCall","kind":"read_file","target":"signup.kt"}
data: {"type":"Thinking","label":"Planning changes"}
data: {"type":"FileEdit","path":"signup.kt","diff":"@@ ...","added":8,"removed":0}
data: {"type":"Applied","summary":"Added email and password checks to signup.kt, 8 lines"}
data: {"type":"Done"}
```

**Case B — needs a choice (agent pauses, stream ENDS on the decision):**
```
data: {"type":"IntentProposed","text":"Make signup validation more robust"}
data: {"type":"Thinking","label":"Reading workspace"}
data: {"type":"ToolCall","kind":"read_file","target":"signup.kt"}
data: {"type":"DecisionRequest","decision":{
         "kind":"choice",
         "question":"How thorough should validation be?",
         "options":[
           {"id":"empty","label":"Empty checks only"},
           {"id":"rules","label":"Email + password rules"},
           {"id":"full","label":"Full validation"} ],
         "recommendedOptionId":"rules" }}
data: {"type":"Done"}
```
The client renders the choice, the user answers by voice, and that answer is a
NEW `/turn` whose `instruction` is e.g. "email and password rules" and whose
`history` includes this question. (Stateless — no decision endpoint.)

**Case C — high risk / too big (confirmation with risk + recommendation):**
```
data: {"type":"IntentProposed","text":"Refactor signup to the new pattern"}
data: {"type":"Thinking","label":"Planning changes"}
data: {"type":"DecisionRequest","decision":{
         "kind":"confirmation",
         "summary":"Refactor touches 4 files including a delete",
         "risk":"TOO_BIG_FOR_VOICE",
         "files":4, "added":38, "removed":12,
         "recommendedAction":"defer",
         "actions":["approve","reject","defer"] }}
data: {"type":"Done"}
```
The follow-up `/turn` carries the chosen action as the instruction
(e.g. "approve anyway" / "defer"). On approve, that turn streams the
FileEdits + Applied; on defer, it streams `Deferred`.

**Case D — deferred result (after user said defer):**
```
data: {"type":"Deferred","summary":"Queued 'refactor signup' for desktop review (4 files)"}
data: {"type":"Done"}
```

**Case E — agent error mid-turn (terminates on Error, not Done):**
```
data: {"type":"IntentProposed","text":"Edit the login flow"}
data: {"type":"ToolCall","kind":"read_file","target":"login.kt"}
data: {"type":"Error","reason":"file not found: login.kt"}
```

**Request errors (no stream opened):**
```
unknown workspaceId   → 404 { "error":{"code":"no_workspace","message":"unknown workspaceId"} }
missing instruction   → 400 { "error":{"code":"bad_request","message":"instruction required"} }
OpenAI failure        → emitted in-stream as {"type":"Error","reason":"agent service error"}
```

---

### POST /tts   (text → spoken audio; calls OpenAI TTS)

```
POST /tts        Content-Type: application/json
{ "text":"Done — added email and password checks to signup.kt, 8 lines." }
→ 200  Content-Type: audio/mpeg   (raw audio bytes; client plays them)

empty text   → 400 { "error":{"code":"bad_request","message":"text required"} }
OpenAI fail  → 502 { "error":{"code":"tts_failed","message":"speech service error"} }
```

---

### POST /undo   (revert last applied edit; deterministic, no LLM, no stream)

```
POST /undo       Content-Type: application/json
{ "workspaceId":"signup-app" }
→ 200  { "reverted":true, "path":"signup.kt", "summary":"Restored signup.kt" }

# nothing to undo
→ 200  { "reverted":false, "summary":"No recent edit to undo" }

unknown workspaceId → 404 { "error":{"code":"no_workspace","message":"unknown workspaceId"} }
```

---

## 5b. AgentEvent protocol (the client↔server contract)

Every `/turn` emits a stream of these events, one per SSE `data:` line, as
JSON objects with a `"type"` field. This is the single shared vocabulary —
the server EMITS these, the client PARSES these, and both must use the exact
field names below. Language-neutral on purpose: server (TS) and client
(Kotlin) each implement the same shapes.

**Stream invariant:** every turn ends with exactly one `Done` or one `Error`.
A `DecisionRequest` is immediately followed by `Done` (the turn pauses; the
user's answer arrives as a NEW `/turn`).

### The events

| type | fields | when the agent emits it | what the client does |
|------|--------|-------------------------|----------------------|
| `IntentProposed` | `text` | first, restating the understood instruction | (already shown at Intent Confirmation; may echo in transcript) |
| `Thinking` | `label` | entering a phase of work | add/checkmark a row in the "Working…" checklist (e.g. "Reading workspace", "Planning changes") |
| `ToolCall` | `kind`, `target` | calling a tool on the workspace | show a checklist row (e.g. "Found signup.kt"). `kind` ∈ `read_file` \| `list_dir` \| `write_file`; `target` is the path |
| `FileEdit` | `path`, `diff`, `added`, `removed` | after writing a file | record the change; show an edit card (file + `+added −removed`); `diff` is a unified-diff string for the diff view |
| `DecisionRequest` | `decision` | agent needs a human decision; then the turn pauses | render the decision bottom sheet (see two variants below); listen for a voice answer |
| `Applied` | `summary` | a change was applied (low-risk auto, or after approve) | speak `summary`; mark the task applied in history |
| `Deferred` | `summary` | user chose defer (or agent deferred a too-big change) | speak `summary`; add to the desktop-deferral list |
| `Error` | `reason` | the turn failed | speak a short error; offer retry; terminate the turn |
| `Done` | — | the turn is complete (terminal) | return to listening |

### DecisionRequest — two variants

`decision` is one of:

**Choice** — pick one of N options by voice (the hero interaction).
```
{ "kind":"choice",
  "question":"How thorough should validation be?",
  "options":[ {"id":"empty","label":"Empty checks only"},
              {"id":"rules","label":"Email + password rules"},
              {"id":"full","label":"Full validation"} ],
  "recommendedOptionId":"rules" }
```
Client: render the question + option cards (mark the recommended one), listen
for the spoken choice. The answer becomes a new `/turn` whose `instruction` is
the chosen label/id, with this question in `history`.

**Confirmation** — approve / reject / defer, recommendation scaled to risk.
```
{ "kind":"confirmation",
  "summary":"Refactor touches 4 files including a delete",
  "risk":"TOO_BIG_FOR_VOICE",          // LOW | HIGH | TOO_BIG_FOR_VOICE
  "files":4, "added":38, "removed":12,
  "recommendedAction":"defer",         // approve | reject | defer
  "actions":["approve","reject","defer"] }
```
Client: render the summary + risk pill + the three action buttons (highlight
`recommendedAction`), listen for "approve" / "reject" / "defer". The answer
becomes a new `/turn` whose `instruction` is the chosen action.

### Risk levels (set by the server's RiskClassifier, deterministic)
- `LOW` — single file, additive, no deletes → usually auto-applied, no DecisionRequest.
- `HIGH` — deletes or multi-file → Confirmation, recommendedAction `approve` (proceed with care).
- `TOO_BIG_FOR_VOICE` — > ~30 lines or > 3 files → Confirmation, recommendedAction `defer`.

### Notes for both implementers
- All events are flat JSON with a `type` discriminator. No nesting except
  `DecisionRequest.decision`.
- Field names are exact and case-sensitive (`added`/`removed`, not
  `addedLines`). Don't rename.
- The client renders the "Working…" checklist purely from `Thinking` +
  `ToolCall` events as they stream — it is not separate data.
- `IntentProposed` is informational; the actual intent confirmation happened
  client-side before `/turn` (from `/stt` text). It's fine to ignore in UI.



**Client interfaces (own these):**
- `VoiceSession` — `events: Flow<VoiceEvent>` (PartialTranscript, FinalTranscript,
  AgentSpeaking, AgentDoneSpeaking, Error); `startListening/stopListening/interrupt/close`.
  Two impls: `PipelineVoiceSession` (STT→LLM→TTS, primary — more seams, easier
  to debug) and `RealtimeVoiceSession` (OpenAI Realtime, stretch behind the seam).
  Also enables the non-voice handoff: a text adapter is a third impl.
- `AgentClient` — `sendTurn(workspaceId, instruction, history): Flow<AgentEvent>`.
  Impls: `FakeAgentClient` (scripted events, slice 1) → `HarnessAgentClient`
  (real server). The client owns and supplies `history`.
- `AgentEvent` (the streaming protocol — the most important abstraction):
  `IntentProposed(text)`, `Thinking(label)`, `ToolCall(kind, target)`,
  `FileEdit(path, diff, addedLines, removedLines)`,
  `DecisionRequest(Confirmation | Choice)`, `Applied(summary)`,
  `Deferred(summary)`, `Error(reason)`, `Done`.

**Server abstractions:**
- `Workspace` — the files the agent edits. Registry of `{id, name, path}`;
  today hardcoded local dirs (brief allows). Production: clone/remote VM, same
  interface. `workspaceId` rides every turn.
- `AgentRunner` — the loop: OpenAI model + tools (read_file, list_dir,
  write_file, run_command?) against a `Workspace`; emits the event stream.
  You build the harness (~100–150 lines), not the model.
- `RiskClassifier` — deterministic policy over a proposed edit →
  LOW / HIGH / TOO_BIG_FOR_VOICE. Crude on purpose (a predictable rule gating
  a probabilistic agent). Thresholds: LOW = single file, additive, no deletes;
  HIGH = deletes or multi-file; TOO_BIG = > ~30 lines or > 3 files.
- `EditRecord { path, before, after }` — every applied edit stores its inverse
  so undo = rewrite `before`. Design reversibility in from the start.

**Why it's production-shaped:** swap `PipelineVoiceSession`→`RealtimeVoiceSession`,
`FakeAgentClient`→`HarnessAgentClient`, local-dir `Workspace`→cloned-repo
`Workspace` — each is one binding change. The `AgentEvent` protocol is the
stable contract between client and server.

## 6. Slices (protocol-first walking skeleton)

**Slice 1 — Protocol + faked end-to-end.** Define `AgentEvent`, `AgentClient`,
`DecisionRequest`. Write `FakeAgentClient` emitting a scripted turn (intent →
thinking → file edit → choice → applied → done). Build the Session screen
(orb, listening UI, intent confirmation, working checklist, decision sheet,
done) driven entirely by the fake. **End state: the whole UX demoable with no
server, no OpenAI, no voice.** Tests: UiState transitions for each event;
DecisionRequest rendering; risk-gated branch selection.

**Slice 2 — Harness server (stateless).** Node/TS server. Build text-first:
`GET /workspaces` (registry), `POST /turn` (SSE; `{workspaceId, instruction,
history[]}`), `POST /undo`. `AgentRunner` wraps OpenAI with file tools
(read_file, list_dir, write_file) against a hardcoded `Workspace`;
`RiskClassifier`; `EditRecord` with in-memory last-edit map for undo.
Decisions are follow-up `/turn`s with history — no decision endpoint. Swap
`FakeAgentClient` → `HarnessAgentClient`. Real files change. The voice
proxy endpoints `POST /stt` and `POST /tts` come in the voice slice (5), not
here. Tests (server): tool loop applies edits; RiskClassifier thresholds;
EditRecord inverse + undo restores; Workspace path confinement. Manual: `curl`
/workspaces, a text /turn watching SSE, then /undo.

**Slice 3 — Voice layer.** `VoiceSession` interface; `PipelineVoiceSession`
(OpenAI STT → instruction; agent summary → TTS playback). Wire mic capture +
audio playback. Try `RealtimeVoiceSession` behind the same interface if time
allows. Tests: VoiceEvent → UiState mapping; transcript echo before run.

**Slice 4 — Decisions + risk demo.** Make all five demo beats real: choice,
confirmation, defer+override, undo. Polish the decision sheet and spoken
summaries. Manual: full demo rehearsal, all five beats.

**Slice 5 — Polish + resilience.** Harness-connection status (real), error
states (STT failure, agent error, harness unreachable — spoken + visible),
interrupt/barge-in, Workspace screen IF wanted. Backup screen recording.

## 7. Cut list (in order)
1. Workspace screen  2. RealtimeVoiceSession (pipeline suffices)
3. repo switcher  4. barge-in/interrupt  5. run_command tool (edits only)

## 8. Deferred intentionally (brief non-requirements)
Auth, GitHub/git integration, remote VMs, workspace creation/cloning,
multi-session history. Workspaces are pre-registered on the server; the client
selects, never creates.

## 9. Demo-day setup
- Pre-stage a small sample workspace with a `signup` file (bare function) so
  beats 1–5 have real targets. Add an obvious refactor target for beat 4.
- `adb reverse tcp:8080 tcp:8080` so the phone reaches the laptop harness via
  localhost — test before the day; #1 demo risk.
- Record a backup run at ~hour 4.