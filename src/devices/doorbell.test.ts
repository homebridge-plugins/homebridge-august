/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * doorbell.test.ts: homebridge-august doorbell device tests.
 */
import type { API, Logging, PlatformAccessory } from 'homebridge'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { AugustPlatform } from '../platform.js'
import { DoorbellDevice } from './doorbell.js'
import type { AugustPlatformConfig } from '../settings.js'
import { AugustEnhancedApi } from '../api/augustApi.js'

// Mock the august-yale module
vi.mock('august-yale', () => {
  const MockAugust = vi.fn().mockImplementation(() => ({
    authorize: vi.fn(),
    validate: vi.fn(),
    locks: vi.fn(),
    details: vi.fn(),
    status: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    subscribe: vi.fn(),
    end: vi.fn(),
  }))
  
  return {
    default: MockAugust,
  }
})

// Mock enhanced API
vi.mock('../api/augustApi.js', () => ({
  AugustEnhancedApi: vi.fn().mockImplementation(() => ({
    getDoorbellDetail: vi.fn(),
    wakeupDoorbell: vi.fn(),
  })),
}))

describe('DoorbellDevice', () => {
  let doorbellDevice: DoorbellDevice
  let mockPlatform: AugustPlatform
  let mockAccessory: PlatformAccessory
  let mockApi: API
  let mockLog: Logging
  let mockConfig: AugustPlatformConfig
  let mockEnhancedApi: AugustEnhancedApi

  const mockDevice = {
    deviceId: 'doorbell123',
    deviceName: 'Front Door Bell',
    houseId: 'house123',
    houseName: 'Home',
    macAddress: '00:11:22:33:44:55',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T12:00:00Z',
    firmwareVersion: '1.2.3',
    batteryLevel: 85,
    isOnline: true,
    hasCapability: {
      motion: true,
      image: true,
      twoWayTalk: false,
      nightVision: true,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock API
    mockApi = {
      hap: {
        uuid: { generate: vi.fn(() => 'mock-uuid') },
        Service: {
          AccessoryInformation: 'AccessoryInformation',
          Doorbell: 'Doorbell',
          MotionSensor: 'MotionSensor',
          Battery: 'Battery',
        },
        Characteristic: {
          Manufacturer: 'Manufacturer',
          Model: 'Model',
          SerialNumber: 'SerialNumber',
          FirmwareRevision: 'FirmwareRevision',
          Name: 'Name',
          ProgrammableSwitchEvent: {
            SINGLE_PRESS: 0,
          },
          MotionDetected: 'MotionDetected',
          BatteryLevel: 'BatteryLevel',
          StatusLowBattery: {
            BATTERY_LEVEL_NORMAL: 0,
            BATTERY_LEVEL_LOW: 1,
          },
          ChargingState: {
            NOT_CHARGEABLE: 2,
          },
        },
      },
      platformAccessory: vi.fn(),
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
        installId: 'test-install-id',
        augustId: 'test@example.com',
        password: 'test-password',
        countryCode: 'US',
        isValidated: true,
      },
      options: {
        enableDoorbells: true,
        logging: 'debug',
      },
    }

    // Create mock enhanced API
    mockEnhancedApi = {
      getDoorbellDetail: vi.fn(),
      wakeupDoorbell: vi.fn(),
    } as any

    // Create mock platform
    mockPlatform = {
      log: mockLog,
      api: mockApi,
      config: mockConfig,
      debugMode: true,
      augustEnhancedApi: mockEnhancedApi,
      platformUpdateRate: 5,
    } as any

    // Create mock accessory
    mockAccessory = {
      displayName: 'Front Door Bell',
      UUID: 'test-uuid',
      context: {
        device: mockDevice,
        refreshRate: 300,
        debugMode: true,
      },
      getService: vi.fn().mockImplementation((serviceType) => {
        return {
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockImplementation(() => ({
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
            updateValue: vi.fn().mockReturnThis(),
          })),
          updateCharacteristic: vi.fn(),
        }
      }),
      addService: vi.fn().mockImplementation((serviceType, name) => {
        return {
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockImplementation(() => ({
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
            updateValue: vi.fn().mockReturnThis(),
          })),
          updateCharacteristic: vi.fn(),
        }
      }),
      removeService: vi.fn(),
    } as any
  })

  it('should initialize doorbell device successfully', () => {
    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, mockDevice)

    expect(doorbellDevice.platform).toBe(mockPlatform)
    expect(doorbellDevice.accessory).toBe(mockAccessory)
    expect(doorbellDevice.device).toBe(mockDevice)
  })

  it('should initialize services when not hidden', () => {
    const deviceConfig = {
      ...mockDevice,
      hide_device: false,
      hide_motion_sensor: false,
    }

    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, deviceConfig)

    expect(mockAccessory.getService).toHaveBeenCalledWith('Doorbell')
    expect(mockAccessory.getService).toHaveBeenCalledWith('MotionSensor')
    expect(mockAccessory.getService).toHaveBeenCalledWith('Battery')
  })

  it('should hide services when configured', () => {
    const deviceConfig = {
      ...mockDevice,
      hide_device: true,
      hide_motion_sensor: true,
    }

    // Mock that services exist to be removed
    const mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnThis(),
    }
    mockAccessory.getService = vi.fn().mockReturnValue(mockService)

    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, deviceConfig)

    expect(mockAccessory.removeService).toHaveBeenCalledWith(mockService)
  })

  it('should wake up doorbell successfully', async () => {
    const mockWakeup = vi.fn().mockResolvedValue(true)
    mockEnhancedApi.wakeupDoorbell = mockWakeup

    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, mockDevice)
    
    await doorbellDevice.wakeupDoorbell()

    expect(mockWakeup).toHaveBeenCalledWith('doorbell123')
  })

  it('should handle doorbell detail parsing', async () => {
    const mockDoorbellDetail = {
      ...mockDevice,
      batteryLevel: 75,
      status: {
        lastMotion: new Date(Date.now() - 15000).toISOString(), // 15 seconds ago
        lastDing: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago
      },
    }

    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, mockDevice)
    
    await doorbellDevice.parseStatus(mockDoorbellDetail)

    expect(doorbellDevice.doorbellDetails).toEqual(mockDoorbellDetail)
  })

  it('should enable debug mode when configured', () => {
    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, mockDevice)

    const debugEnabled = doorbellDevice.enablDebugMode()

    expect(debugEnabled).toBe(true)
  })

  it('should log messages appropriately', async () => {
    doorbellDevice = new DoorbellDevice(mockPlatform, mockAccessory, mockDevice)

    await doorbellDevice.debugLog('Test debug message')
    await doorbellDevice.infoLog('Test info message')
    await doorbellDevice.warnLog('Test warn message')
    await doorbellDevice.errorLog('Test error message')

    expect(mockLog.debug).toHaveBeenCalledWith('[%s] %s', 'Front Door Bell', 'Test debug message')
    expect(mockLog.info).toHaveBeenCalledWith('[%s] %s', 'Front Door Bell', 'Test info message')
    expect(mockLog.warn).toHaveBeenCalledWith('[%s] %s', 'Front Door Bell', 'Test warn message')
    expect(mockLog.error).toHaveBeenCalledWith('[%s] %s', 'Front Door Bell', 'Test error message')
  })
})