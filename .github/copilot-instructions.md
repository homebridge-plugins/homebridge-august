# Copilot instructions

Guidance for AI coding agents working in this repository. The fuller version of this document is [CLAUDE.md](../CLAUDE.md) at the repo root — keep the two in sync.

## Commands

- Build: `npm run build` (`rimraf ./dist` → `tsc` → copy plugin UI html). All steps are required for a working package.
- Lint: `npm run lint` (`eslint . --max-warnings=0`, CI fails on warnings); `npm run lint:fix` to autofix.
- Test: `npm test` (vitest, test files in `test/`).
- Local dev loop: `npm run watch` (rebuild + restart `homebridge -U ./test/hbConfig -D` on changes; `./test/hbConfig` is gitignored, create locally).

## Key architecture facts

- Homebridge dynamic platform plugin bridging August/Yale locks into HomeKit via the August cloud API (`august-yale` package).
- `src/index.ts` registers a runtime proxy: the Matter platform (`src/platform.matter.ts`) is used automatically when Homebridge Matter is available+enabled unless `options.disableMatter` is set; otherwise the HAP platform (`src/Platform.HAP.ts`).
- Auth is a two-restart flow: e-mail/phone → August sends a verification code → user enters it → restart (`validateCode` in `Platform.HAP.ts`).
- Route August API calls through `this.connectivity.execute()` (`src/connectivity-manager.ts`) — it classifies failures and drives the healthy/degraded/offline/recovering state machine with backoff probes; don't call the client directly.
- `LockMechanism` (`src/devices/lock.ts`) extends `deviceBase`; the HAP platform keeps instances in its `lockMechanisms` map.
- Use the platform's leveled log helpers (`infoLog`, `debugLog`, …) so user logging settings are respected.

## Conventions

- TypeScript ESM: relative imports need `.js` extensions.
- ESLint `@antfu/eslint-config`: single quotes, sorted exports; run `npm run lint:fix` before committing.
- `config.schema.json` must stay in sync with the config interfaces in `src/settings.ts`.
- Timer fields use `ReturnType<typeof setTimeout>` / `ReturnType<typeof setInterval>`, not `NodeJS.Timeout`.
- Copyright headers in `src/` credit @donavanbecker (original author) — leave them in place.
