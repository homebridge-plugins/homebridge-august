import type { CharacteristicValue, Service } from 'homebridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Create a simplified test implementation that mimics the updateCharacteristic behavior
class MockDeviceWithCharacteristics {
  accessory = { context: {} as Record<string, CharacteristicValue>, displayName: 'Test Lock' }
  debugLog = vi.fn()
  debugWarnLog = vi.fn()
  infoLog = vi.fn()

  async updateCharacteristic(
    Service: Service,
    ServiceName: string,
    Characteristic: any,
    CharacteristicValue: CharacteristicValue,
    CharacteristicName: string,
    Value?: CharacteristicValue,
    StatusMatch?: string,
    StatusDoesNotMatch?: string,
  ): Promise<void> {
    if (CharacteristicValue === undefined) {
      await this.debugLog(`${CharacteristicName}: ${CharacteristicValue}`)
    } else {
      const contextKey = `${ServiceName}${CharacteristicName}`
      await this.debugWarnLog(`context before: ${this.accessory.context[contextKey]}`)
      const contextBefore = this.accessory.context[contextKey]
      this.accessory.context[contextKey] = CharacteristicValue
      await this.debugWarnLog(`context after: ${this.accessory.context[contextKey]}`)
      await this.debugLog(`updateCharacteristic ${CharacteristicName}: ${CharacteristicValue} (${CharacteristicValue === Value ? StatusMatch : StatusDoesNotMatch})`)
      if (contextBefore !== CharacteristicValue) {
        // Value actually changed - push update to HomeKit
        Service.updateCharacteristic(Characteristic, CharacteristicValue)
        // Only log state change messages when we had a prior known value (not initial discovery)
        if (contextBefore !== undefined && StatusMatch && StatusDoesNotMatch) {
          await this.infoLog(`was ${CharacteristicValue === Value ? StatusMatch : StatusDoesNotMatch}`)
        }
      }
    }
  }
}

// Create a simplified test implementation that mimics the statusCode behavior
class MockDevice {
  debugLog = vi.fn()
  debugErrorLog = vi.fn()

  /**
   * Check if error is a network timeout or session expiration that requires session refresh
   * Handles 502 Bad Gateway, 401 Unauthorized, 503 Service Unavailable, and network timeouts
   */
  isTimeoutError(error: { message: string, statusCode?: number }): boolean {
    // Check for network timeout errors
    if (error.message && error.message.includes('ETIMEDOUT')) {
      return true
    }

    // Check for status codes that indicate session expiration or temporary server issues
    // 502 Bad Gateway - typically indicates session has expired or server issues
    // 503 Service Unavailable - temporary server issues
    // 401 Unauthorized - session has expired
    if (error.statusCode && (error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 401)) {
      return true
    }

    // Check for error messages containing these status codes (from tiny-json-http error format)
    // Format: "POST failed with: 502" or "GET failed with: 401"
    if (error.message) {
      const sessionErrorPatterns = [
        /failed with: 502/i,
        /failed with: 503/i,
        /failed with: 401/i,
        /Bad Gateway/i,
        /Service Unavailable/i,
        /Unauthorized/i,
      ]
      return sessionErrorPatterns.some(pattern => pattern.test(error.message))
    }

    return false
  }

  async statusCode(action: string, error: { message: string, constructor?: { name: string } }): Promise<void> {
    const statusCodeString = error.message || '' // Convert statusCode to a string, handle undefined/null

    // Check if the error is an AggregateError or doesn't contain a status code
    if (error.constructor?.name === 'AggregateError' || !/^\d{3}/.test(statusCodeString)) {
      await this.debugErrorLog(`${action} failed with ${error.constructor?.name || 'Error'}: ${statusCodeString}`)
      return
    }

    const statusCode = statusCodeString.slice(0, 3)
    const logMap: Record<string, string> = {
      100: `Command successfully sent, statusCode: ${statusCodeString}`,
      200: `Request successful, statusCode: ${statusCodeString}`,
      400: `Bad Request, statusCode: ${statusCodeString}`,
      429: `Too Many Requests, exceeded the number of requests allowed for a given time window, statusCode: ${statusCodeString}`,
    }
    const logMessage = logMap[statusCode]
      ?? `Unknown statusCode: ${statusCodeString}, Submit Bugs Here: https://tinyurl.com/AugustYaleBug`
    await this.debugLog(logMessage)
    if (!logMap[statusCode]) {
      await this.debugErrorLog(`failed ${action}, Error: ${error}`)
    }
  }
}

