/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.test.ts: homebridge-august platform tests.
 */
import type { API, Logging, PlatformAccessory } from 'homebridge'

import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { AugustPlatform } from './platform.js'
import type { AugustPlatformConfig } from './settings.js'

// Mock the august-yale module
vi.mock('august-yale', () => {
  return {
    default: class August {
      public credentials: any
      constructor(credentials: any) {
        this.credentials = credentials
      }
      static async authorize() {}
      static async validate() { return true }
      static async details() { return [] }
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
    } as any

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

  it('should normalize Canadian country code to US for API compatibility', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'CA',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    const normalizedCredentials = await normalizeMethod(config.credentials)

    expect(normalizedCredentials.countryCode).toBe('US')
    expect(normalizedCredentials.augustId).toBe('test@example.com')
    expect(normalizedCredentials.password).toBe('test-password')
  })

  it('should normalize Mexican country code to US for API compatibility', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'MX',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    const normalizedCredentials = await normalizeMethod(config.credentials)

    expect(normalizedCredentials.countryCode).toBe('US')
    expect(normalizedCredentials.augustId).toBe('test@example.com')
    expect(normalizedCredentials.password).toBe('test-password')
  })

  it('should respect disableCountryCodeNormalization option', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'CA',
        isValidated: true,
      },
      options: {
        logging: 'debug',
        disableCountryCodeNormalization: true,
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    const normalizedCredentials = await normalizeMethod(config.credentials)

    expect(normalizedCredentials.countryCode).toBe('CA') // Should remain unchanged
    expect(normalizedCredentials.augustId).toBe('test@example.com')
    expect(normalizedCredentials.password).toBe('test-password')
  })

  it('should handle case-insensitive country codes', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'ca', // lowercase
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    const normalizedCredentials = await normalizeMethod(config.credentials)

    expect(normalizedCredentials.countryCode).toBe('US')
  })

  it('should not change US country code', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'US',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    const normalizedCredentials = await normalizeMethod(config.credentials)

    expect(normalizedCredentials.countryCode).toBe('US')
  })

  it('should preserve other credential properties when normalizing', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        apiKey: 'test-api-key',
        pnSubKey: 'test-pn-sub-key',
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'CA',
        isValidated: true,
        validateCode: 'test-code',
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    const normalizedCredentials = await normalizeMethod(config.credentials)

    expect(normalizedCredentials.apiKey).toBe('test-api-key')
    expect(normalizedCredentials.pnSubKey).toBe('test-pn-sub-key')
    expect(normalizedCredentials.installId).toBe('test-install-id')
    expect(normalizedCredentials.augustId).toBe('test@example.com')
    expect(normalizedCredentials.password).toBe('test-password')
    expect(normalizedCredentials.countryCode).toBe('US') // Should be normalized
    expect(normalizedCredentials.isValidated).toBe(true)
    expect(normalizedCredentials.validateCode).toBe('test-code')
  })

  it('should provide public method to get normalized credentials', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'CA',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Test the public method
    const normalizedCredentials = await platform.getNormalizedCredentials()

    expect(normalizedCredentials.countryCode).toBe('US')
    expect(normalizedCredentials.augustId).toBe('test@example.com')
  })

  it('should handle null credentials gracefully', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'CA',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // Access the private method for testing
    const normalizeMethod = (platform as any).normalizeCredentialsForApi.bind(platform)
    
    await expect(normalizeMethod(null)).rejects.toThrow('Credentials cannot be null or undefined')
    await expect(normalizeMethod(undefined)).rejects.toThrow('Credentials cannot be null or undefined')
  })

  it('should use cached credentials for performance', async () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'CA',
        isValidated: true,
      },
      options: {
        logging: 'debug',
      },
    }

    platform = new AugustPlatform(mockLog, config, mockApi)

    // First call should normalize and cache
    const firstCall = await platform.getNormalizedCredentials()
    expect(firstCall.countryCode).toBe('US')

    // Second call should use cache
    const secondCall = await platform.getNormalizedCredentials()
    expect(secondCall.countryCode).toBe('US')
    expect(secondCall).toBe(firstCall) // Should be the same object reference
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
      const detailsMock = vi.fn().mockRejectedValueOnce(new Error('GET failed with: 401'))
      August.default.details = detailsMock

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
      const detailsMock = vi.fn().mockRejectedValueOnce(new Error('Request failed: Unauthorized'))
      August.default.details = detailsMock

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
      const detailsMock = vi.fn().mockRejectedValueOnce(networkError)
      August.default.details = detailsMock

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

      const detailsMock = vi.fn().mockResolvedValueOnce([mockDevice])
      August.default.details = detailsMock

      // Mock the Lock method to avoid actual device processing
      const lockSpy = vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      // Call discoverDevices
      await expect(platform.discoverDevices()).resolves.toBeUndefined()

      // Verify successful processing
      expect(detailsMock).toHaveBeenCalled()
      // Due to the existing logic, single device arrays get wrapped: [devices] becomes [[device]]
      // So Lock gets called with [device] instead of device
      expect(lockSpy).toHaveBeenCalledWith([mockDevice])
    })
  })
})