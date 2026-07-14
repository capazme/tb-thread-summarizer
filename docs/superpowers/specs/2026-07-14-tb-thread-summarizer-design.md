# Design Spec — Thread Summarizer for Thunderbird (Ollama)

**Date:** 2026-07-14
**Status:** Design approved in brainstorming; pending final spec review
**Target:** Thunderbird >= 128 ESR (developed on 152), macOS; local Ollama >= 0.31

## 1. Purpose

A small MailExtension that summarizes the email thread of the currently
displayed message using a local Ollama model. All email content stays on the
user's machine — the only network host contacted is the local Ollama endpoint.
Primary user: a lawyer triaging long work threads, where confidentiality of
client correspondence rules out cloud LLMs.

## 2. Goals and non-goals

**Goals (v1):**

- One-click summary of the displayed message's thread via a toolbar button
  on the message header (`message_display_action`) with a popup panel.
- Structured triage output, always in Italian: TL;DR (2-3 sentences), key
  points, actions & deadlines, "waiting on a reply from you".
- Streaming display of the summary as it is generated.
- Session-scoped cache: reopening the same thread returns the stored summary
  instantly; cache is cleared when Thunderbird quits (nothing written to disk).
- Model picker populated from the models actually installed in Ollama.
- Specific, actionable error messages for every known failure mode.

**Non-goals (v1), explicitly out of scope:**

- Reply drafting or any compose integration.
- Summarizing attachment content.
- Batch or multi-folder summaries; context-menu or message-list triggers.
- Output languages other than Italian.
- Manifest V2 support.
- Persisting summaries to disk.

## 3. Architecture

Manifest V3 MailExtension, plain JavaScript, no external runtime libraries,
no build step (Vitest is a dev-only dependency for unit tests). Background script orchestrates; the popup is a thin viewer (approach B:
generation survives popup close; popups close on any outside click and local
generation takes 20-60 s, so popup-driven generation was rejected).

Project layout:

```
tb-thread-summarizer/
├── manifest.json
├── background.js          # orchestrator: ThreadBuilder, ContentExtractor,
│                          # OllamaClient, SummaryManager
├── popup/
│   ├── popup.html
│   ├── popup.js           # viewer: port connection, streaming render, states
│   └── popup.css
├── options/
│   ├── options.html
│   └── options.js
├── icons/
└── docs/superpowers/specs/
```

### 3.1 manifest.json

- `manifest_version: 3`, `browser_specific_settings.gecko.strict_min_version: "128.0"`.
- `message_display_action` with `default_popup`.
- `permissions`: `["messagesRead", "storage"]`.
- `host_permissions`: `["http://localhost:11434/*", "http://127.0.0.1:11434/*"]`.
- `background`: event page (`scripts` array, non-persistent).

Note: Gecko MV3 may treat host permissions as user-grantable rather than
granted at install. If the Ollama fetch fails for a missing grant, the popup
calls `permissions.request()` from the button click (user gesture) — covered
in the error flow.

### 3.2 background.js modules

**ThreadBuilder** — displayed message → ordered thread.

1. `messageDisplay.getDisplayedMessages(tabId)` → current message.
2. `messages.getFull()` → collect Message-IDs from `References` and
   `In-Reply-To` raw headers.
3. `messages.query({headerMessageId})` for each referenced ID to fetch
   ancestors. Thunderbird exposes no native thread/conversation API, so the
   chain is reconstructed manually.
4. Descendants and siblings are not reachable via `References` of the current
   message; fallback heuristic: `messages.query` by normalized subject
   (strip `Re:`, `Fwd:`, `R:`, `I:` prefixes, case-insensitive) within the
   same account, +/- 90 days around the thread's date range.
5. Dedup by `headerMessageId`, sort by date ascending, keep the most recent
   `maxMessages` (default 30).

**ContentExtractor** — `MessagePart` → clean text per message.

- Prefer `text/plain` part; otherwise strip tags from `text/html`.
- Drop quoted lines (starting with `>`) and signature blocks (from a `-- `
  line onward); collapse whitespace.
- Emit `[i/N] From — Date:` header line followed by the cleaned body.

**OllamaClient**

- `POST /api/chat` with `{model, messages, stream: true, options: {num_ctx: 8192}}`;
  parse NDJSON stream chunks; `AbortController` for cancellation; 120 s timeout.
- `GET /api/tags` → installed models (options dropdown, "Test connection").
- `GET /api/version` → health check.

**SummaryManager** — state machine per `threadKey` (hash of the sorted set of
`headerMessageId`s): `idle → building → generating → done | error | cancelled`.
Partial text and finished summaries live in `storage.session` (cleared on
Thunderbird quit). Explicit Cancel aborts generation; closing the popup does not.

### 3.3 popup/

