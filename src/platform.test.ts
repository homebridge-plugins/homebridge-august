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
  const MockAugust = vi.fn().mockImplementation(() => ({
    end: vi.fn(),
  }))
  
  // Type assertion to add static methods
  const MockConstructor = MockAugust as any
  MockConstructor.details = vi.fn()
  MockConstructor.authorize = vi.fn()
  MockConstructor.validate = vi.fn()
  
  return {
    default: MockConstructor,
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

    it('should exclude locks matching excludeLockIds', async () => {
      const configWithExcludes: AugustPlatformConfig = {
        ...mockConfig,
        options: {
          logging: 'debug',
          excludeLockIds: ['excluded-lock-id'],
        },
      }

      platform = new AugustPlatform(mockLog, configWithExcludes, mockApi)

      const August = await import('august-yale')
      const mockDeviceIncluded = { lockId: 'included-lock-id', LockName: 'Included Lock' } as any
      const mockDeviceExcluded = { lockId: 'excluded-lock-id', LockName: 'Excluded Lock' } as any
      August.default.details = vi.fn().mockResolvedValueOnce([mockDeviceIncluded, mockDeviceExcluded])

      const lockSpy = vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      await platform.discoverDevices()

      // Only the non-excluded lock should be processed
      expect(lockSpy).toHaveBeenCalledTimes(1)
      expect(lockSpy).toHaveBeenCalledWith(expect.objectContaining({ lockId: 'included-lock-id' }))
    })

    it('should handle case-insensitive excludeLockIds matching', async () => {
      const configWithExcludes: AugustPlatformConfig = {
        ...mockConfig,
        options: {
          logging: 'debug',
          excludeLockIds: ['EXCLUDED-LOCK-ID'],
        },
      }

      platform = new AugustPlatform(mockLog, configWithExcludes, mockApi)

      const August = await import('august-yale')
      const mockDeviceIncluded = { lockId: 'included-lock-id', LockName: 'Included Lock' } as any
      const mockDeviceExcluded = { lockId: 'excluded-lock-id', LockName: 'Excluded Lock' } as any
      August.default.details = vi.fn().mockResolvedValueOnce([mockDeviceIncluded, mockDeviceExcluded])

      const lockSpy = vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      await platform.discoverDevices()

      expect(lockSpy).toHaveBeenCalledTimes(1)
      expect(lockSpy).toHaveBeenCalledWith(expect.objectContaining({ lockId: 'included-lock-id' }))
    })

    it('should unregister cached accessories for excluded lock IDs', async () => {
      const configWithExcludes: AugustPlatformConfig = {
        ...mockConfig,
        options: {
          logging: 'debug',
          excludeLockIds: ['excluded-lock-id'],
        },
      }

      // Make uuid.generate return predictable UUIDs based on input
      vi.mocked(mockApi.hap.uuid.generate).mockImplementation((input: any) => `uuid-${input}`)

      platform = new AugustPlatform(mockLog, configWithExcludes, mockApi)

      // Simulate a cached accessory for the excluded lock
      const mockAccessory = {
        UUID: 'uuid-excluded-lock-id',
        displayName: 'Excluded Lock',
      } as unknown as PlatformAccessory
      platform.accessories.push(mockAccessory)

      const August = await import('august-yale')
      const mockDevice = { lockId: 'included-lock-id', LockName: 'Included Lock' } as any
      August.default.details = vi.fn().mockResolvedValueOnce([mockDevice])

      vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      await platform.discoverDevices()

      // Verify the cached accessory was unregistered
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-august',
        'August',
        [mockAccessory],
      )
      // Verify the accessory was removed from the accessories array
      expect(platform.accessories.find(a => a.UUID === 'uuid-excluded-lock-id')).toBeUndefined()
    })

    it('should not filter when excludeLockIds is empty', async () => {
      const configWithEmptyExcludes: AugustPlatformConfig = {
        ...mockConfig,
        options: {
          logging: 'debug',
          excludeLockIds: [],
        },
      }

      platform = new AugustPlatform(mockLog, configWithEmptyExcludes, mockApi)

      const August = await import('august-yale')
      const mockDeviceA = { lockId: 'lock-a', LockName: 'Lock A' } as any
      const mockDeviceB = { lockId: 'lock-b', LockName: 'Lock B' } as any
      August.default.details = vi.fn().mockResolvedValueOnce([mockDeviceA, mockDeviceB])

      const lockSpy = vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      await platform.discoverDevices()

      expect(lockSpy).toHaveBeenCalledTimes(2)
    })

    it('should exclude locks when using per-device config', async () => {
      const configWithBoth: AugustPlatformConfig = {
        ...mockConfig,
        options: {
          logging: 'debug',
          excludeLockIds: ['excluded-lock-id'],
          devices: [
            { lockId: 'included-lock-id', configLockName: 'My Lock', overrideHomeKitEnabled: false } as any,
          ],
        },
      }

      platform = new AugustPlatform(mockLog, configWithBoth, mockApi)

      const August = await import('august-yale')
      const mockDeviceIncluded = { lockId: 'included-lock-id', LockName: 'Included Lock' } as any
      const mockDeviceExcluded = { lockId: 'excluded-lock-id', LockName: 'Excluded Lock' } as any
      August.default.details = vi.fn().mockResolvedValueOnce([mockDeviceIncluded, mockDeviceExcluded])

      const lockSpy = vi.spyOn(platform as any, 'Lock').mockImplementation(async () => {})

      await platform.discoverDevices()

      // Only the included lock should reach the Lock method
      expect(lockSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('validated method', () => {
    it('should handle undefined credentials in config file gracefully', async () => {
      // Mock config file with undefined credentials
      const mockConfigFile = {
        platforms: [
          {
            platform: 'August',
            name: 'Test August',
            // credentials is undefined here
          },
        ],
      }

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfigFile))

      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      // This should not throw an error when trying to set installId
      await expect(platform.validated()).resolves.toBeUndefined()
    })

    it('should handle null credentials in config file gracefully', async () => {
      // Mock config file with null credentials
      const mockConfigFile = {
        platforms: [
          {
            platform: 'August',
            name: 'Test August',
            credentials: null,
          },
        ],
      }

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfigFile))

      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      // This should not throw an error when trying to set installId
      await expect(platform.validated()).resolves.toBeUndefined()
    })

    it('should initialize credentials object and save installId when credentials are missing', async () => {
      // Mock config file with undefined credentials
      const mockConfigFile = {
        platforms: [
          {
            platform: 'August',
            name: 'Test August',
            // credentials is undefined here
          },
        ],
      }

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfigFile))

      platform = new AugustPlatform(mockLog, mockConfig, mockApi)

      await platform.validated()

      // Verify that writeFileSync was called (meaning the config was updated)
      expect(writeFileSync).toHaveBeenCalled()

      // Verify the credentials object was created and populated
      const writeCall = vi.mocked(writeFileSync).mock.calls[0]
      const savedConfig = JSON.parse(writeCall[1] as string)
      expect(savedConfig.platforms[0].credentials).toBeDefined()
      expect(savedConfig.platforms[0].credentials.installId).toBeDefined()
    })
  })
})
