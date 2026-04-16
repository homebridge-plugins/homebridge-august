/* Copyright(C) 2017-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * index.ts: homebridge-august.
 */
import type { API, Logging } from 'homebridge'

import type { AugustPlatformConfig } from './settings.js'

import { AugustMatterPlatform } from './platform.matter.js'
import { AugustPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

// Register our platform with homebridge.
export default (api: API): void => {
  // The proxy constructor returns the appropriate platform instance based on Matter availability.
  // The `as any` cast is required because TypeScript cannot type-check the constructor return
  // overriding pattern used for runtime platform selection (same pattern as homebridge-switchbot).
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, createAugustPlatformProxy() as any)
}

/**
 * Creates a proxy constructor that selects between the Matter and HAP platform
 * implementations at runtime based on Matter availability and configuration.
 *
 * - If Matter is available, enabled, and `options.disableMatter` is not `true`
 *   → instantiates `AugustMatterPlatform`
 * - Otherwise → instantiates `AugustPlatform` (HAP/legacy)
 */
function createAugustPlatformProxy() {
  return class AugustPlatformProxy {
    constructor(log: Logging, config: AugustPlatformConfig, api: API) {
      const disableMatter = config?.options?.disableMatter === true
      const matterAvailable = !!(api?.isMatterAvailable?.() && api?.isMatterEnabled?.())

      if (!disableMatter && matterAvailable) {
        return new AugustMatterPlatform(log, config, api)
      }

      return new AugustPlatform(log, config, api)
    }
  }
}
