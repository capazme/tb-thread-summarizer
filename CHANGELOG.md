# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-07-14

### Fixed
- Italian singular/plural for the message count in the panel: it now shows
  "1 messaggio" instead of "1 messaggi" (and "N messaggi" for N > 1), in both
  the generation phase line and the summary meta line.

[0.1.2]: https://github.com/capazme/tb-thread-summarizer/releases/tag/v0.1.2

## [0.1.1] - 2026-07-14

### Changed
- The "Ollama unreachable" error panel now explains both possible causes —
  Ollama not started, or started without extension permission — and shows the
  `OLLAMA_ORIGINS` command inline. A CORS rejection surfaces in the browser as
  a generic network error, so the two cases cannot be told apart at runtime;
  the message now covers both instead of asserting Ollama is down.

### Added
- `scripts/persist-ollama-origins-macos.sh`: installs a per-user LaunchAgent so
  `OLLAMA_ORIGINS` survives macOS reboots. Referenced from the README and the
  options page.

[0.1.1]: https://github.com/capazme/tb-thread-summarizer/releases/tag/v0.1.1

## [0.1.0] - 2026-07-14

Initial release.

### Added
- Message-header button ("Riassumi thread") that summarizes the thread of the
  displayed message using a local Ollama model.
- Structured Italian triage output: summary, key points, actions & deadlines,
  and who is waiting for a reply.
- Streaming rendering in a popup panel; generation runs in the background and
  survives the popup being closed.
- Per-thread session cache (never written to disk); instant re-open of an
  already-summarized thread.
- Thread reconstruction via `References`/`In-Reply-To` headers plus a
  normalized-subject heuristic, with an explicit cap on message count.
- Options page: configurable endpoint, model picker populated from the models
  installed in Ollama, thread-size limit, and a connection test.
- Actionable error states for the known failure modes (Ollama unreachable,
  CORS / `OLLAMA_ORIGINS`, missing model, missing host permission, timeout).
- 47 unit tests covering the pure logic modules (thread building, content
  extraction, NDJSON streaming, prompt budgeting, error mapping, cache).

[0.1.0]: https://github.com/capazme/tb-thread-summarizer/releases/tag/v0.1.0
