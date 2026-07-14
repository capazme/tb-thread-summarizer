# Thread Summarizer (Ollama) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Thunderbird MV3 MailExtension that summarizes the displayed email thread via local Ollama, streaming a structured Italian triage summary into a popup panel.

**Architecture:** Background event page orchestrates (thread reconstruction → content extraction → prompt → streaming Ollama call → session cache); the popup is a thin viewer connected over a runtime port, so generation survives popup close. All logic lives in small ES modules under `lib/`, unit-tested with Vitest; Thunderbird APIs and `fetch` are injected so tests never touch the real environment.

**Tech Stack:** Plain JavaScript (ES modules), Thunderbird MailExtension APIs (MV3), Ollama HTTP API, Vitest (dev-only).

**Spec:** `docs/superpowers/specs/2026-07-14-tb-thread-summarizer-design.md` — read it before starting.

## Global Constraints

- Thunderbird >= 128: `browser_specific_settings.gecko.strict_min_version: "128.0"`, `manifest_version: 3`.
- No external **runtime** dependencies; no build step. Vitest is the only devDependency.
- Only network host ever contacted: the configured Ollama endpoint (default `http://localhost:11434`).
- Summaries are **always in Italian**; UI copy in Italian; code, comments, commits, docs in English.
- Summaries never persist to disk: cache in `storage.session` only. Settings in `storage.local`.
- `num_ctx` fixed at 8192; thread char budget 28000; Ollama timeout 120000 ms; default `maxMessages` 30.
- Commits: Conventional Commits, one per task, exactly as written in each task's final step.
- In extension code use the `messenger.*` namespace (Thunderbird's alias of `browser.*`).

## File Map (who owns what)

| Path | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest: `message_display_action`, permissions, host permissions |
| `background.js` | Wiring only: port protocol, orchestration, settings, session persistence |
| `lib/ndjson.js` | NDJSON stream parser (pure) |
| `lib/content-extractor.js` | MessagePart → clean text (pure) |
| `lib/thread-builder.js` | Displayed message → ordered thread (messenger API injected) |
| `lib/prompt.js` | System prompt + chat messages with truncation budget (pure) |
| `lib/ollama-client.js` | Ollama HTTP client with typed errors (fetch injected) |
| `lib/summary-manager.js` | Job registry, event fan-out, session cache (storage injected) |
| `lib/settings.js` | Defaults, merge, default-model pick (pure) |
| `lib/markdown-lite.js` | Escape + render triage markdown to safe HTML (pure) |
| `popup/popup.html` `.js` `.css` | Viewer: states, streaming render, error actions |
| `options/options.html` `.js` | Settings page + Ollama setup help + connection test |
| `tests/*.test.js` | Vitest unit tests, one file per lib module |
| `scripts/package.sh` | Zip the extension into `dist/` |
| `docs/manual-test-checklist.md` | Manual E2E checklist (from spec §6) |

## Shared contracts (used across tasks — exact shapes)

**Port protocol** (port name `"summary"`):
- popup → background: `{command:'summarize', tabId:number, force?:boolean}` · `{command:'cancel'}`
- background → popup events:
  - `{type:'phase', phase:'building'}`
  - `{type:'phase', phase:'generating', messageCount:number, totalFound:number}`
  - `{type:'chunk', text:string}`
  - `{type:'done', summary:string, meta:Meta}`
  - `{type:'error', code:ErrorCode, detail:string}`
  - `{type:'cancelled'}`
  - `{type:'interrupted', partial:string}`
- `Meta = {usedCount:number, totalFound:number, truncatedCount:number, model:string, cached:boolean, generatedAt:string}`
- `ErrorCode = 'unreachable'|'cors'|'model_missing'|'permission'|'timeout'|'cancelled'|'no_message'|'unknown'`

**Settings** (`storage.local`, key `settings`): `{endpointUrl:'http://localhost:11434', model:'', maxMessages:30}` — empty `model` means auto-pick (first `gemma3*`, else first installed).

**Session cache** (`storage.session`, key `summary:<threadKey>`): `{summary, meta, savedAt}` for finished summaries, or `{status:'interrupted', partial, savedAt}` for interrupted ones.

---

### Task 1: Scaffold — repo tooling, manifest, empty shells

**Files:**
- Create: `package.json`, `.gitignore`, `manifest.json`, `background.js`, `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `options/options.html`, `options/options.js`, `icons/icon.svg`

**Interfaces:**
- Consumes: nothing.
- Produces: valid manifest + npm test runner every later task relies on. `manifest.json` declares `background.js` as a module event page, popup at `popup/popup.html`, options at `options/options.html`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "tb-thread-summarizer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "package": "bash scripts/package.sh"
  },
  "devDependencies": {
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
.DS_Store
```

- [ ] **Step 3: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Thread Summarizer (Ollama)",
  "version": "0.1.0",
  "description": "Riassume il thread del messaggio visualizzato con un modello Ollama locale. Nessun dato lascia il tuo computer.",
  "browser_specific_settings": {
    "gecko": {
      "id": "tb-thread-summarizer@puzio.dev",
      "strict_min_version": "128.0"
    }
  },
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  },
  "message_display_action": {
    "default_popup": "popup/popup.html",
    "default_title": "Riassumi thread",
    "default_icon": "icons/icon.svg"
  },
  "options_ui": {
    "page": "options/options.html"
  },
  "icons": { "64": "icons/icon.svg" },
  "permissions": ["messagesRead", "storage"],
  "host_permissions": [
    "http://localhost:11434/*",
    "http://127.0.0.1:11434/*"
  ]
}
```

- [ ] **Step 4: Write `icons/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="6" y="10" width="52" height="38" rx="6" fill="#1d4ed8"/>
  <path d="M6 16l26 18 26-18" stroke="#ffffff" stroke-width="4" fill="none" stroke-linecap="round"/>
  <rect x="30" y="38" width="30" height="20" rx="4" fill="#f59e0b"/>
  <rect x="35" y="44" width="20" height="3" rx="1.5" fill="#ffffff"/>
  <rect x="35" y="50" width="14" height="3" rx="1.5" fill="#ffffff"/>
</svg>
```

- [ ] **Step 5: Write placeholder shells (overwritten by later tasks)**

`background.js`:

```js
// Wiring is added in Task 8.
console.log('[tb-thread-summarizer] background loaded');
```

`popup/popup.html`:

```html
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="root">Caricamento…</div>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

`popup/popup.js`:

```js
// Implemented in Task 9.
```

`popup/popup.css`:

```css
/* Implemented in Task 9. */
```

`options/options.html`:

```html
<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"></head>
<body>
  <div id="root">Opzioni — implementate nel Task 10.</div>
  <script type="module" src="options.js"></script>
</body>
</html>
```

`options/options.js`:

```js
// Implemented in Task 10.
```

- [ ] **Step 6: Install and verify**

Run: `npm install`
Expected: vitest installed, no errors.

Run: `npm test`
Expected: exits 0 with "No test files found" (passWithNoTests).

Run: `python3 -m json.tool manifest.json > /dev/null && echo MANIFEST_OK`
Expected: `MANIFEST_OK`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold MV3 extension skeleton with vitest tooling"
```

---

### Task 2: NDJSON stream parser (`lib/ndjson.js`)

**Files:**
- Create: `lib/ndjson.js`
- Test: `tests/ndjson.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createNdjsonParser(onObject: (obj) => void) → {push(text: string): void, flush(): void}`. Task 6 (OllamaClient) feeds it decoded stream chunks; malformed JSON must throw out of `push`/`flush` (caller maps it).

- [ ] **Step 1: Write the failing test (`tests/ndjson.test.js`)**

```js
import { describe, it, expect, vi } from 'vitest';
import { createNdjsonParser } from '../lib/ndjson.js';

