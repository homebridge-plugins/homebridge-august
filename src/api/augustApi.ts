/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * augustApi.ts: homebridge-august enhanced API wrapper.
 */
import type { credentials } from '../settings.js'

import August from 'august-yale'

/**
 * Enhanced August API wrapper that extends the basic august-yale package
 * with additional endpoints and functionality based on the yalexs library
 */
export class AugustEnhancedApi {
  private augustInstance: August

  constructor(credentials: credentials) {
    this.augustInstance = new August(credentials)
  }

  // Core August API methods - delegated to august-yale
  async authorize() {
    return this.augustInstance.authorize()
  }

  async validate(code: string) {
    return this.augustInstance.validate(code)
  }

  async locks() {
    return this.augustInstance.locks()
  }

  async details(lockId?: string) {
    return this.augustInstance.details(lockId || '')
  }

  async status(lockId: string) {
    return this.augustInstance.status(lockId)
  }

  async lock(lockId: string) {
    return this.augustInstance.lock(lockId)
  }

  async unlock(lockId: string) {
    return this.augustInstance.unlock(lockId)
  }

  async subscribe(lockId: string, callback: (event: any) => void) {
    return this.augustInstance.subscribe(lockId, callback)
  }

  end() {
    return this.augustInstance.end()
  }

  // Enhanced API methods - new functionality

  /**
   * Get doorbells associated with the account
   */
  async getDoorbells() {
    try {
      const { body } = await this.augustInstance.get('/users/doorbells/mine')
      return body || {}
    } catch (error: any) {
      if (error.message?.includes('404')) {
        // No doorbells found, return empty object
        return {}
      }
      throw error
    }
  }

  /**
   * Get detailed information for a specific doorbell
   */
  async getDoorbellDetail(doorbellId: string) {
    try {
      const { body } = await this.augustInstance.get(`/doorbells/${doorbellId}`)
      return body
    } catch (error: any) {
      if (error.message?.includes('404')) {
        throw new Error(`Doorbell ${doorbellId} not found`)
      }
      throw error
    }
  }

  /**
   * Wake up a doorbell (ping device)
   */
  async wakeupDoorbell(doorbellId: string) {
    try {
      const response = await this.augustInstance.post(`/doorbells/${doorbellId}/wakeup`, {})
      return response.body || true
    } catch (error: any) {
      throw new Error(`Failed to wake up doorbell ${doorbellId}: ${error.message}`)
    }
  }

