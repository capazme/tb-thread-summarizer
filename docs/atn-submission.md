# addons.thunderbird.net — submission kit

Everything needed to publish Thread Summarizer on the official Thunderbird
add-ons site (ATN). You do the actual upload from the portal (it needs a
developer account and acceptance of the distribution agreement — both must be
done by you); this file is the copy-paste material and the checklist.

Portal: <https://addons.thunderbird.net/developers/>

---

## 1. Listing metadata

| Field | Value |
|---|---|
| **Add-on name** | Thread Summarizer (Ollama) |
| **Summary** (≤250 chars) | Summarize the current email thread with a local Ollama model. Private by design — no email content ever leaves your machine. Structured triage: TL;DR, key points, actions & deadlines, pending replies. |
| **Categories** | Tools / Productivity |
| **Tags** | ollama, summarize, ai, local, privacy, llm |
| **Homepage** | https://github.com/capazme/tb-thread-summarizer |
| **Support site** | https://github.com/capazme/tb-thread-summarizer/issues |
| **License** | Mozilla Public License 2.0 |
| **Min Thunderbird** | 128.0 (from manifest `strict_min_version`) |

## 2. Description (EN)

> **Summarize long email threads without your messages ever leaving your
> computer.**
>
> Thread Summarizer adds a **Riassumi thread** button to the message header.
> Click it and the whole conversation of the message you are reading is sent to
> a **local** Ollama model, which returns a structured triage summary:
>
> - **Sintesi** — a two-to-three sentence TL;DR
> - **Punti chiave** — the salient points
> - **Azioni e scadenze** — action items and deadlines, dates kept verbatim
> - **In attesa di una tua risposta** — who is waiting on you
>
> The summary streams in as it is generated. Reopening a thread you already
> summarized is instant (session cache, never written to disk). Endpoint,
> model and thread size are configurable.
>
> **Privacy by design:** the only network host the extension contacts is your
> local Ollama endpoint (`http://localhost:11434` by default). No cloud, no
> telemetry, no third-party requests, no bundled runtime dependencies.
>
> **Requirements:** Thunderbird 128+, and [Ollama](https://ollama.com) running
> locally with a chat model installed (e.g. `ollama pull gemma3`). A one-time
> `OLLAMA_ORIGINS` setup is required — see the extension's options page or the
> project README.

## 3. Description (IT)

> **Riassumi thread di email lunghi senza che i tuoi messaggi lascino mai il
> computer.**
>
> Thread Summarizer aggiunge un pulsante **Riassumi thread** nell'intestazione
> del messaggio. Cliccandolo, l'intera conversazione del messaggio che stai
> leggendo viene inviata a un modello **Ollama locale**, che restituisce un
> riassunto strutturato per il triage:
>
> - **Sintesi** — un TL;DR di due o tre frasi
> - **Punti chiave** — i punti salienti
> - **Azioni e scadenze** — cose da fare e scadenze, con le date riportate
>   fedelmente
> - **In attesa di una tua risposta** — chi sta aspettando da te
>
> Il riassunto compare in streaming mentre viene generato. Riaprire un thread
> già riassunto è istantaneo (cache di sessione, mai scritta su disco).
> Endpoint, modello e dimensione del thread sono configurabili.
>
> **Privacy per progettazione:** l'unico host di rete contattato è il tuo
> endpoint Ollama locale. Nessun cloud, nessuna telemetria, nessuna richiesta a
> terzi, nessuna dipendenza runtime.
>
> **Requisiti:** Thunderbird 128+ e [Ollama](https://ollama.com) in esecuzione
> in locale con un modello installato (es. `ollama pull gemma3`). È richiesta
> una configurazione `OLLAMA_ORIGINS` una tantum — vedi la pagina opzioni o il
> README del progetto.

## 4. Notes for reviewers (paste into the "Notes to reviewer" field)

> **Architecture:** plain JavaScript ES modules, Manifest V3, no build step and
> no bundled/minified code — the source uploaded is exactly what runs. No
> runtime dependencies. Vitest is a dev-only dependency and is not shipped in
> the .xpi.
>
> **Permissions justification:**
> - `messagesRead` — to read the bodies of the messages in the displayed
>   thread, which are the input to the summary.
> - `storage` — `storage.session` holds the per-thread summary cache (cleared
>   on quit); `storage.local` holds user settings (endpoint, model, thread
>   size). No personal data.
> - host `http://localhost:11434/*` and `http://127.0.0.1:11434/*` — to call
>   the user's local Ollama HTTP API. No other host is ever contacted.
>
> **How to test:** the add-on needs a local Ollama instance.
> 1. Install Ollama (<https://ollama.com>) and run `ollama pull gemma3`.
> 2. Allow the extension origin: `launchctl setenv OLLAMA_ORIGINS
>    "moz-extension://*"` (macOS) or the OS equivalent, then restart Ollama.
> 3. Open any message that is part of a reply thread and click **Riassumi
>    thread** in the message header.
>
> With Ollama not running, the add-on degrades gracefully to a clear error
> panel (it does not crash and makes no external calls).

## 5. Privacy policy (short — paste into the privacy field if requested)

> Thread Summarizer processes email content locally. The content of the
> displayed thread is sent only to the Ollama endpoint configured by the user
> (a local service, `http://localhost:11434` by default). The add-on collects
> no analytics, contacts no remote servers, and stores summaries only in
> session memory. User settings are stored locally and contain no personal
> data.

## 6. Screenshots to prepare (upload 2–4)

ATN wants PNG/JPG screenshots. Capture from your own Thunderbird:

1. The message header with the **Riassumi thread** button visible.
2. The popup panel showing a finished structured summary (Sintesi / Punti
   chiave / Azioni e scadenze).
3. The options page (endpoint, model picker, connection test).
4. *(optional)* A meaningful error state (e.g. the `OLLAMA_ORIGINS` hint).

Save them under `docs/screenshots/` in the repo too, so the README can show
them.

## 7. Submission checklist

- [ ] Create/sign in to an ATN developer account and accept the distribution
      agreement.
- [ ] `npm test` green and `npm run package` produces the `.xpi`.
- [ ] Bump `version` in `manifest.json` and `package.json` if resubmitting.
- [ ] Upload `dist/tb-thread-summarizer-<version>.xpi`.
- [ ] Confirm the validator reports no blocking errors (unminified source, so
      no source-code upload step is required).
- [ ] Paste the EN/IT descriptions, summary, tags, homepage and support URL.
- [ ] Paste the reviewer notes (section 4) and privacy policy (section 5).
- [ ] Upload screenshots (section 6).
- [ ] Select license: MPL-2.0.
- [ ] Submit for review.

## 8. Community announcement (optional, after it is listed)

Once the listing is live, good places to announce:

- Thunderbird section of the Mozilla Discourse: <https://discourse.mozilla.org/c/thunderbird/>
- r/Thunderbird on Reddit
- The Ollama community (Discord / GitHub Discussions) — the "local, private"
  angle fits well there

Suggested one-liner:

> Thread Summarizer for Thunderbird — summarize email threads with a local
> Ollama model, nothing leaves your machine. MV3, open source (MPL-2.0):
> https://github.com/capazme/tb-thread-summarizer
