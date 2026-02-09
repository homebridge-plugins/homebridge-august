import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    // Check for error messages containing these status codes
    if (error.message) {
      const sessionErrorPatterns = ['502', '503', '401', 'Bad Gateway', 'Service Unavailable', 'Unauthorized']
      return sessionErrorPatterns.some(pattern => error.message.includes(pattern))
    }

    return false
  }

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
