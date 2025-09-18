/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * augustApi.test.ts: homebridge-august enhanced API tests.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { AugustEnhancedApi } from './augustApi.js'
import type { credentials } from '../settings.js'

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
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  }))
  
  return {
    default: MockAugust,
  }
})

describe('AugustEnhancedApi', () => {
  let enhancedApi: AugustEnhancedApi
  let mockCredentials: credentials

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockCredentials = {
      installId: 'test-install-id',
      augustId: 'test@example.com',
      password: 'test-password',
      countryCode: 'US',
      isValidated: true,
    }

    enhancedApi = new AugustEnhancedApi(mockCredentials)
  })

  describe('Core August API methods', () => {
    it('should delegate authorize to august-yale', async () => {
      const mockAuthorize = vi.fn()
      ;(enhancedApi as any).augustInstance.authorize = mockAuthorize

      await enhancedApi.authorize()
      
      expect(mockAuthorize).toHaveBeenCalled()
    })

    it('should delegate validate to august-yale', async () => {
      const mockValidate = vi.fn()
      ;(enhancedApi as any).augustInstance.validate = mockValidate

      await enhancedApi.validate('123456')
      
      expect(mockValidate).toHaveBeenCalledWith('123456')
    })

    it('should delegate locks to august-yale', async () => {
      const mockLocks = vi.fn()
      ;(enhancedApi as any).augustInstance.locks = mockLocks

      await enhancedApi.locks()
      
      expect(mockLocks).toHaveBeenCalled()
    })

    it('should handle details with empty string for undefined lockId', async () => {
      const mockDetails = vi.fn()
      ;(enhancedApi as any).augustInstance.details = mockDetails

      await enhancedApi.details()
      
      expect(mockDetails).toHaveBeenCalledWith('')
    })

    it('should handle details with provided lockId', async () => {
      const mockDetails = vi.fn()
      ;(enhancedApi as any).augustInstance.details = mockDetails

      await enhancedApi.details('test-lock-id')
      
      expect(mockDetails).toHaveBeenCalledWith('test-lock-id')
    })
  })

  describe('Enhanced API methods', () => {
    it('should get doorbells successfully', async () => {
      const mockDoorbells = { 'doorbell1': { deviceName: 'Front Door' } }
      const mockGet = vi.fn().mockResolvedValue({ body: mockDoorbells })
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getDoorbells()
      
      expect(mockGet).toHaveBeenCalledWith('/users/doorbells/mine')
      expect(result).toEqual(mockDoorbells)
    })

    it('should handle 404 error when no doorbells found', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('404'))
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getDoorbells()
      
      expect(result).toEqual({})
    })

    it('should get doorbell detail successfully', async () => {
      const mockDetail = { deviceName: 'Front Door', batteryLevel: 85 }
      const mockGet = vi.fn().mockResolvedValue({ body: mockDetail })
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getDoorbellDetail('doorbell1')
      
      expect(mockGet).toHaveBeenCalledWith('/doorbells/doorbell1')
      expect(result).toEqual(mockDetail)
    })

    it('should wake up doorbell successfully', async () => {
      const mockPost = vi.fn().mockResolvedValue({ body: true })
      ;(enhancedApi as any).augustInstance.post = mockPost

      const result = await enhancedApi.wakeupDoorbell('doorbell1')
      
      expect(mockPost).toHaveBeenCalledWith('/doorbells/doorbell1/wakeup', {})
      expect(result).toBe(true)
    })

    it('should get houses successfully', async () => {
      const mockHouses = { 'house1': { houseName: 'Home' } }
      const mockGet = vi.fn().mockResolvedValue({ body: mockHouses })
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getHouses()
      
      expect(mockGet).toHaveBeenCalledWith('/users/houses/mine')
      expect(result).toEqual(mockHouses)
    })

    it('should get house activities successfully', async () => {
      const mockActivities = { events: [{ action: 'lock', dateTime: '2024-01-01' }] }
      const mockGet = vi.fn().mockResolvedValue({ body: mockActivities })
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getHouseActivities('house1', 10)
      
      expect(mockGet).toHaveBeenCalledWith('/houses/house1/activities?limit=10')
      expect(result).toEqual(mockActivities.events)
    })

    it('should get lock pins successfully', async () => {
      const mockPins = { loaded: [{ firstName: 'John', pin: '1234' }] }
      const mockGet = vi.fn().mockResolvedValue({ body: mockPins })
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getLockPins('lock1')
      
      expect(mockGet).toHaveBeenCalledWith('/locks/lock1/pins')
      expect(result).toEqual(mockPins.loaded)
    })

    it('should handle async lock operation', async () => {
      const mockPut = vi.fn().mockResolvedValue({ body: 'success' })
      ;(enhancedApi as any).augustInstance.put = mockPut

      const result = await enhancedApi.lockAsync('lock1')
      
      expect(mockPut).toHaveBeenCalledWith('/remoteoperate/lock1/lock?v=2.3.1&type=async&connection=persistent', {})
      expect(result).toBe('success')
    })

    it('should handle async unlock operation', async () => {
      const mockPut = vi.fn().mockResolvedValue({ body: 'success' })
      ;(enhancedApi as any).augustInstance.put = mockPut

      const result = await enhancedApi.unlockAsync('lock1')
      
      expect(mockPut).toHaveBeenCalledWith('/remoteoperate/lock1/unlock?v=2.3.1&type=async&connection=persistent', {})
      expect(result).toBe('success')
    })

    it('should handle unlatch operation', async () => {
      const mockPut = vi.fn().mockResolvedValue({ body: 'success' })
      ;(enhancedApi as any).augustInstance.put = mockPut

      const result = await enhancedApi.unlatch('lock1')
      
      expect(mockPut).toHaveBeenCalledWith('/remoteoperate/lock1/unlatch', {})
      expect(result).toBe('success')
    })
  })

  describe('Error handling', () => {
    it('should throw error for invalid doorbell detail request', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('404'))
      ;(enhancedApi as any).augustInstance.get = mockGet

      await expect(enhancedApi.getDoorbellDetail('invalid')).rejects.toThrow('Doorbell invalid not found')
    })

    it('should throw error for failed wakeup', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'))
      ;(enhancedApi as any).augustInstance.post = mockPost

      await expect(enhancedApi.wakeupDoorbell('doorbell1')).rejects.toThrow('Failed to wake up doorbell doorbell1: Network error')
    })

    it('should return empty array for 404 on alarms', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('404'))
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getAlarms()
      
      expect(result).toEqual([])
    })

    it('should return empty array for 403 on alarms', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('403'))
      ;(enhancedApi as any).augustInstance.get = mockGet

      const result = await enhancedApi.getAlarms()
      
      expect(result).toEqual([])
    })
  })
})