describe('statusCode error handling', () => {
  let mockDevice: MockDevice

  beforeEach(() => {
    mockDevice = new MockDevice()
  })

  describe('isTimeoutError method', () => {
    it('should detect ETIMEDOUT network errors', () => {
      const error = { message: 'ETIMEDOUT connection timed out' }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect 502 Bad Gateway status code', () => {
      const error = { message: 'POST failed with: 502', statusCode: 502 }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect 502 in error message', () => {
      const error = { message: 'POST failed with: 502' }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect 503 Service Unavailable status code', () => {
      const error = { message: 'GET failed with: 503', statusCode: 503 }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect 503 in error message', () => {
      const error = { message: 'Service Unavailable' }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect 401 Unauthorized status code', () => {
      const error = { message: 'POST failed with: 401', statusCode: 401 }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect 401 in error message', () => {
      const error = { message: 'Unauthorized access' }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should detect Bad Gateway in error message', () => {
      const error = { message: 'Bad Gateway' }
      expect(mockDevice.isTimeoutError(error)).toBe(true)
    })

    it('should return false for non-timeout errors', () => {
      const error = { message: '404 Not Found' }
      expect(mockDevice.isTimeoutError(error)).toBe(false)
    })

    it('should return false for 400 Bad Request', () => {
      const error = { message: '400 Bad Request', statusCode: 400 }
      expect(mockDevice.isTimeoutError(error)).toBe(false)
    })

    it('should return false for 429 Too Many Requests', () => {
      const error = { message: '429 Too Many Requests', statusCode: 429 }
      expect(mockDevice.isTimeoutError(error)).toBe(false)
    })

    it('should return false for empty message', () => {
      const error = { message: '' }
      expect(mockDevice.isTimeoutError(error)).toBe(false)
    })

    it('should not match 401 in non-HTTP status contexts', () => {
      const error = { message: 'Expected 4012 records but found 401' }
      expect(mockDevice.isTimeoutError(error)).toBe(false)
    })

    it('should not match 502 in non-HTTP status contexts', () => {
      const error = { message: 'Lock ID 50234 not found' }
      expect(mockDevice.isTimeoutError(error)).toBe(false)
    })
  })

  describe('statusCode method', () => {
    it('should handle standard HTTP status codes', async () => {
      await mockDevice.statusCode('test action', { message: '400 Bad Request' })

      expect(mockDevice.debugLog).toHaveBeenCalledWith('Bad Request, statusCode: 400 Bad Request')
      expect(mockDevice.debugErrorLog).not.toHaveBeenCalled()
    })

    it('should handle AggregateError specifically', async () => {
      await mockDevice.statusCode('refreshStatus', {
        message: 'Multiple errors occurred',
        constructor: { name: 'AggregateError' },
      })

      expect(mockDevice.debugErrorLog).toHaveBeenCalledWith('refreshStatus failed with AggregateError: Multiple errors occurred')
      expect(mockDevice.debugLog).not.toHaveBeenCalled()
    })

    it('should handle error with empty message', async () => {
      await mockDevice.statusCode('refreshStatus', { message: '' })

      expect(mockDevice.debugErrorLog).toHaveBeenCalledWith('refreshStatus failed with Object: ')
      expect(mockDevice.debugLog).not.toHaveBeenCalled()
    })

    it('should handle error message without numeric status code', async () => {
      await mockDevice.statusCode('refreshStatus', { message: 'Network connection failed' })

      expect(mockDevice.debugErrorLog).toHaveBeenCalledWith('refreshStatus failed with Object: Network connection failed')
      expect(mockDevice.debugLog).not.toHaveBeenCalled()
    })

    it('should handle 429 Too Many Requests status code', async () => {
      await mockDevice.statusCode('test action', { message: '429 Too Many Requests' })

      expect(mockDevice.debugLog).toHaveBeenCalledWith('Too Many Requests, exceeded the number of requests allowed for a given time window, statusCode: 429 Too Many Requests')
      expect(mockDevice.debugErrorLog).not.toHaveBeenCalled()
    })

    it('should handle unknown numeric status codes', async () => {
      await mockDevice.statusCode('test action', { message: '503 Service Unavailable' })

      expect(mockDevice.debugLog).toHaveBeenCalledWith('Unknown statusCode: 503 Service Unavailable, Submit Bugs Here: https://tinyurl.com/AugustYaleBug')
      expect(mockDevice.debugErrorLog).toHaveBeenCalledWith('failed test action, Error: [object Object]')
    })
  })
})

