/* Copyright(C) 2017-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * index.ts: homebridge-august.
 */
import type { API, Logging, PlatformConfig } from 'homebridge'

import { AugustPlatform } from './platform.js'
import { AugustMatterPlatform } from './platform.matter.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

// Register our platform with homebridge.
// Create a proxy constructor that selects the appropriate platform implementation
function createAugustPlatformProxy(api: API) {
  return function AugustPlatformProxy(log: Logging, config: PlatformConfig, apiInner: API) {
    const disableMatter = config?.options?.disableMatter

    if (api.isMatterAvailable?.() && api.isMatterEnabled?.() && !disableMatter) {
      return new AugustMatterPlatform(log, config, apiInner)
    }

    return new AugustPlatform(log, config, apiInner)
  }
}

// Register our platform proxy with homebridge.
export default (api: API): void => {
  // Type cast to any because we return a dynamic constructor that delegates
  // to either `AugustPlatform` or `AugustMatterPlatform` at runtime.
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, createAugustPlatformProxy(api) as unknown as any)
}