describe('createNdjsonParser', () => {
  it('parses complete lines in a single chunk', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('{"a":1}\n{"b":2}\n');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reassembles objects split across chunks', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('{"message":{"con');
    p.push('tent":"ciao"}}\n');
    expect(seen).toEqual([{ message: { content: 'ciao' } }]);
  });

  it('skips empty lines', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('\n\n{"a":1}\n\n');
    expect(seen).toEqual([{ a: 1 }]);
  });

  it('flush parses a trailing line without newline, and is safe on empty buffer', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('{"done":true}');
    p.flush();
    p.flush();
    expect(seen).toEqual([{ done: true }]);
  });

  it('throws on malformed JSON lines', () => {
    const p = createNdjsonParser(vi.fn());
    expect(() => p.push('not json\n')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ndjson.test.js`
Expected: FAIL — cannot resolve `../lib/ndjson.js`.

- [ ] **Step 3: Write minimal implementation (`lib/ndjson.js`)**

```js
export function createNdjsonParser(onObject) {
  let buffer = '';

  function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    onObject(JSON.parse(trimmed));
  }

  return {
    push(text) {
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        processLine(line);
      }
    },
    flush() {
      const rest = buffer;
      buffer = '';
      processLine(rest);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ndjson.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ndjson.js tests/ndjson.test.js
git commit -m "feat: add NDJSON stream parser"
```

---

### Task 3: Content extractor (`lib/content-extractor.js`)

**Files:**
- Create: `lib/content-extractor.js`
- Test: `tests/content-extractor.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 8):
  - `extractMessageText(fullPart) → string` — `fullPart` is a Thunderbird `MessagePart` (`{contentType, body, parts}` recursive).
  - `stripHtml(html) → string`
  - `cleanBody(text) → string`
  - `renderMessage(index:number, total:number, author:string, dateIso:string, text:string) → string`

- [ ] **Step 1: Write the failing test (`tests/content-extractor.test.js`)**

```js
import { describe, it, expect } from 'vitest';
import { extractMessageText, stripHtml, cleanBody, renderMessage } from '../lib/content-extractor.js';

describe('extractMessageText', () => {
  it('prefers the text/plain part over html', () => {
    const part = {
      contentType: 'multipart/alternative',
      parts: [
        { contentType: 'text/plain', body: 'testo semplice' },
        { contentType: 'text/html', body: '<p>testo <b>html</b></p>' },
      ],
    };
    expect(extractMessageText(part)).toBe('testo semplice');
  });

  it('falls back to stripped html when no plain part exists', () => {
    const part = {
      contentType: 'multipart/mixed',
      parts: [{ contentType: 'text/html', body: '<p>solo &amp; html</p>' }],
    };
    expect(extractMessageText(part)).toBe('solo & html');
  });

  it('returns empty string when no textual part exists', () => {
    expect(extractMessageText({ contentType: 'application/pdf' })).toBe('');
  });
});

describe('stripHtml', () => {
  it('drops tags, style blocks and decodes basic entities', () => {
    const html = '<style>p{color:red}</style><p>Ciao<br>mondo &egrave;&nbsp;&lt;ok&gt;</p>';
    const out = stripHtml(html);
    expect(out).toContain('Ciao\nmondo');
    expect(out).toContain('<ok>');
    expect(out).not.toContain('color:red');
  });
});

describe('cleanBody', () => {
  it('removes quoted lines and signature block, collapses blank runs', () => {
    const raw = [
      'Buongiorno,',
      '',
      '',
      '',
      'confermo la scadenza del 15 luglio.',
      '> Il giorno 10 luglio Mario ha scritto:',
      '> vecchio testo citato',
      '-- ',
      'Avv. Gianluca Puzio',
    ].join('\r\n');
    expect(cleanBody(raw)).toBe('Buongiorno,\n\nconfermo la scadenza del 15 luglio.');
  });
});

describe('renderMessage', () => {
  it('formats the per-message block', () => {
    expect(renderMessage(2, 5, 'Mario Rossi <m@x.it>', '2026-07-10', 'corpo')).toBe(
      '[2/5] Mario Rossi <m@x.it> — 2026-07-10\ncorpo'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content-extractor.test.js`
Expected: FAIL — cannot resolve `../lib/content-extractor.js`.

- [ ] **Step 3: Write minimal implementation (`lib/content-extractor.js`)**

```js
function findPart(part, contentType) {
  if (!part) return null;
  if ((part.contentType ?? '').toLowerCase().startsWith(contentType)) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, contentType);
    if (found) return found;
  }
  return null;
}

export function extractMessageText(fullPart) {
  const plain = findPart(fullPart, 'text/plain');
  if (plain?.body) return cleanBody(plain.body);
  const html = findPart(fullPart, 'text/html');
  if (html?.body) return cleanBody(stripHtml(html.body));
  return '';
}

export function stripHtml(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&egrave;/gi, 'è')
    .replace(/&agrave;/gi, 'à')
    .replace(/&ugrave;/gi, 'ù')
    .replace(/&ograve;/gi, 'ò')
    .replace(/&igrave;/gi, 'ì')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function cleanBody(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('>')) continue; // quoted reply
    if (line.trim() === '--') break; // signature delimiter ("-- " per RFC 3676)
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderMessage(index, total, author, dateIso, text) {
  return `[${index}/${total}] ${author} — ${dateIso}\n${text}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/content-extractor.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-extractor.js tests/content-extractor.test.js
git commit -m "feat: add message content extractor (plain/html, quotes, signatures)"
```

---

### Task 4: Thread builder (`lib/thread-builder.js`)

**Files:**
- Create: `lib/thread-builder.js`
- Test: `tests/thread-builder.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (Thunderbird `messenger` object is injected).
- Produces (used by Task 8):
  - `normalizeSubject(subject) → string` (lowercased, `Re:/Fw:/Fwd:/R:/I:` prefixes stripped iteratively)
  - `collectReferencedIds(headers) → string[]` (Message-IDs from `references` + `in-reply-to`, no angle brackets, deduped)
  - `buildThread(messenger, currentHeader, {maxMessages=30}) → Promise<{messages: MessageHeader[], totalFound: number}>` — `messages` sorted by date ascending, capped to the most recent `maxMessages`, always containing `currentHeader`.
- Thunderbird facts this task relies on (from the spec): there is NO native thread API; `messages.getFull(id)` returns a `MessagePart` whose `headers` is an object mapping lowercase header names to arrays of strings; `messages.query(queryInfo)` returns a paginated `MessageList` (`{id, messages}`) continued via `messages.continueList(id)`.

- [ ] **Step 1: Write the failing test (`tests/thread-builder.test.js`)**

```js
import { describe, it, expect } from 'vitest';
import { normalizeSubject, collectReferencedIds, buildThread } from '../lib/thread-builder.js';

describe('normalizeSubject', () => {
  it('strips reply/forward prefixes iteratively and lowercases', () => {
    expect(normalizeSubject('Re: RE: Fwd: R: Contratto Alfa')).toBe('contratto alfa');
    expect(normalizeSubject('I: aggiornamento')).toBe('aggiornamento');
    expect(normalizeSubject('Relazione annuale')).toBe('relazione annuale'); // "Re" only as prefix with colon
  });
});

describe('collectReferencedIds', () => {
  it('collects and dedups ids from references and in-reply-to', () => {
    const headers = {
      references: ['<a@x.it> <b@x.it>'],
      'in-reply-to': ['<b@x.it>'],
    };
    expect(collectReferencedIds(headers)).toEqual(['a@x.it', 'b@x.it']);
  });
  it('returns empty array when headers are missing', () => {
    expect(collectReferencedIds({})).toEqual([]);
    expect(collectReferencedIds(undefined)).toEqual([]);
  });
});

// ---- fake messenger ----------------------------------------------------
function makeHeader(id, headerMessageId, subject, dateIso, accountId = 'acc1') {
  return { id, headerMessageId, subject, date: dateIso, author: `a${id}@x.it`, folder: { accountId } };
}

function makeFakeMessenger({ store, fullHeadersById }) {
  return {
    messages: {
      async getFull(id) {
        return { headers: fullHeadersById[id] ?? {} };
      },
      async query(queryInfo) {
        let out = store;
        if (queryInfo.headerMessageId) {
          out = out.filter((h) => h.headerMessageId === queryInfo.headerMessageId);
        }
        if (queryInfo.subject) {
          out = out.filter((h) => h.subject.toLowerCase().includes(queryInfo.subject.toLowerCase()));
        }
        if (queryInfo.accountId) {
          out = out.filter((h) => h.folder.accountId === queryInfo.accountId);
        }
        return { id: null, messages: out };
      },
      async continueList() {
        throw new Error('not used in tests');
      },
    },
  };
}

describe('buildThread', () => {
  const m1 = makeHeader(1, 'root@x.it', 'Contratto Alfa', '2026-07-01T10:00:00Z');
  const m2 = makeHeader(2, 'mid@x.it', 'Re: Contratto Alfa', '2026-07-02T10:00:00Z');
  const m3 = makeHeader(3, 'leaf@x.it', 'Re: Contratto Alfa', '2026-07-03T10:00:00Z');
  const unrelated = makeHeader(9, 'other@x.it', 'Parcella Beta', '2026-07-02T09:00:00Z');
  const store = [m1, m2, m3, unrelated];
  const fullHeadersById = {
    3: { references: ['<root@x.it> <mid@x.it>'], 'in-reply-to': ['<mid@x.it>'] },
    1: {},
  };

  it('resolves ancestors via references and sorts by date ascending', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages, totalFound } = await buildThread(messenger, m3, { maxMessages: 30 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['root@x.it', 'mid@x.it', 'leaf@x.it']);
    expect(totalFound).toBe(3);
  });

  it('finds descendants of an old message via the subject heuristic', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages } = await buildThread(messenger, m1, { maxMessages: 30 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['root@x.it', 'mid@x.it', 'leaf@x.it']);
  });

  it('never includes messages with a different normalized subject', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages } = await buildThread(messenger, m3, { maxMessages: 30 });
    expect(messages.some((h) => h.headerMessageId === 'other@x.it')).toBe(false);
  });

  it('caps to the most recent maxMessages', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages, totalFound } = await buildThread(messenger, m3, { maxMessages: 2 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['mid@x.it', 'leaf@x.it']);
    expect(totalFound).toBe(3);
  });

  it('returns at least the current message when nothing else is found', async () => {
    const lone = makeHeader(7, 'lone@x.it', 'Nota spese', '2026-07-05T10:00:00Z');
    const messenger = makeFakeMessenger({ store: [lone], fullHeadersById: { 7: {} } });
    const { messages, totalFound } = await buildThread(messenger, lone, {});
    expect(messages).toHaveLength(1);
    expect(totalFound).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thread-builder.test.js`
Expected: FAIL — cannot resolve `../lib/thread-builder.js`.

- [ ] **Step 3: Write minimal implementation (`lib/thread-builder.js`)**

```js
const SUBJECT_PREFIX_RE = /^(re|fw|fwd|r|i)\s*:\s*/i;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const QUERY_CAP = 500;

export function normalizeSubject(subject) {
  let s = (subject ?? '').trim();
  while (SUBJECT_PREFIX_RE.test(s)) s = s.replace(SUBJECT_PREFIX_RE, '').trim();
  return s.toLowerCase();
}

export function collectReferencedIds(headers) {
  const get = (name) => headers?.[name] ?? [];
  const raw = [...get('references'), ...get('in-reply-to')].join(' ');
  return [...new Set([...raw.matchAll(/<([^<>]+)>/g)].map((m) => m[1]))];
}

async function queryAll(messenger, queryInfo, cap = QUERY_CAP) {
  const out = [];
  let page = await messenger.messages.query(queryInfo);
  out.push(...(page.messages ?? []));
  while (page.id && out.length < cap) {
    page = await messenger.messages.continueList(page.id);
    out.push(...(page.messages ?? []));
  }
  return out;
}

export async function buildThread(messenger, currentHeader, { maxMessages = 30 } = {}) {
  const byMessageId = new Map();
  const add = (h) => {
    if (h?.headerMessageId && !byMessageId.has(h.headerMessageId)) {
      byMessageId.set(h.headerMessageId, h);
    }
  };
  add(currentHeader);

  // 1. Ancestors: walk References / In-Reply-To of the displayed message.
  const full = await messenger.messages.getFull(currentHeader.id);
  for (const mid of collectReferencedIds(full.headers)) {
    for (const h of await queryAll(messenger, { headerMessageId: mid })) add(h);
  }

  // 2. Descendants/siblings: same normalized subject, same account, +/-90 days.
  //    messages.query subject matching semantics vary; we post-filter with
  //    normalizeSubject equality so the heuristic can only add true matches.
  const core = normalizeSubject(currentHeader.subject);
  if (core) {
    const times = [...byMessageId.values()].map((h) => new Date(h.date).getTime());
    const candidates = await queryAll(messenger, {
      subject: core,
      accountId: currentHeader.folder?.accountId,
      fromDate: new Date(Math.min(...times) - NINETY_DAYS_MS),
      toDate: new Date(Math.max(...times) + NINETY_DAYS_MS),
    });
    for (const h of candidates) {
      if (normalizeSubject(h.subject) === core) add(h);
    }
  }

  const all = [...byMessageId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { messages: all.slice(-maxMessages), totalFound: all.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thread-builder.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/thread-builder.js tests/thread-builder.test.js
git commit -m "feat: add thread reconstruction via references and subject heuristic"
```

---

### Task 5: Prompt builder (`lib/prompt.js`)

**Files:**
- Create: `lib/prompt.js`
- Test: `tests/prompt.test.js`

**Interfaces:**
- Consumes: rendered message strings from Task 3's `renderMessage`.
- Produces (used by Task 8):
  - `SYSTEM_PROMPT: string`
  - `buildChatMessages(renderedMessages: string[], {charBudget=28000}) → {messages: [{role,content},...], truncatedCount: number, usedCount: number}` — drops OLDEST messages first; always keeps at least the newest one; when truncating, the user content starts with an explicit Italian truncation note.

- [ ] **Step 1: Write the failing test (`tests/prompt.test.js`)**

```js
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildChatMessages } from '../lib/prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('mandates Italian and the four triage sections', () => {
    expect(SYSTEM_PROMPT).toContain('italiano');
    for (const section of ['**Sintesi**', '**Punti chiave**', '**Azioni e scadenze**', '**In attesa di una tua risposta**']) {
      expect(SYSTEM_PROMPT).toContain(section);
    }
  });
});

describe('buildChatMessages', () => {
  it('builds system+user messages preserving chronological order', () => {
    const { messages, truncatedCount, usedCount } = buildChatMessages(['[1/2] A — d1\nprimo', '[2/2] B — d2\nsecondo']);
    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content.indexOf('primo')).toBeLessThan(messages[1].content.indexOf('secondo'));
    expect(truncatedCount).toBe(0);
    expect(usedCount).toBe(2);
  });

  it('drops oldest messages when over budget and prepends the truncation note', () => {
    const old = `[1/3] A — d1\n${'x'.repeat(50)}`;
    const mid = `[2/3] B — d2\n${'y'.repeat(50)}`;
    const last = `[3/3] C — d3\n${'z'.repeat(50)}`;
    const { messages, truncatedCount, usedCount } = buildChatMessages([old, mid, last], { charBudget: 140 });
    expect(truncatedCount).toBe(1);
    expect(usedCount).toBe(2);
    expect(messages[1].content).toContain('troncato');
    expect(messages[1].content).not.toContain('xxxx');
    expect(messages[1].content).toContain('zzzz');
  });

  it('always keeps the newest message even when it alone exceeds the budget', () => {
    const huge = `[1/1] A — d1\n${'w'.repeat(1000)}`;
    const { usedCount, truncatedCount } = buildChatMessages([huge], { charBudget: 10 });
    expect(usedCount).toBe(1);
    expect(truncatedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt.test.js`
Expected: FAIL — cannot resolve `../lib/prompt.js`.

- [ ] **Step 3: Write minimal implementation (`lib/prompt.js`)**

```js
export const SYSTEM_PROMPT = [
  'Sei un assistente che riassume thread di email per un avvocato italiano.',
  'Rispondi ESCLUSIVAMENTE in italiano, qualunque sia la lingua del thread.',
  'Usa ESATTAMENTE questo formato markdown, senza aggiungere altre sezioni:',
  '**Sintesi**',
  '(2-3 frasi che riassumono la conversazione)',
  '**Punti chiave**',
  '(elenco puntato dei fatti salienti)',
  '**Azioni e scadenze**',
  '(elenco puntato; riporta le date esattamente come compaiono nel thread; se non ce ne sono scrivi "Nessuna")',
  '**In attesa di una tua risposta**',
  "(elenco di chi attende una risposta e su cosa; ometti l'intera sezione se nessuno attende)",
  'Non inventare fatti non presenti nel thread.',
].join('\n');

export function buildChatMessages(renderedMessages, { charBudget = 28000 } = {}) {
  const kept = [];
  let used = 0;
  for (let i = renderedMessages.length - 1; i >= 0; i--) {
    const len = renderedMessages[i].length + 2;
    if (kept.length > 0 && used + len > charBudget) break;
    kept.unshift(renderedMessages[i]);
    used += len;
  }
  const truncatedCount = renderedMessages.length - kept.length;
  const note =
    truncatedCount > 0
      ? `(Nota: thread troncato per limiti di contesto, considerati solo gli ultimi ${kept.length} messaggi su ${renderedMessages.length}.)\n\n`
      : '';
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${note}Riassumi questo thread di ${kept.length} messaggi:\n\n${kept.join('\n\n')}` },
    ],
    truncatedCount,
    usedCount: kept.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt.js tests/prompt.test.js
git commit -m "feat: add triage prompt builder with context budget truncation"
```

---

### Task 6: Ollama client (`lib/ollama-client.js`)

**Files:**
- Create: `lib/ollama-client.js`
- Test: `tests/ollama-client.test.js`

**Interfaces:**
- Consumes: `createNdjsonParser` from `lib/ndjson.js` (Task 2).
- Produces (used by Tasks 8, 10):
  - `class OllamaError extends Error` with `.code` (an `ErrorCode` from Shared contracts) and `.detail`.
  - `createOllamaClient({endpoint: string, fetchFn = fetch}) → {listModels(): Promise<string[]>, version(): Promise<string>, chatStream({model, messages, numCtx=8192, signal, onChunk, timeoutMs=120000}): Promise<string>}`
  - `chatStream` resolves with the full text; calls `onChunk(piece)` per streamed piece; rejects with `OllamaError` codes: `unreachable`, `cors` (HTTP 403), `model_missing` (HTTP 404 or `"not found"` in an error line), `timeout`, `cancelled` (external abort), `unknown`.

- [ ] **Step 1: Write the failing test (`tests/ollama-client.test.js`)**

```js
import { describe, it, expect, vi } from 'vitest';
import { createOllamaClient, OllamaError } from '../lib/ollama-client.js';

function streamFrom(lines) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line));
      controller.close();
    },
  });
}

