import type { AugustPlatformConfig, credentials, device, options } from './settings'

import { describe, expect, it } from 'vitest'

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

describe('settings', () => {
  it('should have correct PLATFORM_NAME', () => {
    expect(PLATFORM_NAME).toBe('August')
  })

  it('should have correct PLUGIN_NAME', () => {
    expect(PLUGIN_NAME).toBe('homebridge-august')
  })

  it('should define AugustPlatformConfig interface', () => {
    const config: AugustPlatformConfig = {
      platform: 'August',
      credentials: {
        apiKey: 'test-api-key',
        pnSubKey: 'test-pn-sub-key',
        installId: 'test-install-id',
        augustId: 'test-august-id',
        password: 'test-password',
        countryCode: 'test-country-code',
      },
      options: {
        devices: [],
        allowInvalidCharacters: true,
        refreshRate: 60,
        updateRate: 60,
        pushRate: 60,
        logging: 'debug',
      },
    }
    expect(config.credentials?.apiKey).toBe('test-api-key')
    expect(config.options?.refreshRate).toBe(60)
  })

  it('should define credentials interface', () => {
    const creds: credentials = {
      apiKey: 'test-api-key',
      pnSubKey: 'test-pn-sub-key',
      installId: 'test-install-id',
      augustId: 'test-august-id',
      password: 'test-password',
      countryCode: 'test-country-code',
    }
    expect(creds.apiKey).toBe('test-api-key')
    expect(creds.installId).toBe('test-install-id')
  })

  it('should define options interface', () => {
    const opts: options = {
      devices: [],
      allowInvalidCharacters: true,
      refreshRate: 60,
      updateRate: 60,
      pushRate: 60,
      logging: 'debug',
    }
    expect(opts.refreshRate).toBe(60)
    expect(opts.logging).toBe('debug')
  })

  it('should define device interface', () => {
    const dev: device = {
      LockName: 'Test Lock',
      Type: 1,
      Created: '2023-01-01',
      Updated: '2023-01-02',
      LockId: 'test-lock-id',
      HouseID: 'test-house-id',
      HouseName: 'Test House',
      Calibrated: true,
      timeZone: 'UTC',
      battery: 100,
      batteryInfo: {
        level: 100,
        warningState: 'none',
        infoUpdatedDate: '2023-01-01',
        lastChangeDate: '2023-01-01',
        lastChangeVoltage: 4.2,
      },
      doorStateOpenTimeout: 30,
      hostLockInfo: {
        serialNumber: 'test-serial-number',
        manufacturer: 'Test Manufacturer',
        productID: 1234,
        productTypeID: 5678,
      },
      supportsEntryCodes: true,
      remoteOperateSecret: 'test-secret',
      skuNumber: 'test-sku',
      macAddress: '00:11:22:33:44:55',
      SerialNumber: 'test-serial-number',
      LockStatus: {
        status: 'locked',
        dateTime: '2023-01-01T00:00:00Z',
        isLockStatusChanged: true,
        valid: true,
        doorState: 'closed',
      },
      currentFirmwareVersion: '1.0.0',
      homeKitEnabled: true,
      zWaveEnabled: true,
      isGalileo: false,
      Bridge: {
        _id: 'test-bridge-id',
        mfgBridgeID: 'test-mfg-bridge-id',
        deviceModel: 'test-model',
        firmwareVersion: '1.0.0',
        operative: true,
        status: {
          current: 'online',
          lastOffline: '2023-01-01T00:00:00Z',
          updated: '2023-01-01T00:00:00Z',
          lastOnline: '2023-01-01T00:00:00Z',
        },
        locks: [],
        hyperBridge: false,
      },
      parametersToSet: {},
      users: {},
      pubsubChannel: 'test-channel',
      ruleHash: {},
      cameras: [],
      lockId: 'test-lock-id',
    }
    expect(dev.LockName).toBe('Test Lock')
    expect(dev.battery).toBe(100)
  })
})
