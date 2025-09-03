import { beforeEach, describe, expect, it, vi } from 'vitest'

// Create a simplified test implementation that mimics the statusCode behavior
class MockDevice {
  debugLog = vi.fn()
  debugErrorLog = vi.fn()

  async statusCode(action: string, error: { message: string, constructor?: { name: string } }): Promise<void> {
    const statusCodeString = error.message || '' // Convert statusCode to a string, handle undefined/null

    // Check if the error is an AggregateError or doesn't contain a status code
    if (error.constructor?.name === 'AggregateError' || !statusCodeString.match(/^\d{3}/)) {
      await this.debugErrorLog(`${action} failed with ${error.constructor?.name || 'Error'}: ${statusCodeString}`)
      return
    }

    const statusCode = statusCodeString.slice(0, 3)
    const logMap = {
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
