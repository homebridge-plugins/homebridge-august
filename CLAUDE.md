# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — `rimraf ./dist && tsc && npm run plugin-ui`. The `plugin-ui` step rsyncs `src/homebridge-ui/public/index.html` into `dist/` (the UI server itself is TypeScript and compiled by `tsc`). Skipping it produces a broken published package.
- `npm run lint` — ESLint over the whole repo with `--max-warnings=0`. CI fails on any warning. `npm run lint:fix` to autofix.
- `npm test` — vitest, test files live in `test/` (configured in `vitest.config.ts`). `npm run test:watch` and `npm run test-coverage` also available.
- `npm run watch` — build, `npm link`, then `nodemon`: recompiles and restarts `homebridge -U ./test/hbConfig -D` on `src/**/*.ts` changes. `./test/hbConfig` is gitignored; create it locally with a `config.json` containing August credentials.
- `npm run docs` — typedoc into `docs/` (gitignored — generated output is never committed).
- `npm run prepublishOnly` — lint then build; runs automatically on publish.

CI (`.github/workflows/build.yml`) runs install + lint on Node 22.x/24.x. Releases publish via `.github/workflows/release.yml`: a GitHub release (tag `vX.Y.Z`) publishes to npm's `latest` tag; pushes to `beta-X.Y.Z` / `alpha-X.Y.Z` branches publish incrementing prerelease versions to the `beta` / `alpha` tags.

Supported Node: `^22.12.0 || ^24.0.0`. Homebridge: `^2.0.0`.

## Architecture

Homebridge dynamic platform plugin (`platform: "August"`, package `@homebridge-plugins/homebridge-august`) bridging August and Yale locks into HomeKit via the August cloud API (the [august-yale](https://github.com/bdraco/august-yale) package).

### HAP/Matter platform selection (`src/index.ts`)

Registers a proxy constructor: `AugustMatterPlatform` (`src/platform.matter.ts`, extends `AugustPlatform`) is used automatically when Homebridge reports Matter available+enabled, unless `options.disableMatter` is set; otherwise the HAP `AugustPlatform` (`src/Platform.HAP.ts`). Note the auto-on default — the opposite of some sibling plugins where Matter is opt-in.

### Authentication

First run: the user configures their August e-mail/phone, restarts, August sends a verification code, the user enters it in the plugin settings and restarts again (`validateCode` flow in `Platform.HAP.ts`). Credentials are normalised by the platform and passed to `august-yale`'s `August` client.

### Connectivity manager (`src/connectivity-manager.ts`)

All August API calls should go through `this.connectivity.execute()` rather than calling the client directly — it classifies failures (`InvalidAuth`, `NetworkError`, `TimeoutError`, `AbortedError`) and drives a `healthy → degraded → offline → recovering` state machine with a backoff probe schedule (5s→300s) and an offline heartbeat. It rebuilds the `August` client on credential changes and re-authenticates on `InvalidAuth`. Locks subscribe to state changes to mark accessories unresponsive/responsive.

### Device classes (`src/devices/`)

`deviceBase` (`src/devices/device.ts`) wires per-device config (logging level, refresh/update/push rates) and the AccessoryInformation service. `LockMechanism` (`src/devices/lock.ts`) implements the lock, doorbell-adjacent contact sensor (DoorSense) and battery services. The HAP platform keeps instances in its `lockMechanisms` map keyed by accessory UUID. Lock state updates arrive via subscription pushes and a polling loop (`pollTimer` in `Platform.HAP.ts`).

### Logging

The platform and `deviceBase` expose leveled log helpers (`infoLog`, `warnLog`, `errorLog`, `debugLog`, …) gated by `config.options.logging` with per-device `logging` overrides. Use these instead of `this.log` directly so user log settings are respected.

## Conventions

- TypeScript ESM (`"type": "module"`): relative imports use `.js` extensions even from `.ts` source.
- ESLint is `@antfu/eslint-config` (flat config in `eslint.config.js`): single quotes, 1tbs braces, `curly` multi-line only, sorted exports. Run `npm run lint:fix` before committing.
- `config.schema.json` defines the Homebridge UI form and must stay in sync with the interfaces in `src/settings.ts` (`AugustPlatformConfig`, `devicesConfig`, `options`, `credentials`).
- Timer fields use `ReturnType<typeof setTimeout>` / `ReturnType<typeof setInterval>`, not `NodeJS.Timeout` (the lint setup has no Node globals).
- Copyright headers in `src/` credit @donavanbecker, the original plugin author — leave them in place.
