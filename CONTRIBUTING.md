# Contributing

Thanks for your interest in improving Thread Summarizer!

## Development setup

```bash
npm install      # dev tooling only (Vitest); the extension has zero runtime deps
npm test         # run the unit suite
npm run package  # build dist/tb-thread-summarizer-<version>.xpi
```

Load the extension in Thunderbird via **Tools → Developer Tools → Debug
Add-ons → Load Temporary Add-on…** and select `manifest.json`.

## Ground rules

- **Privacy is the product.** The only network host the extension may contact
  is the user-configured local Ollama endpoint. No telemetry, no third-party
  calls, no bundled runtime dependencies.
- **Small, tested modules.** Logic lives in focused ES modules under `lib/`,
  each unit-tested. Thunderbird APIs and `fetch` are injected so tests never
  touch the real environment.
- **TDD.** Add or update a test in `tests/` before changing behavior. Keep the
  suite green (`npm test`) and its output pristine.
- **Conventional Commits.** Commit messages follow
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
  `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Reporting bugs

Open an issue including your Thunderbird version, Ollama version, the model you
used, and the exact error shown in the popup (or in the background console via
Debug Add-ons).
