/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.test.ts: homebridge-august platform tests.
 */
import type { API, Logging } from 'homebridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('AugustPlatform', () => {
  let mockApi: API
  let mockLog: Logging
  let platform: AugustPlatform

  beforeEach(() => {
    mockApi = {
      hap: {
        uuid: {
          generate: vi.fn().mockReturnValue('test-uuid'),
        },
      },
      user: {
        configPath: vi.fn().mockReturnValue('/test/config.json'),
      },
      on: vi.fn(),
      registerPlatform: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      publishExternalAccessories: vi.fn(),
    } as any

    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    } as any

    // Mock fs module
    vi.mock('node:fs', () => ({
      readFileSync: vi.fn().mockReturnValue('{"platforms": [{"platform": "August", "credentials": {}}]}'),
      writeFileSync: vi.fn(),
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
})