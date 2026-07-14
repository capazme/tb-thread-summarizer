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