describe('updateCharacteristic', () => {
  let device: MockDeviceWithCharacteristics
  let mockService: Service
  const CHARACTERISTIC = 'LockCurrentState'

  beforeEach(() => {
    device = new MockDeviceWithCharacteristics()
    mockService = {
      updateCharacteristic: vi.fn(),
    } as unknown as Service
  })

  it('should skip HomeKit update when CharacteristicValue is undefined', async () => {
    await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, undefined as any, 'LockCurrentState')

    expect(mockService.updateCharacteristic).not.toHaveBeenCalled()
    expect(device.debugLog).toHaveBeenCalledWith('LockCurrentState: undefined')
  })

  describe('initial state discovery (no prior context)', () => {
    it('should push value to HomeKit on first update', async () => {
      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 0, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(CHARACTERISTIC, 0)
    })

    it('should NOT log info message on initial discovery', async () => {
      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 0, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(device.infoLog).not.toHaveBeenCalled()
    })

    it('should store the value in context for future comparisons', async () => {
      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 0, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(device.accessory.context.LockMechanismLockCurrentState).toBe(0)
    })
  })

  describe('subsequent updates with unchanged value', () => {
    it('should NOT push to HomeKit when value has not changed', async () => {
      // Seed context as if a previous update occurred
      device.accessory.context.LockMechanismLockCurrentState = 1

      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 1, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(mockService.updateCharacteristic).not.toHaveBeenCalled()
    })

    it('should NOT log info message when value has not changed', async () => {
      device.accessory.context.LockMechanismLockCurrentState = 1

      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 1, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(device.infoLog).not.toHaveBeenCalled()
    })
  })

  describe('genuine state change', () => {
    it('should push to HomeKit when value changes', async () => {
      device.accessory.context.LockMechanismLockCurrentState = 1

      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 0, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(CHARACTERISTIC, 0)
    })

    it('should log "was Unlocked" when lock changes from secured to unsecured', async () => {
      device.accessory.context.LockMechanismLockCurrentState = 1

      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 0, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(device.infoLog).toHaveBeenCalledWith('was Unlocked')
    })

    it('should log "was Locked" when lock changes from unsecured to secured', async () => {
      device.accessory.context.LockMechanismLockCurrentState = 0

      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 1, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(device.infoLog).toHaveBeenCalledWith('was Locked')
    })

    it('should update context to new value', async () => {
      device.accessory.context.LockMechanismLockCurrentState = 1

      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 0, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(device.accessory.context.LockMechanismLockCurrentState).toBe(0)
    })
  })

  describe('contact sensor state changes', () => {
    it('should log "was Closed" when door changes to closed', async () => {
      device.accessory.context.ContactSensorContactSensorState = 1

      await device.updateCharacteristic(mockService, 'ContactSensor', 'ContactSensorState', 0, 'ContactSensorState', 1, 'Opened', 'Closed')

      expect(device.infoLog).toHaveBeenCalledWith('was Closed')
    })

    it('should log "was Opened" when door changes to open', async () => {
      device.accessory.context.ContactSensorContactSensorState = 0

      await device.updateCharacteristic(mockService, 'ContactSensor', 'ContactSensorState', 1, 'ContactSensorState', 1, 'Opened', 'Closed')

      expect(device.infoLog).toHaveBeenCalledWith('was Opened')
    })
  })

  describe('updates without StatusMatch/StatusDoesNotMatch', () => {
    it('should push to HomeKit but not log info when no status strings provided', async () => {
      device.accessory.context.BatteryBatteryLevel = 90

      await device.updateCharacteristic(mockService, 'Battery', 'BatteryLevel', 85, 'BatteryLevel')

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith('BatteryLevel', 85)
      expect(device.infoLog).not.toHaveBeenCalled()
    })
  })

  describe('startup simulation (seeded context matches API response)', () => {
    it('should not push to HomeKit or log when seeded context matches first API value', async () => {
      // Simulate constructor seeding: accessory.context.LockMechanismLockCurrentState ??= SECURED
      device.accessory.context.LockMechanismLockCurrentState = 1

      // First API response returns same state (SECURED = 1)
      await device.updateCharacteristic(mockService, 'LockMechanism', CHARACTERISTIC, 1, 'LockCurrentState', 1, 'Locked', 'Unlocked')

      expect(mockService.updateCharacteristic).not.toHaveBeenCalled()
      expect(device.infoLog).not.toHaveBeenCalled()
    })
  })
})