  /**
   * Get houses associated with the account
   */
  async getHouses() {
    try {
      const { body } = await this.augustInstance.get('/users/houses/mine')
      return body || {}
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return {}
      }
      throw error
    }
  }

  /**
   * Get detailed information for a specific house
   */
  async getHouseDetail(houseId: string) {
    try {
      const { body } = await this.augustInstance.get(`/houses/${houseId}`)
      return body
    } catch (error: any) {
      if (error.message?.includes('404')) {
        throw new Error(`House ${houseId} not found`)
      }
      throw error
    }
  }

  /**
   * Get activity history for a house
   */
  async getHouseActivities(houseId: string, limit = 8) {
    try {
      const { body } = await this.augustInstance.get(
        `/houses/${houseId}/activities?limit=${limit}`,
      )
      return body?.events || []
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return []
      }
      throw error
    }
  }

  /**
   * Get PIN codes for a lock
   */
  async getLockPins(lockId: string) {
    try {
      const { body } = await this.augustInstance.get(`/locks/${lockId}/pins`)
      return body?.loaded || []
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return []
      }
      throw error
    }
  }

  /**
   * Get device capabilities
   */
  async getDeviceCapabilities(serialNumber: string) {
    try {
      const { body } = await this.augustInstance.get(
        `/devices/capabilities?serialNumber=${serialNumber}&topLevelHost=true`,
      )
      return body
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return null
      }
      throw error
    }
  }

  /**
   * Get user information
   */
  async getUser() {
    try {
      const { body } = await this.augustInstance.get('/users/me')
      return body
    } catch (error: any) {
      throw new Error(`Failed to get user information: ${error.message}`)
    }
  }

  /**
   * Get alarms (Yale-specific feature)
   */
  async getAlarms() {
    try {
      const { body } = await this.augustInstance.get('/users/alarms/mine')
      return body || []
    } catch (error: any) {
      if (error.message?.includes('404') || error.message?.includes('403')) {
        // Alarms not supported or no alarms found
        return []
      }
      throw error
    }
  }

  /**
   * Get devices associated with an alarm
   */
  async getAlarmDevices(alarmId: string) {
    try {
      const { body } = await this.augustInstance.get(`/alarms/${alarmId}/devices`)
      return body || []
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return []
      }
      throw error
    }
  }

  /**
   * Set alarm state (arm/disarm)
   */
  async setAlarmState(alarmId: string, armState: 'armed' | 'disarmed', areaIds?: string[]) {
    try {
      const payload = areaIds ? { areaIDs: areaIds } : {}
      const response = await this.augustInstance.put(`/alarms/${alarmId}/state/${armState}`, payload)
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to set alarm state: ${error.message}`)
    }
  }

  /**
   * Subscribe to websocket updates for real-time notifications
   */
  async addWebsocketSubscription() {
    try {
      const payload = { scopes: ['lock'] }
      const response = await this.augustInstance.post('/websocket/subscribers', payload)
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to add websocket subscription: ${error.message}`)
    }
  }

  /**
   * Get websocket subscriptions
   */
  async getWebsocketSubscriptions(subscriberId?: string) {
    try {
      const endpoint = subscriberId
        ? `/websocket/subscribers/${subscriberId}`
        : '/websocket/subscribers'
      const response = await this.augustInstance.get(endpoint)
      return response.body
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return null
      }
      throw error
    }
  }

  /**
   * Delete a websocket subscription
   */
  async deleteWebsocketSubscription(subscriberId: string) {
    try {
      // Note: august-yale doesn't have a delete method, so we'll use the underlying fetch
      const response = await (this.augustInstance as any).fetch({
        method: 'delete',
        url: `/websocket/subscribers/${subscriberId}`,
        headers: await (this.augustInstance as any).session(),
      })
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to delete websocket subscription: ${error.message}`)
    }
  }

  /**
   * Enhanced lock operation with async support (for faster operations)
   */
  async lockAsync(lockId: string, hyperBridge = true) {
    try {
      const endpoint = hyperBridge
        ? `/remoteoperate/${lockId}/lock?v=2.3.1&type=async&connection=persistent`
        : `/remoteoperate/${lockId}/lock?v=2.3.1&type=async`
      const response = await this.augustInstance.put(endpoint, {})
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to lock asynchronously: ${error.message}`)
    }
  }

  /**
   * Enhanced unlock operation with async support (for faster operations)
   */
  async unlockAsync(lockId: string, hyperBridge = true) {
    try {
      const endpoint = hyperBridge
        ? `/remoteoperate/${lockId}/unlock?v=2.3.1&type=async&connection=persistent`
        : `/remoteoperate/${lockId}/unlock?v=2.3.1&type=async`
      const response = await this.augustInstance.put(endpoint, {})
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to unlock asynchronously: ${error.message}`)
    }
  }

  /**
   * Unlatch operation (for locks that support it)
   */
  async unlatch(lockId: string) {
    try {
      const response = await this.augustInstance.put(`/remoteoperate/${lockId}/unlatch`, {})
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to unlatch: ${error.message}`)
    }
  }

  /**
   * Async unlatch operation
   */
  async unlatchAsync(lockId: string, hyperBridge = true) {
    try {
      const endpoint = hyperBridge
        ? `/remoteoperate/${lockId}/unlatch?v=2.3.1&type=async&connection=persistent`
        : `/remoteoperate/${lockId}/unlatch?v=2.3.1&type=async`
      const response = await this.augustInstance.put(endpoint, {})
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to unlatch asynchronously: ${error.message}`)
    }
  }

  /**
   * Get status asynchronously (wakeup device)
   */
  async statusAsync(lockId: string, hyperBridge = true) {
    try {
      const endpoint = hyperBridge
        ? `/remoteoperate/${lockId}/status?v=2.3.1&type=async&intent=wakeup&connection=persistent`
        : `/remoteoperate/${lockId}/status?v=2.3.1&type=async&intent=wakeup`
      const response = await this.augustInstance.put(endpoint, {})
      return response.body
    } catch (error: any) {
      throw new Error(`Failed to get status asynchronously: ${error.message}`)
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken() {
    try {
      // Use the houses endpoint to refresh the token (as per yalexs implementation)
      const response = await this.augustInstance.get('/users/houses/mine')
      // The refreshed token should be in the response headers
      return response.headers?.['x-august-access-token'] || response.headers?.['x-access-token']
    } catch (error: any) {
      throw new Error(`Failed to refresh access token: ${error.message}`)
    }
  }
}
