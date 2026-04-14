import type { API } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import registerPlatform from './index.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

describe('registerPlatform', () => {
  it('should register a platform proxy with homebridge', () => {
    const api = {
      registerPlatform: vi.fn(),
      isMatterAvailable: vi.fn(() => false),
      isMatterEnabled: vi.fn(() => false),
    } as unknown as API

    registerPlatform(api)

    expect(api.registerPlatform).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, expect.any(Function))
  })

  it('should instantiate AugustPlatform (HAP) when Matter is not available', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() } as any
    const config = { platform: 'August', name: 'Test', credentials: { augustId: 'a', password: 'b', countryCode: 'US', isValidated: false } } as any
    const api = {
      registerPlatform: vi.fn(),
      isMatterAvailable: vi.fn(() => false),
      isMatterEnabled: vi.fn(() => false),
      hap: { uuid: { generate: vi.fn(() => 'mock-uuid') } },
      on: vi.fn(),
      user: { configPath: vi.fn(() => '/mock/config.json') },
    } as unknown as API

    let registeredCtor: any
    vi.mocked(api.registerPlatform).mockImplementation((_plugin, _platform, ctor) => {
      registeredCtor = ctor
    })

    registerPlatform(api)
    const instance = new registeredCtor(log, config, api)

    // Should be an AugustPlatform instance (HAP) when Matter is unavailable
    expect(instance).toBeDefined()
    expect(instance.constructor.name).toBe('AugustPlatform')
  })

  it('should instantiate AugustMatterPlatform when Matter is available and enabled', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() } as any
    const config = { platform: 'August', name: 'Test', credentials: { augustId: 'a', password: 'b', countryCode: 'US', isValidated: false } } as any
    const api = {
      registerPlatform: vi.fn(),
      isMatterAvailable: vi.fn(() => true),
      isMatterEnabled: vi.fn(() => true),
      hap: { uuid: { generate: vi.fn(() => 'mock-uuid') } },
      matter: {
        uuid: { generate: vi.fn(() => 'mock-matter-uuid') },
        deviceTypes: { DoorLock: {} },
        updateAccessoryState: vi.fn(),
        registerPlatformAccessories: vi.fn(),
        unregisterPlatformAccessories: vi.fn(),
      },
      on: vi.fn(),
      user: { configPath: vi.fn(() => '/mock/config.json') },
    } as unknown as API

    let registeredCtor: any
    vi.mocked(api.registerPlatform).mockImplementation((_plugin, _platform, ctor) => {
      registeredCtor = ctor
    })

    registerPlatform(api)
    const instance = new registeredCtor(log, config, api)

    // Should be an AugustMatterPlatform instance when Matter is available
    expect(instance).toBeDefined()
    expect(instance.constructor.name).toBe('AugustMatterPlatform')
  })

  it('should fall back to AugustPlatform (HAP) when disableMatter is true', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() } as any
    const config = {
      platform: 'August',
      name: 'Test',
      credentials: { augustId: 'a', password: 'b', countryCode: 'US', isValidated: false },
      options: { disableMatter: true },
    } as any
    const api = {
      registerPlatform: vi.fn(),
      isMatterAvailable: vi.fn(() => true),
      isMatterEnabled: vi.fn(() => true),
      hap: { uuid: { generate: vi.fn(() => 'mock-uuid') } },
      matter: {
        uuid: { generate: vi.fn(() => 'mock-matter-uuid') },
        deviceTypes: { DoorLock: {} },
        updateAccessoryState: vi.fn(),
        registerPlatformAccessories: vi.fn(),
        unregisterPlatformAccessories: vi.fn(),
      },
      on: vi.fn(),
      user: { configPath: vi.fn(() => '/mock/config.json') },
    } as unknown as API

    let registeredCtor: any
    vi.mocked(api.registerPlatform).mockImplementation((_plugin, _platform, ctor) => {
      registeredCtor = ctor
    })

    registerPlatform(api)
    const instance = new registeredCtor(log, config, api)

    // Should be AugustPlatform (HAP) when disableMatter is true
    expect(instance).toBeDefined()
    expect(instance.constructor.name).toBe('AugustPlatform')
  })
})

