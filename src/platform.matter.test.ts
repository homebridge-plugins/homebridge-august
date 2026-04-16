/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.matter.test.ts: homebridge-august Matter platform tests.
 */
import type { API, Logging, MatterAccessory, PlatformAccessory } from 'homebridge'

import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import August from 'august-yale'
import { AugustMatterPlatform } from './platform.matter.js'
import type { AugustPlatformConfig } from './settings.js'

// Mock the august-yale module
vi.mock('august-yale', () => {
  const MockAugust = vi.fn().mockImplementation(() => ({
    end: vi.fn(),
    lock: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn().mockResolvedValue(undefined),
    details: vi.fn(),
  }))

  const MockConstructor = MockAugust as any
  MockConstructor.details = vi.fn()
  MockConstructor.authorize = vi.fn()
  MockConstructor.validate = vi.fn()
  MockConstructor.subscribe = vi.fn().mockResolvedValue(() => {}) // returns unsubscribe fn by default

  return {
    default: MockConstructor,
  }
})

// Mock file system
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

describe('AugustMatterPlatform', () => {
  let platform: AugustMatterPlatform
  let mockApi: API
  let mockLog: Logging
  let mockConfig: AugustPlatformConfig
  let mockMatterApi: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockMatterApi = {
      uuid: { generate: vi.fn((id: string) => `matter-uuid-${id}`) },
      deviceTypes: { DoorLock: { deviceType: 11 } },
      types: {
        DoorLock: {
          LockState: {
            NotFullyLocked: 0,
            Locked: 1,
            Unlocked: 2,
          },
        },
      },
      registerPlatformAccessories: vi.fn().mockResolvedValue(undefined),
      updatePlatformAccessories: vi.fn().mockResolvedValue(undefined),
      unregisterPlatformAccessories: vi.fn().mockResolvedValue(undefined),
      updateAccessoryState: vi.fn().mockResolvedValue(undefined),
      getAccessoryState: vi.fn().mockResolvedValue(undefined),
    }

    mockApi = {
      hap: {
        uuid: { generate: vi.fn(() => 'hap-uuid') },
      },
      user: {
        configPath: vi.fn(() => '/mock/config.json'),
      },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      publishExternalAccessories: vi.fn(),
      isMatterAvailable: vi.fn(() => true),
      isMatterEnabled: vi.fn(() => true),
      matter: mockMatterApi,
    } as unknown as API

    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    } as any

    mockConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        augustId: 'test@example.com',
        password: 'testpassword',
        countryCode: 'US',
        installId: 'test-install-id',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      platforms: [mockConfig],
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('configureAccessory', () => {
    it('should stage (not immediately unregister) cached HAP accessories for deferred cleanup', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const hapAccessory = {
        UUID: 'hap-uuid-1',
        displayName: 'Front Door',
      } as unknown as PlatformAccessory

      await platform.configureAccessory(hapAccessory)

      // HAP accessory should NOT be unregistered immediately; deferred until Matter registration succeeds
      expect(mockApi.unregisterPlatformAccessories).not.toHaveBeenCalled()
    })

    it('should unregister staged HAP accessory after successful Matter registration', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const device = {
        lockId: 'lock-abc',
        LockName: 'Front Door',
        SerialNumber: 'SN123',
        skuNumber: 'AUG-SL05',
        currentFirmwareVersion: '1.2.3',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      // Stage a HAP accessory with UUID matching what matterApi.uuid.generate will return for this lockId
      const hapAccessory = {
        UUID: 'matter-uuid-lock-abc',
        displayName: 'Front Door',
      } as unknown as PlatformAccessory
      await platform.configureAccessory(hapAccessory)

      await (platform as any).Lock(device)

      // After Matter registration succeeds, the staged HAP accessory should be unregistered
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-august',
        'August',
        [hapAccessory],
      )
    })

    it('should not add HAP accessories to the accessories cache', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const hapAccessory = {
        UUID: 'hap-uuid-2',
        displayName: 'Back Door',
      } as unknown as PlatformAccessory

      await platform.configureAccessory(hapAccessory)

      // accessories array from the HAP base class should remain empty
      expect(platform.accessories).toHaveLength(0)
    })
  })

  describe('configureMatterAccessory', () => {
    it('should store Matter accessories in the matterAccessories map', () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const matterAccessory = {
        UUID: 'matter-uuid-lock1',
        displayName: 'Front Door',
        deviceType: { deviceType: 11 },
        serialNumber: 'ABC123',
        manufacturer: 'August Home Inc.',
        model: 'AUG-SL05',
        context: { lockId: 'lock1' },
      } as unknown as MatterAccessory

      platform.configureMatterAccessory(matterAccessory)

      expect(platform.matterAccessories.has('matter-uuid-lock1')).toBe(true)
      expect(platform.matterAccessories.get('matter-uuid-lock1')).toBe(matterAccessory)
    })
  })

  describe('Lock (Matter accessory registration)', () => {
    it('should register a new Matter DoorLock accessory when Matter API is available', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const device = {
        lockId: 'lock-abc',
        LockName: 'Front Door',
        SerialNumber: 'SN123',
        skuNumber: 'AUG-SL05',
        currentFirmwareVersion: '1.2.3',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      // Expose the protected Lock method for testing
      await (platform as any).Lock(device)

      expect(mockMatterApi.registerPlatformAccessories).toHaveBeenCalledOnce()
      const [pluginName, platformName, accessories] = mockMatterApi.registerPlatformAccessories.mock.calls[0]
      expect(pluginName).toBe('homebridge-august')
      expect(platformName).toBe('August')
      expect(accessories).toHaveLength(1)
      expect(accessories[0].deviceType).toBe(mockMatterApi.deviceTypes.DoorLock)
      expect(accessories[0].manufacturer).toBe('August Home Inc.')
      expect(accessories[0].serialNumber).toBe('SN123')
    })

    it('should restore an existing cached Matter accessory', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const uuid = 'matter-uuid-lock-abc'
      const cachedAccessory: MatterAccessory = {
        UUID: uuid,
        displayName: 'Front Door',
        deviceType: { deviceType: 11 } as any,
        serialNumber: 'SN123',
        manufacturer: 'August Home Inc.',
        model: 'AUG-SL05',
        context: { lockId: 'lock-abc' },
      }
      platform.configureMatterAccessory(cachedAccessory)

      const device = {
        lockId: 'lock-abc',
        LockName: 'Front Door',
        SerialNumber: 'SN123',
        skuNumber: 'AUG-SL05',
        currentFirmwareVersion: '1.2.3',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      // re-registers to update handlers
      expect(mockMatterApi.registerPlatformAccessories).toHaveBeenCalledOnce()
      // Should have logged the "Restoring" message
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Restoring existing Matter accessory'))
    })

    it('should unregister stale Matter accessory when device is hidden', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const uuid = 'matter-uuid-hidden-lock'
      mockMatterApi.uuid.generate.mockReturnValueOnce(uuid)

      const cachedAccessory: MatterAccessory = {
        UUID: uuid,
        displayName: 'Hidden Lock',
        deviceType: { deviceType: 11 } as any,
        serialNumber: 'SN456',
        manufacturer: 'August Home Inc.',
        model: 'AUG-SL05',
        context: { lockId: 'hidden-lock' },
      }
      platform.configureMatterAccessory(cachedAccessory)

      const device = {
        lockId: 'hidden-lock',
        LockName: 'Hidden Lock',
        SerialNumber: 'SN456',
        hide_device: true, // hidden device
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      // Should unregister the stale accessory
      expect(mockMatterApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-august',
        'August',
        [cachedAccessory],
      )
      expect(platform.matterAccessories.has(uuid)).toBe(false)
      expect(mockMatterApi.registerPlatformAccessories).not.toHaveBeenCalled()
    })

    it('should not register when Matter API is unavailable', async () => {
      const apiWithoutMatter = {
        ...mockApi,
        matter: null as any,
      }
      platform = new AugustMatterPlatform(mockLog, mockConfig, apiWithoutMatter as any)

      const device = {
        lockId: 'lock-xyz',
        LockName: 'Some Lock',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      expect(mockMatterApi.registerPlatformAccessories).not.toHaveBeenCalled()
    })

    it('should set initial lockState to 0 (NotFullyLocked) until first poll resolves', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const device = {
        lockId: 'lock-nullstate',
        LockName: 'Null State Lock',
        SerialNumber: 'SN789',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      const registeredAccessory = mockMatterApi.registerPlatformAccessories.mock.calls[0][2][0] as MatterAccessory
      expect(registeredAccessory.clusters?.doorLock?.lockState).toBe(0)
    })
  })

  describe('fetchAndUpdateMatterLockState', () => {
    it('should update lockState to 1 (Locked) when lock is locked', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: true, unlocked: false } } }
      platform.augustConfig = {
        details: vi.fn().mockResolvedValue(mockDetailsResult),
      } as any

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 1 })
    })

    it('should update lockState to 2 (Unlocked) when lock is unlocked', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: false, unlocked: true } } }
      platform.augustConfig = {
        details: vi.fn().mockResolvedValue(mockDetailsResult),
      } as any

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 2 })
    })

    it('should update lockState to 0 (NotFullyLocked) for ambiguous state', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: false, unlocked: false } } }
      platform.augustConfig = {
        details: vi.fn().mockResolvedValue(mockDetailsResult),
      } as any

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 0 })
    })

    it('should not throw when August API details call fails', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      platform.augustConfig = {
        details: vi.fn().mockRejectedValue(new Error('API error')),
      } as any

      // Mock refreshAugustSession to do nothing so retry also fails gracefully
      vi.spyOn(platform as any, 'refreshAugustSession').mockResolvedValue(undefined)

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await expect(
        platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi),
      ).resolves.toBeUndefined()

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalled()
    })

    it('should not call updateAccessoryState when augustConfig is not initialized', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      // augustConfig is not set (undefined / no details method)

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await expect(
        platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi),
      ).resolves.toBeUndefined()

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalled()
    })

    it('should retry with session refresh when details call fails', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: true, unlocked: false } } }
      const mockDetails = vi.fn()
        .mockRejectedValueOnce(new Error('502 Bad Gateway'))
        .mockResolvedValueOnce(mockDetailsResult)

      platform.augustConfig = { details: mockDetails } as any

      const refreshSpy = vi.spyOn(platform as any, 'refreshAugustSession').mockResolvedValue(undefined)

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(refreshSpy).toHaveBeenCalledOnce()
      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 1 })
    })

    it('should not throw when both initial call and retry fail', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      platform.augustConfig = {
        details: vi.fn().mockRejectedValue(new Error('ETIMEDOUT')),
      } as any

      vi.spyOn(platform as any, 'refreshAugustSession').mockResolvedValue(undefined)

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await expect(
        platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi),
      ).resolves.toBeUndefined()

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalled()
    })
  })

  describe('PubNub subscription lifecycle (Matter path equivalent of PR #206)', () => {
    it('should capture unsubscribe function from August.subscribe()', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockUnsubscribe = vi.fn()
      vi.mocked(August.subscribe).mockResolvedValueOnce(mockUnsubscribe)

      const device = {
        lockId: 'lock-sub',
        LockName: 'Sub Lock',
        SerialNumber: 'SN001',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      // The unsubscribe should be stored in the internal map
      const uuid = mockMatterApi.uuid.generate('lock-sub')
      const stored = (platform as any).matterPubNubUnsubscribes.get(uuid)
      expect(stored).toBe(mockUnsubscribe)
    })

    it('should tear down PubNub subscription when device is hidden (stale accessory removal)', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const uuid = 'matter-uuid-hidden-sub'
      mockMatterApi.uuid.generate.mockReturnValueOnce(uuid)

      const mockUnsubscribe = vi.fn()
      ;(platform as any).matterPubNubUnsubscribes.set(uuid, mockUnsubscribe)

      const cachedAccessory: MatterAccessory = {
        UUID: uuid,
        displayName: 'Hidden Lock',
        deviceType: { deviceType: 11 } as any,
        serialNumber: 'SN002',
        manufacturer: 'August Home Inc.',
        model: 'AUG-SL05',
        context: { lockId: 'hidden-sub' },
      }
      platform.configureMatterAccessory(cachedAccessory)

      const device = {
        lockId: 'hidden-sub',
        LockName: 'Hidden Lock',
        hide_device: true,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      expect(mockUnsubscribe).toHaveBeenCalledOnce()
      expect((platform as any).matterPubNubUnsubscribes.has(uuid)).toBe(false)
    })
  })
})
