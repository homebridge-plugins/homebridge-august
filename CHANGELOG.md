## v3.2.3 (Pending Release)

### Changed

- chore(deps): update dependencies

## [3.2.3](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.2.3) (2026-05-04)

### Bug Fixes

* **platform:** align platform filename/import casing for ESM paths on case-sensitive systems ([974768a](https://github.com/homebridge-plugins/homebridge-august/commit/974768a6c2de6a5682b1d06e60f62bcbc7933841))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.2.2...v3.2.3

## [3.2.2](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.2.2) (2026-05-03)

### Bug Fixes

* bump package.json deps ([60b5cf2](https://github.com/homebridge-plugins/homebridge-august/commit/60b5cf2032b9f5da9089019b8ca22b1fcdfd9e05))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.2.1...v3.2.2

## [3.2.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.2.1) (2026-04-30)

### Bug Fixes

* **platform:** probe with a fresh client; add offline heartbeat ([682c68b](https://github.com/homebridge-plugins/homebridge-august/commit/682c68bcbd7d86fb9df350ab0ccac9a07d3e1e2b))
* **platform:** use August.resetTransport() for connectivity recovery ([6ea4f34](https://github.com/homebridge-plugins/homebridge-august/commit/6ea4f34cb710cbff333e71d84b048bb61d34ea64))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.2.0...v3.2.1

# [3.2.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.2.0) (2026-04-29)

### Bug Fixes

* **platform:** use august-yale's typed exceptions for error classification ([93219ac](https://github.com/homebridge-plugins/homebridge-august/commit/93219accdf8571330b8f3fefa029d727ddf7a6c3))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.1.4...v3.2.0

## [3.1.4](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.1.4) (2026-04-27)

### Bug Fixes

* **platform:** destroy August client on session refresh instead of end() ([a12f2b3](https://github.com/homebridge-plugins/homebridge-august/commit/a12f2b328263523eef3b2549383f00ce6dfbf0a1))

### Features

* **lock:** wire PubNub reconnect signal into ConnectivityManager ([462b22c](https://github.com/homebridge-plugins/homebridge-august/commit/462b22c5b53e125d3ec31eceea538a74360f5760))
* **platform:** add ConnectivityManager (unwired) ([6377ac4](https://github.com/homebridge-plugins/homebridge-august/commit/6377ac435320aa884e82b32f25f163b2bd9fde6a))
* **platform:** platform-level serial poller, drop per-lock interval/retry ([aa973a4](https://github.com/homebridge-plugins/homebridge-august/commit/aa973a4e46cd4252f335a5c6988f94148cafefbf))
* **platform:** route pushChanges through ConnectivityManager ([41080f4](https://github.com/homebridge-plugins/homebridge-august/commit/41080f490cd71b504e22f56a80ae6e1c8c9eb016))
* **platform:** wire ConnectivityManager into AugustPlatform ([0ce28e3](https://github.com/homebridge-plugins/homebridge-august/commit/0ce28e359a68720ed278e17097f61262ea8705b4))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.1.3...v3.1.4

## [3.1.3](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.1.3) (2026-04-18)

### Bug Fixes

* update dependencies ([ed90943](https://github.com/homebridge-plugins/homebridge-august/commit/ed9094358ab9ec6f724df58c1d98d38cee7db751))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.1.2...v3.1.3

## [3.1.2](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.1.2) (2026-04-18)

### Bug Fixes

* broaden engines.homebridge to support v1.x ([3d5cb8d](https://github.com/homebridge-plugins/homebridge-august/commit/3d5cb8d06b11e9a9b1e0d1111d372ef6e659d523))
* detect august-yale TimeoutError by error.name instead of message string ([03587f1](https://github.com/homebridge-plugins/homebridge-august/commit/03587f1c8e06d8ad41dd8d82a6852f67fb9803df))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.1.1...v3.1.2

## [3.1.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.1.1) (2026-04-16)

### Bug Fixes

* Matter quality, CI gating, lint coverage, and TypeScript strictness ([#210](https://github.com/homebridge-plugins/homebridge-august/issues/210)) ([67d44fe](https://github.com/homebridge-plugins/homebridge-august/commit/67d44febd15ff8467a73458b262dad620235cfaa))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.1.0...v3.1.1

## [3.1.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.1.0) (2026-04-16)

### What's Changes
- Feature: Add Matter support — introduce `AugustMatterPlatform` to register Matter DoorLock accessories via `api.matter`; add a platform proxy to select Matter at runtime when available, include Matter polling and PubNub handling. The existing HAP `AugustPlatform` remains as the fallback.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.11...v3.1.0

## [3.0.11](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.11) (2026-04-16)

### What's Changes
- Bug Fix: add cooldown to session refresh to prevent wasted refreshes (#209)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.10...v3.0.11

## [3.0.10](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.10) (2026-04-15)

### What's Changes
- Bug Fix: capture PubNub unsubscribe function to prevent memory leak (#206)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.9...v3.0.10

## [3.0.9](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.9) (2026-04-02)

### What's Changes
- Bug Fix: prevent 502 errors from cascading across all locks (#201)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.8...v3.0.9

## [3.0.8](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.8) (2026-03-28)

### What's Changes
- Bug Fix: align context key reads with updateCharacteristic writes (#199)
- Bug Fix: prevent lock commands from being dropped and resolve startup warnings (#200)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.7...v3.0.8

## [3.0.7](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.7) (2026-03-25)

### What's Changes
- Bug Fix: resolve lock showing "Locking..." on startup due to undefined lockEvent (#197)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.6...v3.0.7

## [3.0.6](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.6) (2026-03-25)

### What's Changes
- Feature: add `excludeLockIds` option to exclude locks by ID (#196)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.5...v3.0.6

## [3.0.5](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.5) (2026-02-20)

### What's Changes
- Fix: Suppress spurious HomeKit notifications on startup (#194)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.4...v3.0.5

## [3.0.4](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.4) (2026-02-09)

### What's Changes
- Fix: Handle 502/503/401 errors as session expiration requiring retry (#191)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.3...v3.0.4

## [3.0.3](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.3) (2026-09-03)

### What's Changes
#### Other Changes
- Fix HTTP 422 error handling and improve status code messaging @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#163]
- ✨ Update Copilot instructions with beta branch workflow @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#162]
- ✨ Set up Copilot instructions for homebridge-august repository @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#157]
- Enable Node.js 24 support by upgrading homebridge-config-ui-x @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#160]

#### Featured Changes

- v3.0.3 @donavanbecker [#168]
- Fix TypeScript compilation error: remove duplicate 'default' property in august-yale mock @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#172]
- Enhanced country code normalization with comprehensive configuration and multi-region support @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#167]
- Fix "Cannot set properties of undefined" error in validated() method when credentials are missing @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#170]
- Fix AggregateError handling in device statusCode method @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#164]
- Fix August API ETIMEDOUT errors after 24 hours with session refresh and retry logic @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#166]
- Fix: Add null safety for doorState property to prevent crash with Yale Assure Lock 2 @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#165]
- Fix 401 authentication error with automatic re-authentication during device discovery @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#155]
- Fix false "lock was opened" logging by correcting context key construction @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#158]

## Bug Fixes

- Fix AggregateError handling in device statusCode method @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#164]
- Fix August API ETIMEDOUT errors after 24 hours with session refresh and retry logic @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#166]
- Fix: Add null safety for doorState property to prevent crash with Yale Assure Lock 2 @[copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent) [#165]

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.2...v3.0.3

## [3.0.2](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.2) (2025-03-05)

### What's Changes
- Housekeeping and updated dependencies.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.1...v3.0.2

## [3.0.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.1) (2025-01-25)

### What's Changes
- update LockTargetState to match LockCurrentState during lock refresh (#144)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v3.0.0...v3.0.1

## [3.0.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v3.0.0) (2025-01-17)

### What's Changes
- Major release: v3.0.0 (see full changelog)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.9...v3.0.0

## [2.2.9](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.9) (2024-11-05)

### What's Changes
- Updated core runtime files: `src/devices/device.ts` and `src/platform.ts`.
- Refreshed generated docs output and dependency lockfile metadata.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.8...v2.2.9

## [2.2.8](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.8) (2024-11-04)

### What's Changes
- Updated automation and repository ops config (`.github/workflows/*`, issue template config, release tooling).
- Refined plugin runtime/config surfaces: `src/index.ts`, `src/platform.ts`, `src/devices/device.ts`, `src/settings.ts`, and `config.schema.json`.
- Refreshed docs and build/tooling inputs (`README.md`, `docs/*`, `tsconfig.json`, package metadata).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.7...v2.2.8

## [2.2.7](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.7) (2024-09-25)

### What's Changes
- Added TypeDoc generation setup (`typedoc.json`) and committed generated docs (`docs/*`).
- Updated runtime implementation across `src/platform.ts`, `src/devices/device.ts`, `src/devices/lock.ts`, `src/homebridge-ui/server.ts`, and `src/settings.ts`.
- Updated plugin schema/UI/tooling (`config.schema.json`, `src/homebridge-ui/public/index.html`, `eslint.config.js`, `nodemon.json`, package metadata).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.6...v2.2.7

## [2.2.6](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.6) (2024-06-24)

### What's Changes
- Narrow update to `src/devices/lock.ts`.
- Dependency/lockfile refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.5...v2.2.6

## [2.2.5](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.5) (2024-06-23)

### What's Changes
- Updated runtime behavior in `src/devices/lock.ts`, `src/platform.ts`, and `src/settings.ts`.
- Updated Homebridge UI page in `src/homebridge-ui/public/index.html`.
- Dependency refresh and VS Code workspace settings updates.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.4...v2.2.5

## [2.2.4](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.4) (2024-06-23)

### What's Changes
- Updated lock parsing/handling logic in `src/devices/lock.ts` to address restart-prone behavior.
- Dependency and lockfile refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.3...v2.2.4

## [2.2.3](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.3) (2024-06-23)

### What's Changes
- Narrow runtime update in `src/devices/device.ts`.
- Dependency/lockfile refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.2...v2.2.3

## [2.2.2](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.2) (2024-06-23)

### What's Changes
- Small runtime change in `src/platform.ts`.
- Updated config surface in `config.schema.json`.
- Dependency/lockfile refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.1...v2.2.2

## [2.2.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.1) (2024-06-23)

### What's Changes
- Large runtime update across `src/devices/device.ts`, `src/devices/lock.ts`, and `src/platform.ts`.
- Updated exposed plugin options/schema in `config.schema.json`.
- Dependency/lockfile refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.2.0...v2.2.1

## [2.2.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.2.0) (2024-05-25)

### What's Changes
- Adopted flat ESLint config via new `eslint.config.js`.
- Updated runtime modules: `src/platform.ts`, `src/index.ts`, `src/devices/device.ts`, `src/devices/lock.ts`, `src/settings.ts`, and `src/homebridge-ui/server.ts`.
- Updated plugin schema/config and dependency graph (`config.schema.json`, package metadata).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.1.0...v2.2.0

## [2.1.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.1.0) (2024-05-08)

### What's Changes
- Added `src/devices/device.ts` and refactored runtime logic to use it alongside updates in `src/devices/lock.ts`, `src/platform.ts`, and `src/index.ts`.
- Updated Homebridge UI backend in `src/homebridge-ui/server.ts` and configuration handling in `src/settings.ts`.
- Tooling/CI maintenance: ESLint config migration (`.eslintrc` -> `.eslintrc.json`) and workflow updates.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v2.0.0...v2.1.0

## [2.0.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v2.0.0) (2024-01-31)

### What's Changes
- Migrated Homebridge UI server from JS to TS (`homebridge-ui/server.js` removed, `src/homebridge-ui/server.ts` added).
- Moved UI static entry into source tree (`homebridge-ui/public/index.html` -> `src/homebridge-ui/public/index.html`).
- Broad TypeScript/runtime refresh across `src/index.ts`, `src/platform.ts`, `src/devices/lock.ts`, `src/settings.ts`, `config.schema.json`, and `tsconfig.json`.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.3.4...v2.0.0

## [1.3.4](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.3.4) (2024-01-16)

### What's Changes
- Updated plugin runtime logic in `src/platform.ts`.
- Repository automation updates (workflow changes, new `changerelease.yml`, Discord webhook workflow).
- Dependency and licensing metadata refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.3.3...v1.3.4

## [1.3.3](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.3.3) (2023-12-15)

### What's Changes
- Updated package/dependency versions and lockfile.
- Refreshed branding asset (`branding/icon.png`) and workspace settings.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.3.2...v1.3.3

## [1.3.2](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.3.2) (2023-11-26)

### What's Changes
- Updated package publishing metadata (`.npmignore`) and docs (`README.md`).
- Reorganized branding assets (`august/Homebridge_x_August.svg` -> `branding/Homebridge_x_August.svg`) and added `branding/icon.png`.
- Updated Homebridge UI page and package dependencies.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.3.1...v1.3.2

## [1.3.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.3.1) (2023-11-08)

### What's Changes
- Updated runtime logic in `src/platform.ts`.
- Updated plugin configuration in `config.schema.json`.
- Dependency/lockfile refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.3.0...v1.3.1

## [1.3.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.3.0) (2023-11-01)

### What's Changes
- Runtime updates across `src/platform.ts`, `src/devices/lock.ts`, and `src/settings.ts`.
- Updated plugin configuration schema in `config.schema.json`.
- Tooling/config cleanup: removed `.prettierrc`, updated package metadata.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.2.1...v1.3.0

## [1.2.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.2.1) (2023-08-28)

### What's Changes
- Dependency maintenance update (`package.json`/`package-lock.json`).
- Updated Dependabot configuration.
- No runtime `src/*` code changes.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.2.0...v1.2.1

## [1.2.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.2.0) (2023-08-19)

### What's Changes
- Updated runtime modules `src/platform.ts` and `src/devices/lock.ts`.
- Updated plugin options/UI surfaces (`config.schema.json`, `homebridge-ui/public/index.html`).
- Updated tooling/dependencies (`nodemon.json`, package metadata).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.1.1...v1.2.0

## [1.1.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.1.1) (2023-04-08)

### What's Changes
- Package/dependency and lockfile refresh.
- No runtime `src/*` code changes.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.1.0...v1.1.1

## [1.1.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.1.0) (2022-12-08)

### What's Changes
- Large runtime update in `src/platform.ts`, `src/devices/lock.ts`, and `src/settings.ts`.
- Updated plugin configuration and UI (`config.schema.json`, `homebridge-ui/public/index.html`, `README.md`).
- Dependency refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.0.5...v1.1.0

## [1.0.5](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.5) (2022-10-10)

### What's Changes
- Runtime updates in `src/platform.ts` and `src/devices/lock.ts`.
- Dependency refresh.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.0.4...v1.0.5

## [1.0.4](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.4) (2022-10-07)

### What's Changes
- Added full repository automation and governance scaffolding (`.github/*` workflows/templates, Dependabot, funding).
- Added plugin entrypoint `src/index.ts` and updated `src/platform.ts`.
- Added project metadata and tooling files (`LICENSE`, `SECURITY.md`, `nodemon.json`, VS Code settings).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.0.3...v1.0.4

## [1.0.3](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.3) (2022-10-07)

### What's Changes
- No code changes between `v1.0.2` and `v1.0.3` (tag-only release).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.0.2...v1.0.3

## [1.0.2](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.2) (2022-10-07)

### What's Changes
- No code changes between `v1.0.1` and `v1.0.2` (tag-only release).

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.0.1...v1.0.2

## [1.0.1](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.1) (2022-10-07)

### What's Changes
- Added project tooling baseline: `.eslintrc`, `.prettierrc`, `tsconfig.json`, and `.gitignore`.
- Updated package metadata and lockfile to support the new lint/typecheck toolchain.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/v1.0.0...v1.0.1

## [1.0.0](https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.0) (2022-10-07)

### What's Changes
- Initial release

**Release**: https://github.com/homebridge-plugins/homebridge-august/releases/tag/v1.0.0