function res(status, { body, json, text } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    json: async () => json,
    text: async () => text ?? '',
  };
}

describe('chatStream', () => {
  const messages = [{ role: 'user', content: 'ciao' }];

  it('concatenates streamed content and reports chunks', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      res(200, {
        body: streamFrom([
          '{"message":{"content":"Sin"},"done":false}\n',
          '{"message":{"content":"tesi"},"done":false}\n{"message":{"content":"."},"done":true}\n',
        ]),
      })
    );
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    const pieces = [];
    const text = await client.chatStream({ model: 'gemma3', messages, onChunk: (p) => pieces.push(p) });
    expect(text).toBe('Sintesi.');
    expect(pieces).toEqual(['Sin', 'tesi', '.']);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gemma3', stream: true, options: { num_ctx: 8192 } });
  });

  it('maps network failure to unreachable', async () => {
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    await expect(client.chatStream({ model: 'm', messages })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('maps HTTP 403 to cors', async () => {
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn: vi.fn().mockResolvedValue(res(403, { text: 'forbidden' })) });
    await expect(client.chatStream({ model: 'm', messages })).rejects.toMatchObject({ code: 'cors' });
  });

  it('maps error lines mentioning "not found" to model_missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { body: streamFrom(['{"error":"model \'x\' not found"}\n']) }));
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    await expect(client.chatStream({ model: 'x', messages })).rejects.toMatchObject({ code: 'model_missing' });
  });

  it('maps external abort to cancelled', async () => {
    const fetchFn = vi.fn().mockImplementation((url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')));
      })
    );
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    const ac = new AbortController();
    const promise = client.chatStream({ model: 'm', messages, signal: ac.signal });
    ac.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('maps timeout to timeout code', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn().mockImplementation((url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')));
        })
      );
      const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
      const promise = client.chatStream({ model: 'm', messages, timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('listModels / version', () => {
  it('lists installed model names', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { json: { models: [{ name: 'gemma3:latest' }, { name: 'velvet:2b' }] } }));
    const client = createOllamaClient({ endpoint: 'http://localhost:11434/', fetchFn });
    expect(await client.listModels()).toEqual(['gemma3:latest', 'velvet:2b']);
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });

  it('returns the server version', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { json: { version: '0.31.2' } }));
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    expect(await client.version()).toBe('0.31.2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ollama-client.test.js`
Expected: FAIL — cannot resolve `../lib/ollama-client.js`.

- [ ] **Step 3: Write minimal implementation (`lib/ollama-client.js`)**

```js
import { createNdjsonParser } from './ndjson.js';

export class OllamaError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'OllamaError';
    this.code = code;
    this.detail = detail;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export function createOllamaClient({ endpoint, fetchFn = globalThis.fetch }) {
  const base = endpoint.replace(/\/+$/, '');

  async function request(path, init = {}) {
    let res;
    try {
      res = await fetchFn(`${base}${path}`, init);
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      if (init.signal?.aborted) throw abortError(init.signal);
      throw new OllamaError('unreachable', String(err));
    }
    if (res.status === 403) throw new OllamaError('cors', await safeText(res));
    if (res.status === 404) throw new OllamaError('model_missing', await safeText(res));
    if (!res.ok) throw new OllamaError('unknown', `HTTP ${res.status}: ${await safeText(res)}`);
    return res;
  }

  function abortError(signal) {
    return signal.reason instanceof OllamaError
      ? signal.reason
      : new OllamaError('cancelled', 'generation cancelled');
  }

  async function listModels() {
    const res = await request('/api/tags');
    const data = await res.json();
    return (data.models ?? []).map((m) => m.name);
  }

  async function version() {
    const res = await request('/api/version');
    return (await res.json()).version;
  }

  async function chatStream({ model, messages, numCtx = 8192, signal, onChunk, timeoutMs = 120000 }) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new OllamaError('timeout', `no completion within ${timeoutMs} ms`)),
      timeoutMs
    );
    const onOuterAbort = () => controller.abort(abortError(signal));
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    if (signal?.aborted) onOuterAbort();

    try {
      const res = await request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, options: { num_ctx: numCtx } }),
        signal: controller.signal,
      });

      let text = '';
      const parser = createNdjsonParser((obj) => {
        if (obj.error) {
          throw new OllamaError(/not found/i.test(obj.error) ? 'model_missing' : 'unknown', obj.error);
        }
        const piece = obj.message?.content ?? '';
        if (piece) {
          text += piece;
          onChunk?.(piece);
        }
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.flush();
      return text;
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof OllamaError
          ? controller.signal.reason
          : new OllamaError('cancelled', 'generation cancelled');
      }
      throw new OllamaError('unknown', String(err));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  return { listModels, version, chatStream };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ollama-client.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ollama-client.js tests/ollama-client.test.js
git commit -m "feat: add streaming Ollama client with typed error mapping"
```

---

### Task 7: Summary manager (`lib/summary-manager.js`)

**Files:**
- Create: `lib/summary-manager.js`
- Test: `tests/summary-manager.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (`storage` is injected: an object with `async get(key)`, `async set(items)`, `async remove(key)` — matching `messenger.storage.session`).
- Produces (used by Task 8):
  - `threadKey(headerMessageIds: string[]) → string` (order-independent djb2 hex)
  - `createSummaryManager({storage}) → manager` with:
    - `getCached(key) → Promise<record|null>` / `setCached(key, record)` / `clearCached(key)` — records per Shared contracts.
    - `getJob(key) → job|null`
    - `createJob(key) → job` — `{key, status:'building', partial:'', messageCount:0, totalFound:0, abortController: AbortController}`
    - `attach(job, listener)` — registers `listener(event)` AND immediately replays current state (`phase` event; plus a single `chunk` with the whole `partial` if generating).
    - `detach(job, listener)`
    - `emit(job, event)` — updates job state from the event (`phase`→status/counters, `chunk`→appends to partial, `done`/`error`/`cancelled`→terminal) and fans out to listeners.
    - `finish(job)` — removes the job from the registry.

- [ ] **Step 1: Write the failing test (`tests/summary-manager.test.js`)**

```js
import { describe, it, expect, vi } from 'vitest';
import { threadKey, createSummaryManager } from '../lib/summary-manager.js';

function fakeStorage() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

describe('threadKey', () => {
  it('is order-independent and stable', () => {
    expect(threadKey(['a@x.it', 'b@x.it'])).toBe(threadKey(['b@x.it', 'a@x.it']));
    expect(threadKey(['a@x.it'])).not.toBe(threadKey(['b@x.it']));
    expect(threadKey(['a@x.it', 'b@x.it'])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('createSummaryManager', () => {
  it('caches and clears records under the summary: prefix', async () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    expect(await m.getCached('k1')).toBeNull();
    await m.setCached('k1', { summary: 'S', meta: { model: 'gemma3' }, savedAt: 't' });
    expect((await m.getCached('k1')).summary).toBe('S');
    await m.clearCached('k1');
    expect(await m.getCached('k1')).toBeNull();
  });

  it('tracks job state from emitted events', () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    const job = m.createJob('k1');
    expect(m.getJob('k1')).toBe(job);
    m.emit(job, { type: 'phase', phase: 'generating', messageCount: 5, totalFound: 7 });
    m.emit(job, { type: 'chunk', text: 'Sin' });
    m.emit(job, { type: 'chunk', text: 'tesi' });
    expect(job.status).toBe('generating');
    expect(job.partial).toBe('Sintesi');
    expect(job.messageCount).toBe(5);
    m.finish(job);
    expect(m.getJob('k1')).toBeNull();
  });

  it('replays current state to late-attaching listeners', () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    const job = m.createJob('k1');
    m.emit(job, { type: 'phase', phase: 'generating', messageCount: 3, totalFound: 3 });
    m.emit(job, { type: 'chunk', text: 'parzia' });
    const seen = [];
    m.attach(job, (e) => seen.push(e));
    expect(seen).toEqual([
      { type: 'phase', phase: 'generating', messageCount: 3, totalFound: 3 },
      { type: 'chunk', text: 'parzia' },
    ]);
  });

  it('fans out events to all listeners and stops after detach', () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    const job = m.createJob('k1');
    const a = vi.fn();
    const b = vi.fn();
    m.attach(job, a);
    m.attach(job, b);
    m.emit(job, { type: 'chunk', text: 'x' });
    m.detach(job, b);
    m.emit(job, { type: 'chunk', text: 'y' });
    // a sees: replay of phase:building (on attach) + chunk x + chunk y
    expect(a).toHaveBeenCalledTimes(3);
    expect(b.mock.calls.filter(([e]) => e.type === 'chunk')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/summary-manager.test.js`
Expected: FAIL — cannot resolve `../lib/summary-manager.js`.

- [ ] **Step 3: Write minimal implementation (`lib/summary-manager.js`)**

```js
const CACHE_PREFIX = 'summary:';

export function threadKey(headerMessageIds) {
  const joined = [...headerMessageIds].sort().join('\n');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0; // djb2, unsigned
  }
  return h.toString(16).padStart(8, '0');
}

export function createSummaryManager({ storage }) {
  const jobs = new Map();

  async function getCached(key) {
    const storageKey = CACHE_PREFIX + key;
    const found = await storage.get(storageKey);
    return found[storageKey] ?? null;
  }

  async function setCached(key, record) {
    await storage.set({ [CACHE_PREFIX + key]: record });
  }

  async function clearCached(key) {
    await storage.remove(CACHE_PREFIX + key);
  }

  function getJob(key) {
    return jobs.get(key) ?? null;
  }

  function createJob(key) {
    const job = {
      key,
      status: 'building',
      partial: '',
      messageCount: 0,
      totalFound: 0,
      listeners: new Set(),
      abortController: new AbortController(),
    };
    jobs.set(key, job);
    return job;
  }

  function replayEvents(job) {
    if (job.status === 'building') return [{ type: 'phase', phase: 'building' }];
    if (job.status === 'generating') {
      const events = [{ type: 'phase', phase: 'generating', messageCount: job.messageCount, totalFound: job.totalFound }];
      if (job.partial) events.push({ type: 'chunk', text: job.partial });
      return events;
    }
    return [];
  }

  function attach(job, listener) {
    job.listeners.add(listener);
    for (const event of replayEvents(job)) listener(event);
  }

  function detach(job, listener) {
    job.listeners.delete(listener);
  }

  function emit(job, event) {
    if (event.type === 'phase') {
      job.status = event.phase;
      if (event.phase === 'generating') {
        job.messageCount = event.messageCount;
        job.totalFound = event.totalFound;
      }
    } else if (event.type === 'chunk') {
      job.partial += event.text;
    } else if (event.type === 'done') {
      job.status = 'done';
    } else if (event.type === 'error') {
      job.status = 'error';
    } else if (event.type === 'cancelled') {
      job.status = 'cancelled';
    }
    for (const listener of job.listeners) listener(event);
  }

  function finish(job) {
    jobs.delete(job.key);
  }

  return { getCached, setCached, clearCached, getJob, createJob, attach, detach, emit, finish };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/summary-manager.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/summary-manager.js tests/summary-manager.test.js
git commit -m "feat: add summary job registry with replay and session cache"
```

---

### Task 8: Settings module + background wiring (`lib/settings.js`, `background.js`)

**Files:**
- Create: `lib/settings.js`
- Modify: `background.js` (replace the Task 1 placeholder entirely)
- Test: `tests/settings.test.js`

**Interfaces:**
- Consumes: `buildThread` (Task 4); `extractMessageText`, `renderMessage` (Task 3); `buildChatMessages` (Task 5); `createOllamaClient`, `OllamaError` (Task 6); `threadKey`, `createSummaryManager` (Task 7).
- Produces:
  - `lib/settings.js`: `DEFAULT_SETTINGS`, `mergeSettings(stored) → settings`, `getSettings(storageLocal) → Promise<settings>`, `pickDefaultModel(models: string[]) → string` (first name starting with `gemma3`, else first, else `''`). Used by Task 10 too.
  - `background.js`: implements the **Port protocol** from Shared contracts, port name `"summary"`. This is the contract Task 9 (popup) codes against.

- [ ] **Step 1: Write the failing test (`tests/settings.test.js`)**

```js
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, getSettings, pickDefaultModel } from '../lib/settings.js';

describe('mergeSettings', () => {
  it('returns defaults for empty/undefined stored values', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it('stored values override defaults', () => {
    expect(mergeSettings({ model: 'velvet:2b' }).model).toBe('velvet:2b');
    expect(mergeSettings({ model: 'velvet:2b' }).maxMessages).toBe(30);
  });
});

describe('getSettings', () => {
  it('reads the "settings" key from storage.local', async () => {
    const fake = { async get(key) { return key === 'settings' ? { settings: { maxMessages: 10 } } : {}; } };
    expect((await getSettings(fake)).maxMessages).toBe(10);
    expect((await getSettings(fake)).endpointUrl).toBe('http://localhost:11434');
  });
});

describe('pickDefaultModel', () => {
  it('prefers the first gemma3* model', () => {
    expect(pickDefaultModel(['velvet:2b', 'gemma3:latest'])).toBe('gemma3:latest');
  });
  it('falls back to the first model, then to empty string', () => {
    expect(pickDefaultModel(['velvet:2b'])).toBe('velvet:2b');
    expect(pickDefaultModel([])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.js`
Expected: FAIL — cannot resolve `../lib/settings.js`.

- [ ] **Step 3: Write `lib/settings.js`**

```js
export const DEFAULT_SETTINGS = {
  endpointUrl: 'http://localhost:11434',
  model: '',
  maxMessages: 30,
};

export function mergeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function getSettings(storageLocal) {
  const found = await storageLocal.get('settings');
  return mergeSettings(found.settings);
}

export function pickDefaultModel(models) {
  return models.find((m) => m.toLowerCase().startsWith('gemma3')) ?? models[0] ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Replace `background.js` with the orchestrator**

No unit test covers this file (it is I/O glue over injected-elsewhere modules); correctness is verified by the full-suite run plus the manual smoke in Step 6 and the E2E checklist in Task 11.

```js
import { buildThread } from './lib/thread-builder.js';
import { extractMessageText, renderMessage } from './lib/content-extractor.js';
import { buildChatMessages } from './lib/prompt.js';
import { createOllamaClient, OllamaError } from './lib/ollama-client.js';
import { threadKey, createSummaryManager } from './lib/summary-manager.js';
import { getSettings, pickDefaultModel } from './lib/settings.js';

const HOST_ORIGINS = ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'];
const manager = createSummaryManager({ storage: messenger.storage.session });

messenger.runtime.onConnect.addListener((port) => {
  if (port.name !== 'summary') return;
  let attachedJob = null;
  const listener = (event) => {
    try {
      port.postMessage(event);
    } catch {
      // port already closed; detach happens in onDisconnect
    }
  };

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.command === 'summarize') {
        attachedJob = await handleSummarize(msg, listener, attachedJob);
      } else if (msg.command === 'cancel') {
        attachedJob?.abortController.abort();
      }
    } catch (err) {
      listener(toErrorEvent(err));
    }
  });

  port.onDisconnect.addListener(() => {
    if (attachedJob) manager.detach(attachedJob, listener);
  });
});

async function handleSummarize({ tabId, force }, listener, previousJob) {
  if (previousJob) manager.detach(previousJob, listener);

  const displayed = await messenger.messageDisplay.getDisplayedMessages(tabId);
  const header = (displayed.messages ?? displayed)[0];
  if (!header) {
    listener({ type: 'error', code: 'no_message', detail: 'no displayed message in this tab' });
    return null;
  }

  // Gecko MV3 may treat host permissions as user-grantable, not install-time.
  const granted = await messenger.permissions.contains({ origins: HOST_ORIGINS });
  if (!granted) {
    listener({ type: 'error', code: 'permission', detail: 'host permission not granted' });
    return null;
  }

  const settings = await getSettings(messenger.storage.local);
  listener({ type: 'phase', phase: 'building' });
  const { messages: thread, totalFound } = await buildThread(messenger, header, {
    maxMessages: settings.maxMessages,
  });
  const key = threadKey(thread.map((h) => h.headerMessageId));

  const existing = manager.getJob(key);
  if (existing) {
    manager.attach(existing, listener);
    return existing;
  }

  if (!force) {
    const cached = await manager.getCached(key);
    if (cached?.summary) {
      listener({ type: 'done', summary: cached.summary, meta: { ...cached.meta, cached: true } });
      return null;
    }
    if (cached?.status === 'interrupted') {
      listener({ type: 'interrupted', partial: cached.partial });
      return null;
    }
  }

  const job = manager.createJob(key);
  manager.attach(job, listener);
  runGeneration(job, thread, totalFound, settings); // errors handled inside
  return job;
}

async function runGeneration(job, thread, totalFound, settings) {
  try {
    const client = createOllamaClient({ endpoint: settings.endpointUrl });
    let model = settings.model;
    if (!model) model = pickDefaultModel(await client.listModels());
    if (!model) throw new OllamaError('model_missing', 'no models installed');

    const rendered = [];
    for (let i = 0; i < thread.length; i++) {
      const h = thread[i];
      const full = await messenger.messages.getFull(h.id);
      rendered.push(renderMessage(i + 1, thread.length, h.author, formatDate(h.date), extractMessageText(full)));
    }
    const { messages, truncatedCount, usedCount } = buildChatMessages(rendered);

    manager.emit(job, { type: 'phase', phase: 'generating', messageCount: usedCount, totalFound });

    let lastSave = 0;
    const summary = await client.chatStream({
      model,
      messages,
      signal: job.abortController.signal,
      onChunk: (piece) => {
        manager.emit(job, { type: 'chunk', text: piece });
        // Throttled partial save so an event-page suspension loses at most ~2s.
        const now = Date.now();
        if (now - lastSave > 2000) {
          lastSave = now;
          manager
            .setCached(job.key, { status: 'interrupted', partial: job.partial, savedAt: new Date().toISOString() })
            .catch(() => {});
        }
      },
    });

    const meta = {
      usedCount,
      totalFound,
      truncatedCount,
      model,
      cached: false,
      generatedAt: new Date().toISOString(),
    };
    await manager.setCached(job.key, { summary, meta, savedAt: meta.generatedAt });
    manager.emit(job, { type: 'done', summary, meta });
  } catch (err) {
    if (err instanceof OllamaError && err.code === 'cancelled') {
      manager.clearCached(job.key).catch(() => {});
      manager.emit(job, { type: 'cancelled' });
    } else {
      manager.clearCached(job.key).catch(() => {});
      manager.emit(job, toErrorEvent(err));
    }
  } finally {
    manager.finish(job);
  }
}

function toErrorEvent(err) {
  if (err instanceof OllamaError) return { type: 'error', code: err.code, detail: err.detail };
  return { type: 'error', code: 'unknown', detail: String(err) };
}

function formatDate(date) {
  const d = new Date(date);
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}
```

- [ ] **Step 6: Full suite + manual smoke**

Run: `npm test`
Expected: PASS — all suites green (ndjson, content-extractor, thread-builder, prompt, ollama-client, summary-manager, settings).

Manual smoke (requires Thunderbird):
1. Thunderbird → Tools → Developer Tools → Debug Add-ons → "Load Temporary Add-on…" → select `manifest.json`.
2. Open any message: the "Riassumi thread" button appears in the message header toolbar.
3. Inspect the background page from Debug Add-ons: no errors in console at load.

Expected: button visible, console clean. (The popup is still the Task 1 shell — full flow is tested after Task 9.)

- [ ] **Step 7: Commit**

```bash
git add lib/settings.js tests/settings.test.js background.js
git commit -m "feat: wire background orchestrator with port protocol and session cache"
```

---

### Task 9: Markdown renderer + popup viewer (`lib/markdown-lite.js`, `popup/`)

**Files:**
- Create: `lib/markdown-lite.js`
- Modify: `popup/popup.html`, `popup/popup.js`, `popup/popup.css` (replace Task 1 shells entirely)
- Test: `tests/markdown-lite.test.js`

**Interfaces:**
- Consumes: the Port protocol from Shared contracts (implemented in Task 8); `HOST_ORIGINS` values duplicated here as a local constant (extension pages cannot import from the background page's scope).
- Produces:
  - `escapeHtml(s) → string`
  - `renderTriage(markdown) → string` — safe HTML: `**Heading**`-only lines become `<h2>`, `- `/`* `/`• ` lines become `<ul><li>`, other lines `<p>`; inline `**bold**` becomes `<strong>`; ALL input is HTML-escaped before transformation (model output is untrusted).

- [ ] **Step 1: Write the failing test (`tests/markdown-lite.test.js`)**

```js
import { describe, it, expect } from 'vitest';
import { escapeHtml, renderTriage } from '../lib/markdown-lite.js';

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<img src=x onerror="a&'b">`)).toBe(
      '&lt;img src=x onerror=&quot;a&amp;&#39;b&quot;&gt;'
    );
  });
});

describe('renderTriage', () => {
  it('renders headings, bullets and paragraphs', () => {
    const md = ['**Sintesi**', 'Breve riassunto.', '**Punti chiave**', '- primo punto', '- secondo **importante**'].join('\n');
    const html = renderTriage(md);
    expect(html).toContain('<h2>Sintesi</h2>');
    expect(html).toContain('<p>Breve riassunto.</p>');
    expect(html).toContain('<ul><li>primo punto</li><li>secondo <strong>importante</strong></li></ul>');
  });

  it('closes an open list before a following heading', () => {
    const html = renderTriage(['- a', '**Titolo**'].join('\n'));
    expect(html).toBe('<ul><li>a</li></ul><h2>Titolo</h2>');
  });

  it('never lets raw HTML from the model through', () => {
    const html = renderTriage('- <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/markdown-lite.test.js`
Expected: FAIL — cannot resolve `../lib/markdown-lite.js`.

- [ ] **Step 3: Write `lib/markdown-lite.js`**

```js
export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inlineBold(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderTriage(markdown) {
  const lines = escapeHtml(markdown).split('\n');
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^\*\*(.+?)\*\*:?$/);
    if (heading) {
      closeList();
      html += `<h2>${heading[1]}</h2>`;
      continue;
    }
    if (/^[-*•]\s+/.test(t)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${inlineBold(t.replace(/^[-*•]\s+/, ''))}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inlineBold(t)}</p>`;
  }
  closeList();
  return html;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/markdown-lite.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header>
    <h1>Riassunto thread</h1>
    <button id="btn-options" title="Opzioni">⚙</button>
  </header>
  <main id="root"></main>
  <footer>
    <button id="btn-cancel" hidden>Annulla</button>
    <button id="btn-copy" hidden>Copia</button>
    <button id="btn-regen" hidden>Rigenera</button>
  </footer>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 6: Write `popup/popup.css`**

```css
:root {
  color-scheme: light dark;
  --fg: #1f2328;
  --muted: #656d76;
  --accent: #1d4ed8;
  --bg-soft: #f6f8fa;
  --border: #d0d7de;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6edf3; --muted: #9ea7b3; --accent: #6ea8fe; --bg-soft: #21262d; --border: #30363d; }
}
body {
  width: 440px; max-height: 540px; margin: 0; display: flex; flex-direction: column;
  font: 13px/1.45 -apple-system, "Segoe UI", sans-serif; color: var(--fg);
}
header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
header h1 { font-size: 14px; margin: 0; }
#btn-options { background: none; border: none; font-size: 15px; cursor: pointer; color: var(--muted); }
main { padding: 10px 14px; overflow-y: auto; flex: 1; }
main h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); margin: 12px 0 4px; }
main ul { margin: 4px 0; padding-left: 18px; }
main p { margin: 4px 0; }
footer { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 12px; border-top: 1px solid var(--border); }
footer button, .action { padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-soft); color: var(--fg); cursor: pointer; }
footer button:hover, .action:hover { border-color: var(--accent); }
.phase { display: flex; gap: 10px; align-items: center; color: var(--muted); padding: 18px 4px; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error { color: #b42318; padding: 12px 4px; }
.error .detail { color: var(--muted); font-size: 12px; margin-top: 6px; }
.meta { color: var(--muted); font-size: 11px; margin-top: 10px; border-top: 1px dashed var(--border); padding-top: 6px; }
pre.cmd { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 6px; padding: 8px; overflow-x: auto; user-select: all; }
.note { color: var(--muted); font-style: italic; }
```

- [ ] **Step 7: Write `popup/popup.js`**

```js
import { renderTriage, escapeHtml } from '../lib/markdown-lite.js';

const HOST_ORIGINS = ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'];
const OLLAMA_ORIGINS_CMD = 'launchctl setenv OLLAMA_ORIGINS "moz-extension://*"';

const root = document.getElementById('root');
const btnCancel = document.getElementById('btn-cancel');
const btnCopy = document.getElementById('btn-copy');
const btnRegen = document.getElementById('btn-regen');

let port = null;
let currentTabId = null;
let currentText = '';

document.getElementById('btn-options').addEventListener('click', () => messenger.runtime.openOptionsPage());
btnCancel.addEventListener('click', () => port?.postMessage({ command: 'cancel' }));
btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentText);
  btnCopy.textContent = 'Copiato ✓';
  setTimeout(() => (btnCopy.textContent = 'Copia'), 1500);
});
btnRegen.addEventListener('click', () => summarize(true));

init();

async function init() {
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  port = messenger.runtime.connect({ name: 'summary' });
  port.onMessage.addListener(onEvent);
  summarize(false);
}

function summarize(force) {
  currentText = '';
  setButtons({ cancel: false, copy: false, regen: false });
  renderPhase('Preparazione…');
  port.postMessage({ command: 'summarize', tabId: currentTabId, force });
}

function onEvent(event) {
  switch (event.type) {
    case 'phase':
      if (event.phase === 'building') renderPhase('Ricostruzione del thread…');
      else renderPhase(`Generazione… (${event.messageCount} messaggi)`);
      setButtons({ cancel: event.phase === 'generating', copy: false, regen: false });
      break;
    case 'chunk':
      currentText += event.text;
      root.innerHTML = renderTriage(currentText);
      root.scrollTop = root.scrollHeight;
      setButtons({ cancel: true, copy: false, regen: false });
      break;
    case 'done':
      currentText = event.summary;
      root.innerHTML = renderTriage(event.summary) + metaBar(event.meta);
      setButtons({ cancel: false, copy: true, regen: true });
      break;
    case 'interrupted':
      currentText = event.partial;
      root.innerHTML =
        '<p class="note">Generazione interrotta: riassunto parziale.</p>' + renderTriage(event.partial);
      setButtons({ cancel: false, copy: true, regen: true });
      break;
    case 'cancelled':
      root.innerHTML = '<p class="note">Generazione annullata.</p>';
      setButtons({ cancel: false, copy: false, regen: true });
      break;
    case 'error':
      renderError(event);
      break;
  }
}

function metaBar(meta) {
  const parts = [`${meta.usedCount} messaggi`, `modello ${meta.model}`];
  if (meta.truncatedCount > 0) parts.push(`thread troncato (esclusi ${meta.truncatedCount} più vecchi)`);
  if (meta.usedCount < meta.totalFound) parts.push(`trovati ${meta.totalFound} in totale`);
  if (meta.cached) parts.push('dalla cache');
  return `<div class="meta">${escapeHtml(parts.join(' · '))}</div>`;
}

function renderPhase(text) {
  root.innerHTML = `<div class="phase"><div class="spinner"></div><span>${escapeHtml(text)}</span></div>`;
}

function renderError({ code, detail }) {
  const views = {
    unreachable: {
      title: 'Ollama non è in esecuzione',
      body: '<p>Avvia Ollama e riprova.</p>',
      action: { label: 'Riprova', run: () => summarize(false) },
    },
    cors: {
      title: 'Ollama rifiuta le richieste dalle estensioni (403)',
      body: `<p>Esegui una volta nel Terminale, poi riavvia Ollama:</p><pre class="cmd">${escapeHtml(OLLAMA_ORIGINS_CMD)}</pre>`,
      action: { label: 'Riprova', run: () => summarize(false) },
    },
    model_missing: {
      title: 'Modello non disponibile',
      body: '<p>Scaricalo con <code>ollama pull</code> oppure scegli un altro modello nelle opzioni.</p>',
      action: { label: 'Apri opzioni', run: () => messenger.runtime.openOptionsPage() },
    },
    permission: {
      title: 'Serve il permesso per contattare Ollama',
      body: '<p>Concedi l’accesso a <code>localhost:11434</code> (resta tutto sul tuo computer).</p>',
      action: {
        label: 'Concedi accesso',
        run: async () => {
          const ok = await messenger.permissions.request({ origins: HOST_ORIGINS });
          if (ok) summarize(false);
        },
      },
    },
    timeout: {
      title: 'Tempo scaduto (120 s)',
      body: '<p>Il modello è troppo lento su questo thread: riprova o scegli un modello più piccolo.</p>',
      action: { label: 'Riprova', run: () => summarize(false) },
    },
    no_message: {
      title: 'Nessun messaggio visualizzato',
      body: '<p>Apri un messaggio e riprova.</p>',
      action: null,
    },
  };
  const view = views[code] ?? {
    title: 'Errore imprevisto',
    body: `<p class="detail">${escapeHtml(detail ?? '')}</p>`,
    action: { label: 'Riprova', run: () => summarize(false) },
  };
  root.innerHTML = `<div class="error"><strong>${escapeHtml(view.title)}</strong>${view.body}</div>`;
  if (view.action) {
    const btn = document.createElement('button');
    btn.className = 'action';
    btn.textContent = view.action.label;
    btn.addEventListener('click', view.action.run);
    root.querySelector('.error').appendChild(btn);
  }
  setButtons({ cancel: false, copy: false, regen: false });
}

function setButtons({ cancel, copy, regen }) {
  btnCancel.hidden = !cancel;
  btnCopy.hidden = !copy;
  btnRegen.hidden = !regen;
}
```

Static strings in `views` are trusted extension copy (safe as innerHTML); everything dynamic (`detail`, model output, meta) goes through `escapeHtml`/`renderTriage`.

- [ ] **Step 8: Full suite + manual happy path**

Run: `npm test`
Expected: PASS, all suites.

Manual (Thunderbird + Ollama running):
1. Reload the temporary add-on (Debug Add-ons → Reload).
2. Open a message that belongs to a thread with replies; click "Riassumi thread".
3. Expected: phase "Ricostruzione…" → "Generazione… (N messaggi)" → streaming text → structured summary with **Sintesi / Punti chiave / Azioni e scadenze** headings and a meta line (message count, model).
4. Click outside the popup mid-generation, reopen: streaming resumes from where it was (replay), no restart.
5. "Copia" puts the markdown in the clipboard; "Rigenera" restarts ignoring cache; reopening the popup on the same thread shows "dalla cache" instantly.

- [ ] **Step 9: Commit**

```bash
git add lib/markdown-lite.js tests/markdown-lite.test.js popup/
git commit -m "feat: add popup viewer with streaming render and actionable errors"
```

---

### Task 10: Options page (`options/`)

**Files:**
- Modify: `options/options.html`, `options/options.js` (replace Task 1 shells entirely)

**Interfaces:**
- Consumes: `getSettings`, `DEFAULT_SETTINGS` (Task 8); `createOllamaClient`, `OllamaError` (Task 6).
- Produces: writes `{settings}` to `storage.local` in the exact Settings shape from Shared contracts (background reads it on every summarize).

- [ ] **Step 1: Write `options/options.html`**

```html
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 13px/1.5 -apple-system, "Segoe UI", sans-serif; margin: 16px; max-width: 560px; }
    label { display: block; font-weight: 600; margin: 14px 0 4px; }
    input, select { width: 100%; box-sizing: border-box; padding: 5px 8px; }
    .row { display: flex; gap: 8px; align-items: center; }
    .row > * { flex: 1; }
    .row button { flex: 0 0 auto; }
    button { padding: 5px 14px; cursor: pointer; }
    #status, #save-status { font-size: 12px; margin-left: 8px; }
    .ok { color: #067647; } .err { color: #b42318; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 8px; user-select: all; overflow-x: auto; }
    .hint { color: #656d76; font-size: 12px; margin-top: 2px; }
    hr { margin: 20px 0; border: none; border-top: 1px solid #d0d7de; }
  </style>
</head>
<body>
  <h2>Riassumi Thread — Opzioni</h2>

  <label for="endpoint">Endpoint Ollama</label>
  <div class="row">
    <input id="endpoint" type="url" placeholder="http://localhost:11434">
    <button id="btn-test">Testa connessione</button><span id="status"></span>
  </div>

  <label for="model">Modello</label>
  <div class="row">
    <select id="model"><option value="">(automatico: primo gemma3, altrimenti il primo)</option></select>
    <button id="btn-refresh">Aggiorna elenco</button>
  </div>
  <div class="hint">L'elenco viene letto dai modelli installati in Ollama.</div>

  <label for="max-messages">Numero massimo di messaggi per thread</label>
  <input id="max-messages" type="number" min="2" max="100" step="1">

  <p><button id="btn-save">Salva</button><span id="save-status"></span></p>

  <hr>
  <h3>Setup Ollama (una tantum)</h3>
  <p>Ollama per default rifiuta le richieste delle estensioni. Esegui nel Terminale e riavvia Ollama:</p>
  <pre>launchctl setenv OLLAMA_ORIGINS "moz-extension://*"</pre>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `options/options.js`**

```js
import { getSettings } from '../lib/settings.js';
import { createOllamaClient } from '../lib/ollama-client.js';

const $ = (id) => document.getElementById(id);

async function client() {
  return createOllamaClient({ endpoint: $('endpoint').value.trim() || 'http://localhost:11434' });
}

async function refreshModels(selected) {
  const select = $('model');
  for (const opt of [...select.options].slice(1)) opt.remove();
  try {
    const models = await (await client()).listModels();
    for (const name of models) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  } catch {
    // endpoint down: keep the automatic option only
  }
  select.value = [...select.options].some((o) => o.value === selected) ? selected : '';
}

async function load() {
  const settings = await getSettings(messenger.storage.local);
  $('endpoint').value = settings.endpointUrl;
  $('max-messages').value = settings.maxMessages;
  await refreshModels(settings.model);
}

$('btn-refresh').addEventListener('click', () => refreshModels($('model').value));

$('btn-test').addEventListener('click', async () => {
  const status = $('status');
  status.textContent = '…';
  status.className = '';
  try {
    const v = await (await client()).version();
    status.textContent = `OK — Ollama ${v}`;
    status.className = 'ok';
  } catch (err) {
    status.textContent = err.code === 'cors' ? 'Rifiutato (403): vedi Setup Ollama qui sotto' : 'Non raggiungibile';
    status.className = 'err';
  }
});

$('btn-save').addEventListener('click', async () => {
  const settings = {
    endpointUrl: $('endpoint').value.trim().replace(/\/+$/, '') || 'http://localhost:11434',
    model: $('model').value,
    maxMessages: Math.min(100, Math.max(2, Number($('max-messages').value) || 30)),
  };
  await messenger.storage.local.set({ settings });
  $('save-status').textContent = 'Salvato ✓';
  $('save-status').className = 'ok';
  setTimeout(() => ($('save-status').textContent = ''), 1500);
});

load();
```

- [ ] **Step 3: Full suite + manual verification**

Run: `npm test`
Expected: PASS, all suites (options has no unit tests: DOM glue over already-tested modules).

Manual:
1. Reload the temporary add-on; open the extension's options (Add-ons Manager → Thread Summarizer → Options, or ⚙ in the popup).
2. "Testa connessione" → "OK — Ollama 0.31.x" (Ollama running).
3. "Aggiorna elenco" → dropdown lists installed models (gemma3, Velvet…); choose one, "Salva".
4. Summarize a thread: the meta line in the popup shows the chosen model.

- [ ] **Step 4: Commit**

```bash
git add options/
git commit -m "feat: add options page with model picker and connection test"
```

---

### Task 11: README, packaging script, manual E2E checklist

**Files:**
- Create: `README.md`, `scripts/package.sh`, `docs/manual-test-checklist.md`

**Interfaces:**
- Consumes: everything (this is the release wrapper).
- Produces: `npm run package` → `dist/tb-thread-summarizer-0.1.0.xpi` installable via Thunderbird's "Install Add-on From File".

- [ ] **Step 1: Write `README.md`**

```markdown
# Thread Summarizer (Ollama) for Thunderbird

Summarizes the email thread of the displayed message with a local Ollama
model. A "Riassumi thread" button on the message header opens a panel with a
structured Italian triage summary (TL;DR, key points, actions & deadlines,
pending replies). **No email content ever leaves your machine**: the only
network host contacted is your local Ollama endpoint.

## Requirements

- Thunderbird >= 128
- [Ollama](https://ollama.com) running locally with at least one chat model
  (e.g. `ollama pull gemma3`)

## One-time Ollama setup (macOS)

Ollama rejects requests coming from browser extensions unless their origin is
allowed. Run once in Terminal, then restart Ollama:

    launchctl setenv OLLAMA_ORIGINS "moz-extension://*"

(Linux: add `Environment="OLLAMA_ORIGINS=moz-extension://*"` to the systemd
unit. Windows: set the `OLLAMA_ORIGINS` system environment variable.)

## Install

1. `npm run package` (or download a release zip)
2. Thunderbird → Add-ons Manager → gear icon → "Install Add-on From File…" →
   pick `dist/tb-thread-summarizer-<version>.xpi`

## Usage

Open any message → click **Riassumi thread** in the message header toolbar.
First summary of a thread streams in; reopening the same thread is instant
(session cache, cleared when Thunderbird quits — summaries are never written
to disk). Configure endpoint, model and thread size in the add-on options.

## Development

- `npm install` — dev tooling (Vitest only; the extension itself has zero
  runtime dependencies and no build step)
- `npm test` — unit tests
- Load for development: Tools → Developer Tools → Debug Add-ons → "Load
  Temporary Add-on…" → select `manifest.json`
- Manual E2E: see `docs/manual-test-checklist.md`

## Privacy

Email content is sent exclusively to the configured Ollama endpoint
(`http://localhost:11434` by default). Summaries live in extension session
storage only. Settings contain no personal data.
```

- [ ] **Step 2: Write `scripts/package.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/tb-thread-summarizer-${VERSION}.xpi"
mkdir -p dist
rm -f "$OUT"
zip -r "$OUT" manifest.json background.js lib popup options icons -x '*.DS_Store'
echo "Packaged $OUT"
```

Then: `chmod +x scripts/package.sh`

- [ ] **Step 3: Write `docs/manual-test-checklist.md`**

```markdown
# Manual E2E checklist

Run before each release, on a real account. Prerequisites: Thunderbird >= 128,
Ollama running with `OLLAMA_ORIGINS="moz-extension://*"` and gemma3 installed.

## Happy paths
- [ ] Thread with 2 messages: summary has the required sections, in Italian
- [ ] Thread with ~10 messages: summary cites the actual topics; meta line
      shows the message count and model
- [ ] Long thread (30+): truncation note appears; still useful
- [ ] HTML-only message in thread: text extracted, no tags in summary
- [ ] English thread: summary still in Italian
- [ ] Reopen same thread: instant result, meta shows "dalla cache"
- [ ] Rigenera: bypasses cache, new generation starts
- [ ] Copia: clipboard contains the summary markdown

## Robustness
- [ ] Close popup mid-generation, reopen: stream resumes, no restart
- [ ] Annulla mid-generation: cancelled state, Rigenera works
- [ ] Quit Ollama → summarize: "Ollama non è in esecuzione" + Riprova works
- [ ] Unset OLLAMA_ORIGINS (launchctl unsetenv OLLAMA_ORIGINS, restart
      Ollama) → summarize: 403 view with the copyable command
- [ ] Select a non-installed model in options → summarize: model_missing view
- [ ] Message with no thread: works on the single message
- [ ] Feed/standalone tab with no displayed message: "Nessun messaggio" view

## Environment
- [ ] Fresh profile install from .xpi: button appears, options open
- [ ] Only network traffic: localhost:11434 (check Ollama logs / no other
      requests from the extension in the Network panel of the background page)
```

- [ ] **Step 4: Package and final verification**

Run: `npm test`
Expected: PASS — full suite green.

Run: `npm run package`
Expected: `Packaged dist/tb-thread-summarizer-0.1.0.xpi`; `unzip -l` shows manifest.json at the archive root.

Then walk `docs/manual-test-checklist.md` top to bottom with the user (the happy-path block at minimum) before calling v1 done.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/package.sh docs/manual-test-checklist.md
git commit -m "docs: add README, packaging script and manual E2E checklist"
```

---

## Post-plan notes for the executor

- Tasks 2-7 are pure-module tasks: no Thunderbird needed, fully test-driven.
- Tasks 8-11 touch the real environment: keep Thunderbird with the temporary
  add-on loaded and Ollama running while executing them.
- If `messages.query({headerMessageId})` or the subject heuristic behaves
  differently on the real account than in the fakes (pagination quirks,
  Gloda indexing delays), fix `lib/thread-builder.js` and extend its fixtures
  — do NOT patch around it in `background.js`.
- If MV3 event-page suspension kills streams in practice (Risk #1 in the
  spec), the approved fallback is switching `background` to a persistent page
  in `manifest.json` — one line — and noting it in the README.
