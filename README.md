# Thread Summarizer (Ollama) for Thunderbird

[![CI](https://github.com/capazme/tb-thread-summarizer/actions/workflows/ci.yml/badge.svg)](https://github.com/capazme/tb-thread-summarizer/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://www.mozilla.org/en-US/MPL/2.0/)
[![Thunderbird ≥128](https://img.shields.io/badge/Thunderbird-%E2%89%A5128-0a84ff.svg)](https://www.thunderbird.net/)

Summarizes the email thread of the displayed message with a **local** Ollama
model, right inside Thunderbird. A **Riassumi thread** button on the message
header opens a panel with a structured triage summary — TL;DR, key points,
actions & deadlines, and who is waiting for a reply.

**No email content ever leaves your machine.** The only network host the
extension contacts is your local Ollama endpoint (`http://localhost:11434` by
default). No cloud, no telemetry, no third-party calls, no bundled runtime
dependencies. Summaries live in session memory only and are never written to
disk.

> The summary text is produced in Italian (v1). Endpoint, model and thread
> size are configurable in the add-on options.

## Requirements

- **Thunderbird ≥ 128**
- [**Ollama**](https://ollama.com) running locally with at least one chat model
  installed, e.g. `ollama pull gemma3`

## One-time Ollama setup

Ollama rejects requests coming from browser extensions unless their origin is
allowed. Configure it once, **then restart Ollama** so it picks up the change.

**macOS**

```bash
launchctl setenv OLLAMA_ORIGINS "moz-extension://*"
```

Then quit Ollama from the menu-bar icon and reopen it.

**Linux** (systemd): add to the service via `systemctl edit ollama.service`

```ini
[Service]
Environment="OLLAMA_ORIGINS=moz-extension://*"
```

then `sudo systemctl daemon-reload && sudo systemctl restart ollama`.

**Windows**: set a system environment variable `OLLAMA_ORIGINS` to
`moz-extension://*`, then restart Ollama.

> If you skip this step the panel shows a clear message with the exact command
> to run.

## Install

**From a release (recommended)**

1. Download the latest `tb-thread-summarizer-<version>.xpi` from the
   [Releases](https://github.com/capazme/tb-thread-summarizer/releases) page.
2. Thunderbird → **Add-ons Manager** → gear icon → **Install Add-on From
   File…** → pick the `.xpi`.

**From source**

```bash
git clone https://github.com/capazme/tb-thread-summarizer.git
cd tb-thread-summarizer
npm install && npm test
npm run package   # produces dist/tb-thread-summarizer-<version>.xpi
```

## Usage

Open any message → click **Riassumi thread** in the message-header toolbar. The
first summary of a thread streams in; reopening the same thread is instant
(session cache). Use **Rigenera** to force a fresh summary, **Copia** to copy
the text, and the gear icon to open options.

## How it works

1. The thread of the displayed message is reconstructed from the
   `References` / `In-Reply-To` headers, with a normalized-subject fallback.
2. Each message is reduced to clean text (quotes and signatures stripped) and
   assembled into a single chronological transcript, trimmed to a context
   budget.
3. The transcript is sent to Ollama's `/api/chat` with a fixed triage prompt;
   the response streams back into the panel.
4. Generation runs in the background page, so closing the popup does not
   cancel it; the finished summary is cached for the session.

## Development

- `npm install` — dev tooling only (Vitest; the extension itself has zero
  runtime dependencies and no build step)
- `npm test` — 47 unit tests over the pure logic modules
- Load for development: **Tools → Developer Tools → Debug Add-ons → Load
  Temporary Add-on…** → select `manifest.json`
- Manual end-to-end checklist: [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Privacy

Email content is sent exclusively to the configured Ollama endpoint. Summaries
are held in extension session storage and cleared when Thunderbird quits.
Settings contain no personal data. The extension requests only `messagesRead`,
`storage`, and host access to `localhost`/`127.0.0.1:11434`.

## License

[Mozilla Public License 2.0](LICENSE) © capazme
