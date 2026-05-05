# Copilot Instructions for Homebridge August Plugin

## Repository Overview

This repository is a Homebridge dynamic platform plugin for August and Yale locks.

- Runtime uses TypeScript + ES modules.
- The plugin supports a dual runtime path:
  - HAP path via AugustPlatform.
  - Matter path via AugustMatterPlatform when Homebridge Matter is available and enabled.

## Current Architecture

- Plugin type: dynamic platform plugin.
- Entry point: src/index.ts.
- HAP platform class: src/Platform.HAP.ts (AugustPlatform).
- Matter platform class: src/Platform.Matter.ts (AugustMatterPlatform).
- Shared device logic: src/devices/device.ts and src/devices/lock.ts.
- Connectivity state machine: src/connectivity-manager.ts.
- Config/types/constants: src/settings.ts.
- UI backend/static assets: src/homebridge-ui/.

The entry point in src/index.ts registers a proxy constructor that selects Matter or HAP at runtime based on:
- api.isMatterAvailable()
- api.isMatterEnabled()
- config.options.disableMatter

## Toolchain and Runtime

Use the values from package.json and tsconfig.json as source of truth.

- Node support: ^22 || ^24
- Homebridge support: ^2.0.0
- TypeScript target: ES2022
- Module: ES2022
- Module resolution: bundler
- Strict mode: enabled (noImplicitAny is false)

## Commands

### Build and Packaging

```bash
npm run clean
npm run build
npm run prepublishOnly
```

### Lint

```bash
npm run lint
npm run lint:fix
```

### Test

```bash
npm test
npm run test:watch
npm run test-coverage
```

### Docs

```bash
npm run docs
npm run docs:lint
```

### Development

```bash
npm run watch
npm run plugin-ui
```

## Branch and Release Workflow

This repo follows a beta-first workflow.

- Do not target main directly.
- Target a beta branch named beta-X.Y.Z.
- Use issue labels to determine bump type:
  - patch
  - minor
  - major

If no matching beta branch exists, create one from the next expected version.

## Coding Expectations

1. Keep imports as ES module paths ending in .js.
2. Preserve Homebridge plugin constants:
   - PLATFORM_NAME = August
   - PLUGIN_NAME = homebridge-august
3. Maintain backward compatibility unless issue scope is explicitly breaking.
4. Keep runtime and schema aligned:
   - Update src/settings.ts and config.schema.json together for option changes.
5. Add or update Vitest coverage for behavior changes.
6. Never commit generated output from dist/.

## Homebridge and August/Yale Patterns

- Use Homebridge DynamicPlatformPlugin patterns for lifecycle methods.
- Use PlatformAccessory caching and proper unregister/update behavior.
- Handle August auth and refresh flows defensively.
- Respect polling and push/update intervals from options.
- Prefer robust error classification and graceful retries over broad catch-and-ignore.

## Matter and HomeKit Integration

### Matter Implementation

The plugin uses a dual-mode runtime that selects HAP or Matter at startup.

- HAP mode (HomeKit Accessory Protocol): implemented by AugustPlatform in src/Platform.HAP.ts.
- Matter mode: implemented by AugustMatterPlatform in src/Platform.Matter.ts.

In src/index.ts, the platform proxy chooses AugustMatterPlatform only when Matter is available and enabled, and the user has not disabled Matter via config.options.disableMatter. Otherwise it falls back to AugustPlatform.

### Matter Device Type Mapping

Matter registrations use api.matter.deviceTypes.* and api.matter.types.* from Homebridge's Matter API.

| August Device | HAP Service | Matter DeviceType | Matter Clusters |
|---|---|---|---|
| August/Yale lock | LockMechanism (plus optional ContactSensor in HAP mode) | DoorLock | doorLock |

Notes:
- AugustMatterPlatform currently maps lock accessories to Matter DoorLock.
- Lock state updates are written through the doorLock cluster (for example lockState) and mirrored from August API polling/push updates.

### Authoritative Matter References

1. https://matter-js.github.io/docs/index.html
2. https://github.com/homebridge-plugins/homebridge-matter

For cluster, attribute, deviceType, and conversion details, use the homebridge-matter wiki:
- Introduction: https://github.com/homebridge-plugins/homebridge-matter/wiki/Introduction
- Core Concepts: https://github.com/homebridge-plugins/homebridge-matter/wiki/Core-Concepts
- Getting Started: https://github.com/homebridge-plugins/homebridge-matter/wiki/Getting-Started
- State Management: https://github.com/homebridge-plugins/homebridge-matter/wiki/State-Management
- Monitoring External Changes: https://github.com/homebridge-plugins/homebridge-matter/wiki/Monitoring-External-Changes
- Best Practices: https://github.com/homebridge-plugins/homebridge-matter/wiki/Best-Practices
- Advanced Patterns: https://github.com/homebridge-plugins/homebridge-matter/wiki/Advanced-Patterns
- API Reference: https://github.com/homebridge-plugins/homebridge-matter/wiki/API-Reference
- Matter Types: https://github.com/homebridge-plugins/homebridge-matter/wiki/Matter-Types
- Value Conversions: https://github.com/homebridge-plugins/homebridge-matter/wiki/Value-Conversions

Device reference pages:
- Sensors (Section 7): https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-7-Sensors
- Closure (Section 8): https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-8-Closure

## Testing Guidelines

- Test files live under test/ with .test.ts suffix.
- Mock external dependencies:
  - august-yale
  - file system
  - Homebridge API surfaces
- Cover:
  - startup and discovery
  - polling loops
  - push/pull state sync
  - Matter fallback behavior
  - error paths and retries

## Files to Avoid Editing Directly

- dist/
- node_modules/
- docs/ generated output unless intentionally regenerating docs

## Changelog Requirements

When adding a release entry to CHANGELOG.md:

1. Header format:

```md
## [X.Y.Z](https://github.com/homebridge-plugins/homebridge-august/releases/tag/vX.Y.Z) (YYYY-MM-DD)
```

2. Add sections as needed (for example Bug Fixes, Features, Documentation).

3. Include a trailing full changelog comparison line:

```md
**Full Changelog**: https://github.com/homebridge-plugins/homebridge-august/compare/vX.Y.(Z-1)...vX.Y.Z
```

4. Ensure commit links point to this repository:
- https://github.com/homebridge-plugins/homebridge-august/commit/<sha>

## Security and Privacy

- Never log secrets (passwords, tokens, validation codes).
- Avoid exposing sensitive values in thrown errors.
- Validate user-supplied config inputs before use.
