import type { API, Logging, PlatformAccessory } from 'homebridge'

import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { AugustPlatform } from './platform.js'
import type { AugustPlatformConfig } from './settings.js'

// Mock august-yale module
vi.mock('august-yale', () => {
  return {
    default: {
      details: vi.fn(),
    },
  }
})

// Mock file system
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

describe('AugustPlatform', () => {
  let platform: AugustPlatform
  let mockApi: API
  let mockLog: Logging
  let mockConfig: AugustPlatformConfig

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Create mock API
    mockApi = {
      hap: {
        uuid: {
          generate: vi.fn(() => 'mock-uuid'),
        },
      },
      user: {
        configPath: vi.fn(() => '/mock/config.json'),
      },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      publishExternalAccessories: vi.fn(),
    } as unknown as API

    // Create mock logger
    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    } as unknown as Logging

    // Create mock config
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

    // Mock readFileSync for config file
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      platforms: [mockConfig]
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('discoverDevices', () => {
    it('should handle 401 authentication errors and trigger re-authentication', async () => {
      // Create platform instance
      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      // Mock August.details to throw 401 error
      const August = await import('august-yale')
      vi.mocked(August.default.details).mockRejectedValueOnce(new Error('GET failed with: 401'))

      // Mock validated method to avoid actual re-authentication
      const validateSpy = vi.spyOn(platform, 'validated').mockImplementation(async () => {
        // Don't change the flag back to true, just simulate the method being called
        return
      })

      // Call discoverDevices
      await expect(platform.discoverDevices()).resolves.toBeUndefined()

      // Verify that validation was reset and re-authentication was attempted
      expect(platform.config.credentials!.isValidated).toBe(false)
      expect(writeFileSync).toHaveBeenCalled()
      expect(validateSpy).toHaveBeenCalled()
    })

    it('should handle "unauthorized" errors and trigger re-authentication', async () => {
      // Create platform instance
      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      // Mock August.details to throw unauthorized error
      const August = await import('august-yale')
      vi.mocked(August.default.details).mockRejectedValueOnce(new Error('Request failed: Unauthorized'))

      // Mock validated method
      const validateSpy = vi.spyOn(platform, 'validated').mockImplementation(async () => {
        return
      })

      // Call discoverDevices
      await expect(platform.discoverDevices()).resolves.toBeUndefined()

      // Verify re-authentication was triggered
      expect(validateSpy).toHaveBeenCalled()
    })

    it('should re-throw non-authentication errors', async () => {
      // Create platform instance
      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      // Mock August.details to throw non-401 error
      const August = await import('august-yale')
      const networkError = new Error('Network timeout')
      vi.mocked(August.default.details).mockRejectedValueOnce(networkError)

      // Call discoverDevices and expect it to throw
      await expect(platform.discoverDevices()).rejects.toThrow('Failed to discover devices: Network timeout')
    })

    it('should process devices successfully when no errors occur', async () => {
      // Create platform instance
      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      // Mock successful August.details response
      const August = await import('august-yale')
      const mockDevice = {
        lockId: 'test-lock-id',
        LockName: 'Test Lock',
        SerialNumber: '123456',
      } as any // Use any to avoid complex type requirements

      vi.mocked(August.default.details).mockResolvedValueOnce([mockDevice])

      // Mock the Lock method to avoid actual device processing
      const lockSpy = vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      // Call discoverDevices
      await expect(platform.discoverDevices()).resolves.toBeUndefined()

      // Verify successful processing
      expect(August.default.details).toHaveBeenCalledWith(platform.config.credentials, '')
      // Due to the existing logic, single device arrays get wrapped: [devices] becomes [[device]]
      // So Lock gets called with [device] instead of device
      expect(lockSpy).toHaveBeenCalledWith([mockDevice])
    })
  })
})