import { describe, expect, it, vi } from 'vitest'

import { deviceBase } from './device.js'

describe('deviceBase statusCode', () => {
  // Test the statusCode method directly by mocking only what we need
  const createMockDevice = () => {
    // Create a minimal mock that satisfies TypeScript
    const mockDevice = {
      debugLog: vi.fn().mockImplementation(async () => {}),
      debugErrorLog: vi.fn().mockImplementation(async () => {}),
    }
    // Bind the statusCode method to our mock device
    const boundStatusCode = deviceBase.prototype.statusCode.bind(mockDevice)
    return { ...mockDevice, statusCode: boundStatusCode }
  }

  it('should handle 422 status code with appropriate message', async () => {
    const device = createMockDevice()
    const error = { message: 'PUT failed with: 422' }

    await device.statusCode('pushChanges', error)

    expect(device.debugLog).toHaveBeenCalledWith(
      'Unprocessable Entity - The request was well-formed but could not be processed. This may indicate the lock is in an invalid state or the operation is not allowed at this time, statusCode: PUT failed with: 422',
    )
    expect(device.debugErrorLog).not.toHaveBeenCalled()
  })

  it('should handle unknown status codes', async () => {
    const device = createMockDevice()
    const error = { message: 'PUT failed with: 500' }

    await device.statusCode('pushChanges', error)

    expect(device.debugLog).toHaveBeenCalledWith(
      'Unknown statusCode: PUT failed with: 500, Submit Bugs Here: https://tinyurl.com/AugustYaleBug',
    )
    expect(device.debugErrorLog).toHaveBeenCalledWith('failed pushChanges, Error: [object Object]')
  })

  it('should handle 200 status code successfully', async () => {
    const device = createMockDevice()
    const error = { message: '200 OK' }

    await device.statusCode('pushChanges', error)

    expect(device.debugLog).toHaveBeenCalledWith('Request successful, statusCode: 200 OK')
    expect(device.debugErrorLog).not.toHaveBeenCalled()
  })

  it('should handle 429 status code for rate limiting', async () => {
    const device = createMockDevice()
    const error = { message: 'PUT failed with: 429' }

    await device.statusCode('pushChanges', error)

    expect(device.debugLog).toHaveBeenCalledWith(
      'Too Many Requests, exceeded the number of requests allowed for a given time window, statusCode: PUT failed with: 429',
    )
    expect(device.debugErrorLog).not.toHaveBeenCalled()
  })

  it('should extract status code from different message formats', async () => {
    const device = createMockDevice()

    // Test extraction from "422"
    const error1 = { message: '422' }
    await device.statusCode('test', error1)
    expect(device.debugLog).toHaveBeenCalledWith(
      'Unprocessable Entity - The request was well-formed but could not be processed. This may indicate the lock is in an invalid state or the operation is not allowed at this time, statusCode: 422',
    )

    // Reset mock
    device.debugLog.mockClear()
    device.debugErrorLog.mockClear()

    // Test extraction from "API call failed: 422"
    const error2 = { message: 'API call failed: 422' }
    await device.statusCode('test', error2)
    expect(device.debugLog).toHaveBeenCalledWith(
      'Unprocessable Entity - The request was well-formed but could not be processed. This may indicate the lock is in an invalid state or the operation is not allowed at this time, statusCode: API call failed: 422',
    )
  })
})
