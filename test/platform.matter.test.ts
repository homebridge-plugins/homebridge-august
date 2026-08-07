/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.matter.test.ts: homebridge-august Matter platform tests.
 */
import type { API, Logging, MatterAccessory, PlatformAccessory } from 'homebridge'

import type { AugustPlatformConfig } from '../src/settings.js'

import { readFileSync } from 'node:fs'

import August from 'august-yale'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AugustMatterPlatform } from '../src/platform.matter.js'

// Mock the august-yale module
vi.mock('august-yale', () => {
  // eslint-disable-next-line prefer-arrow-callback
  const MockAugust = vi.fn().mockImplementation(function () {
    return {
      end: vi.fn(),
      lock: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn().mockResolvedValue(undefined),
      details: vi.fn(),
    }
  })

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

describe('augustMatterPlatform', () => {
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

  describe('lock (Matter accessory registration)', () => {
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
    // Helper: install a mock connectivity manager whose execute() runs
    // the supplied fn against a mock August client. This mirrors the
    // production path (platform.connectivity.execute(label, fn) ->
    // fn(client)) without spinning up the real ConnectivityManager.
    function installConnectivityMock(p: AugustMatterPlatform, client: any) {
      ;(p as any).connectivity = {
        getState: () => 'healthy',
        execute: vi.fn(async (_label: string, fn: (c: any) => Promise<any>) => {
          try {
            return await fn(client)
          } catch {
            // execute() returns undefined on failure rather than
            // rethrowing (unless throwOnOffline:true). Match that.
            return undefined
          }
        }),
      }
    }

    it('should update lockState to 1 (Locked) when lock is locked', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: true, unlocked: false } } }
      installConnectivityMock(platform, { details: vi.fn().mockResolvedValue(mockDetailsResult) })

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 1 })
    })

    it('should update lockState to 2 (Unlocked) when lock is unlocked', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: false, unlocked: true } } }
      installConnectivityMock(platform, { details: vi.fn().mockResolvedValue(mockDetailsResult) })

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 2 })
    })

    it('should update lockState to 0 (NotFullyLocked) for ambiguous state', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const mockDetailsResult = { LockStatus: { state: { locked: false, unlocked: false } } }
      installConnectivityMock(platform, { details: vi.fn().mockResolvedValue(mockDetailsResult) })

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi)

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith('test-uuid', 'doorLock', { lockState: 0 })
    })

    it('should not throw when August API details call fails', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      installConnectivityMock(platform, { details: vi.fn().mockRejectedValue(new Error('API error')) })

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await expect(
        platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi),
      ).resolves.toBeUndefined()

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalled()
    })

    it('should not call updateAccessoryState when connectivity is not initialized', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      // connectivity is not set

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await expect(
        platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi),
      ).resolves.toBeUndefined()

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalled()
    })

    it('should not throw when execute returns undefined (offline / failed)', async () => {
      // The previous "retry with session refresh" test asserted that the
      // matter path called refreshAugustSession() after a 502. That
      // explicit retry layer is gone — ConnectivityManager handles
      // retry/probe/rebuild internally. From the matter path's
      // perspective, the only observable is: execute() either returned
      // a result, or it returned undefined.
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      ;(platform as any).connectivity = {
        getState: () => 'offline',
        execute: vi.fn().mockResolvedValue(undefined),
      }

      const device = { lockId: 'lock-test', LockName: 'Test Lock' } as any

      await expect(
        platform.fetchAndUpdateMatterLockState(device, 'test-uuid', mockMatterApi),
      ).resolves.toBeUndefined()

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalled()
    })
  })

  describe('pubNub subscription lifecycle (Matter path equivalent of PR #206)', () => {
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

  describe('polling subscription lifecycle', () => {
    it('should track the polling subscription so it can be disposed', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const device = {
        lockId: 'lock-poll-track',
        LockName: 'Tracked Lock',
        SerialNumber: 'SN100',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      const uuid = mockMatterApi.uuid.generate('lock-poll-track')
      const stored = (platform as any).matterPollingSubscriptions.get(uuid)
      expect(stored).toBeDefined()
      expect(typeof stored.unsubscribe).toBe('function')
    })

    it('should dispose previous polling subscription before starting a new one (idempotent)', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const device = {
        lockId: 'lock-poll-idem',
        LockName: 'Idempotent Lock',
        SerialNumber: 'SN101',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      const uuid = mockMatterApi.uuid.generate('lock-poll-idem')
      const firstSub = (platform as any).matterPollingSubscriptions.get(uuid)
      const firstUnsubSpy = vi.spyOn(firstSub, 'unsubscribe')

      // Call polling again (simulating re-registration)
      ;(platform as any).startMatterStatusPolling(device, uuid, mockMatterApi)

      // Previous subscription should have been disposed
      expect(firstUnsubSpy).toHaveBeenCalledOnce()
      // A new subscription should be stored
      const secondSub = (platform as any).matterPollingSubscriptions.get(uuid)
      expect(secondSub).toBeDefined()
      expect(secondSub).not.toBe(firstSub)
    })

    it('should dispose polling subscription when device is hidden', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const uuid = 'matter-uuid-hidden-poll'
      mockMatterApi.uuid.generate.mockReturnValueOnce(uuid)

      const fakeSubscription = { unsubscribe: vi.fn() }
      ;(platform as any).matterPollingSubscriptions.set(uuid, fakeSubscription)

      const device = {
        lockId: 'hidden-poll',
        LockName: 'Hidden Poll Lock',
        hide_device: true,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      expect(fakeSubscription.unsubscribe).toHaveBeenCalledOnce()
      expect((platform as any).matterPollingSubscriptions.has(uuid)).toBe(false)
    })

    it('should not start polling when refreshRate is 0', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      ;(platform as any).platformRefreshRate = 0

      const device = {
        lockId: 'lock-no-poll',
        LockName: 'No Poll Lock',
        SerialNumber: 'SN102',
        hide_device: false,
        homeKitEnabled: false,
      } as any

      await (platform as any).Lock(device)

      const uuid = mockMatterApi.uuid.generate('lock-no-poll')
      expect((platform as any).matterPollingSubscriptions.has(uuid)).toBe(false)
    })
  })

  describe('pendingHapCleanup sweep after discovery', () => {
    it('should unregister staged HAP accessories that were not handled during discovery', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      // Stage two HAP accessories from a previous session
      const orphanedHap1 = { UUID: 'hap-orphan-1', displayName: 'Removed Lock 1' } as unknown as PlatformAccessory
      const orphanedHap2 = { UUID: 'hap-orphan-2', displayName: 'Removed Lock 2' } as unknown as PlatformAccessory
      await platform.configureAccessory(orphanedHap1)
      await platform.configureAccessory(orphanedHap2)

      // Stub super.discoverDevices so it's a no-op (doesn't touch pendingHapCleanup)
      // A real discovery that got a lock list back - which is what makes the
      // sweep safe in the first place
      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(platform))
      vi.spyOn(baseProto, 'discoverDevices').mockImplementation(async () => {
        (platform as any).discoveryReturnedDevices = true
      })

      await platform.discoverDevices()

      // Both staged HAP accessories should have been unregistered since neither
      // had a matching Lock() call during discovery
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-august',
        'August',
        expect.arrayContaining([orphanedHap1, orphanedHap2]),
      )
      // Map should be empty after the sweep
      expect((platform as any).pendingHapCleanup.size).toBe(0)
    })

    it('should leave handled HAP accessories alone (those already removed by Lock())', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      // Simulate a successful Lock() having already cleaned its entry
      // (pendingHapCleanup is empty)
      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(platform))
      vi.spyOn(baseProto, 'discoverDevices').mockResolvedValue(undefined as never)

      await platform.discoverDevices()

      // unregisterPlatformAccessories should not be called — nothing to sweep
      expect(mockApi.unregisterPlatformAccessories).not.toHaveBeenCalled()
    })

    it('should leave every cached accessory alone when discovery returned no locks', async () => {
      // A restart that needs a fresh verification code returns from
      // discoverDevices() normally, having discovered nothing. Sweeping on that
      // basis used to remove every one of the owner's locks from HomeKit.
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      const staged = { UUID: 'hap-staged', displayName: 'My Front Door' } as unknown as PlatformAccessory
      await platform.configureAccessory(staged)

      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(platform))
      vi.spyOn(baseProto, 'discoverDevices').mockResolvedValue(undefined as never)

      await platform.discoverDevices()

      expect(mockApi.unregisterPlatformAccessories).not.toHaveBeenCalled()
      expect((platform as any).pendingHapCleanup.size).toBe(1)
    })

    it('should only sweep the orphans, not the locks that were successfully migrated', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)

      // One lock that will be migrated (has matching active lock in account)
      // and one orphan that no longer exists in the account
      const migrated = { UUID: 'hap-migrated', displayName: 'Still Active' } as unknown as PlatformAccessory
      const orphan = { UUID: 'hap-orphan', displayName: 'Deleted From Account' } as unknown as PlatformAccessory
      await platform.configureAccessory(migrated)
      await platform.configureAccessory(orphan)

      // Simulate a successful Lock() call for the 'migrated' UUID by removing
      // that entry from pendingHapCleanup directly (mimicking what Lock() does).
      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(platform))
      vi.spyOn(baseProto, 'discoverDevices').mockImplementation(async () => {
        (platform as any).discoveryReturnedDevices = true;
        (platform as any).pendingHapCleanup.delete('hap-migrated')
      })

      await platform.discoverDevices()

      // Only the orphan should have been unregistered in the sweep
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledOnce()
      const swept = (mockApi.unregisterPlatformAccessories as any).mock.calls[0][2]
      expect(swept).toContain(orphan)
      expect(swept).not.toContain(migrated)
    })
  })

  describe('fetchAndUpdateMatterLockState (battery → PowerSource)', () => {
    // Install a stub connectivity manager whose execute() runs the poll fn
    // against a fake august client, matching the suite's conventions.
    function withDetails(p: any, detail: any) {
      const client = { details: vi.fn().mockResolvedValue(detail) }
      p.connectivity = { execute: vi.fn(async (_label: string, fn: (c: any) => Promise<any>) => fn(client)) }
      return client
    }

    it('pushes the battery level to the PowerSource cluster on poll', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      withDetails(platform, { battery: 0.53 })

      await (platform as any).fetchAndUpdateMatterLockState(
        { lockId: 'lock-1', LockName: 'Front Door' } as any,
        'matter-uuid-lock-1',
        mockMatterApi,
      )

      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith(
        'matter-uuid-lock-1',
        'powerSource',
        expect.objectContaining({
          batPercentRemaining: 106, // round(0.53 * 200)
          batChargeLevel: 0, // OK
          batReplacementNeeded: false,
        }),
      )
    })

    it('pushes the battery even when the detail carries no lock state, and flags a low battery', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      withDetails(platform, { battery: 0.08 }) // low, and no LockStatus.state at all

      await (platform as any).fetchAndUpdateMatterLockState(
        { lockId: 'lock-2', LockName: 'Kitchen Door' } as any,
        'matter-uuid-lock-2',
        mockMatterApi,
      )

      // Regression guard: a stateless detail response — the norm for this
      // endpoint — must not drop the battery update.
      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith(
        'matter-uuid-lock-2',
        'powerSource',
        expect.objectContaining({
          batPercentRemaining: 16, // round(0.08 * 200)
          batChargeLevel: 2, // Critical (<10%)
          batReplacementNeeded: true, // <15%
        }),
      )
      // ...and it must not push a doorLock state it doesn't have.
      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalledWith(
        'matter-uuid-lock-2',
        'doorLock',
        expect.anything(),
      )
    })

    it('leaves PowerSource untouched when the detail has no battery field', async () => {
      platform = new AugustMatterPlatform(mockLog, mockConfig, mockApi)
      withDetails(platform, { LockStatus: { state: { locked: true } } }) // no battery

      await (platform as any).fetchAndUpdateMatterLockState(
        { lockId: 'lock-3', LockName: 'Guest Door' } as any,
        'matter-uuid-lock-3',
        mockMatterApi,
      )

      expect(mockMatterApi.updateAccessoryState).not.toHaveBeenCalledWith(
        'matter-uuid-lock-3',
        'powerSource',
        expect.anything(),
      )
      // lock state is present, so the doorLock update still happens as before.
      expect(mockMatterApi.updateAccessoryState).toHaveBeenCalledWith(
        'matter-uuid-lock-3',
        'doorLock',
        expect.objectContaining({ lockState: 1 }),
      )
    })
  })
})