Viewer only. Opens a `runtime.connect` port, sends `{command: "summarize", tabId}`,
receives `phase` / `chunk` / `done` / `error` events. Renders the four triage
sections with minimal markdown (bold headings + bullets). Buttons: Regenerate
(bypasses cache), Copy, Cancel, Options shortcut. Phases shown while waiting:
"Ricostruzione thread… N messaggi", "Generazione…".

### 3.4 options/

Settings in `storage.local` (none of it is sensitive): `endpointUrl`
(default `http://localhost:11434`), `model` (dropdown from `/api/tags`,
default: first installed model matching `gemma3*`), `maxMessages` (default 30).
`num_ctx` is fixed at 8192 in v1 (not exposed). An "Ollama setup" section shows
the macOS one-time command
`launchctl setenv OLLAMA_ORIGINS "moz-extension://*"` (then restart Ollama)
and a "Test connection" button.

## 4. Prompt (fixed in v1)

- **System:** the model is an assistant summarizing email threads for an
  Italian lawyer. Output ONLY Italian, exactly these markdown sections:
  `**Sintesi**` (2-3 sentences), `**Punti chiave**` (bullets),
  `**Azioni e scadenze**` (bullets, keep dates exactly as they appear),
  `**In attesa di una tua risposta**` (omit the section if nothing is pending).
  No invented facts; if the thread is truncated, say so.
- **User:** the thread rendered chronologically by ContentExtractor.
- **Context budget:** ~4 chars/token ⇒ ~28,000 chars of thread text reserved
  against `num_ctx` 8192 (leaving room for system prompt and output). If over
  budget, drop the oldest messages first and prepend
  `(riassunto basato sugli ultimi N messaggi)` to the output.

## 5. Error handling

Every error state renders in the popup with a suggested action:

| Case | Detection | Message / action |
|---|---|---|
| Ollama not running | fetch network error | "Ollama non è in esecuzione" + Riprova |
| CORS rejected | HTTP 403 | Show `OLLAMA_ORIGINS` fix with copyable macOS command |
| Model missing | HTTP 404 / error body | Suggest `ollama pull <model>` or change model in options |
| Host permission not granted | fetch permission error | `permissions.request()` from user gesture, then retry |
| Partial thread | fewer messages resolved than referenced | Summary still produced + note "basato su N messaggi trovati" |
| Over context budget | char budget exceeded | Truncate oldest + explicit note in output |
| Timeout (120 s) / Cancel | AbortController | Cancelled state + Regenerate button |

## 6. Testing

- **Unit tests (Vitest, pure functions only — no Thunderbird APIs):**
  ThreadBuilder ordering/dedup/subject normalization on header fixtures;
  ContentExtractor (HTML stripping, quote and signature removal); NDJSON
  stream parser; context-budget truncation.
- **Manual checklist on a real account:** threads of 2 / 10 / 50 messages;
  HTML-only messages; Ollama stopped; 403 CORS; missing model; popup closed
  mid-generation and reopened; Regenerate; cache hit on reopen.
- **Load path:** Thunderbird Add-ons Manager → "Install Add-on From File"
  (zip), or temporary loading via debugging for development.

## 7. Known risks and mitigations

1. **MV3 event-page suspension** mid-stream after the popup is closed: partial
   state is saved to `storage.session`; on wake the state shows "interrupted"
   with one-click Regenerate. If this proves blocking in practice, fallback is
   a persistent background page (one manifest line, acceptable for v1).
2. **Thread reconstruction gaps**: opening an old message finds ancestors only
   via `References`; the subject heuristic recovers descendants. The UI always
   states how many messages the summary is based on.
3. **Small local models** (gemma3 4B / Velvet 2B) may summarize weakly on very
   long threads: structured prompt + truncation mitigate; model is configurable
   and the user can pull a stronger one.

## 8. Success criteria

- A ~20-message thread yields a useful, correctly structured Italian summary
  in under 60 s with `gemma3` on the development machine.
- The only network host contacted is the configured Ollama endpoint
  (verifiable from the extension's network activity).
- Closing and reopening the popup during generation loses no work.

## 9. Decision log

- **UX:** message-header button + popup panel (over banner injection and
  context-menu trigger) — simplest native path, no message DOM tampering.
- **Approach B:** background orchestrator + popup viewer (over popup-only and
  dedicated window) — survives popup close, enables session cache.
- **MV3 over MV2:** officially stable since Thunderbird 128; official examples
  are MV3. ThunderAI's MV2 noted as legacy practice, not a blocker.
- **Summaries always in Italian** (v1); model and endpoint configurable.
- **No disk persistence of summaries** — deliberate confidentiality choice.
- **No external runtime dependencies, no build step** — the extension stays auditable
  and maintainable by a non-developer with AI assistance.
