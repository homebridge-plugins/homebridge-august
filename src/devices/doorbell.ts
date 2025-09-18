import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { AugustPlatform } from '../platform.js'
import type { doorbellConfig, doorbellDetail } from '../settings.js'

/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * doorbell.ts: homebridge-august doorbell device.
 */
import { interval, Subject } from 'rxjs'
import { debounceTime, skipWhile } from 'rxjs/operators'

/**
 * Base device interface for doorbell
 */
interface DoorbellBaseDevice {
  deviceId: string
  deviceName: string
  houseId?: string
  houseName?: string
  macAddress?: string
  created?: string
  updated?: string
  firmwareVersion?: string
  batteryLevel?: number
  isOnline?: boolean
  imageUrl?: string
  hasCapability?: {
    motion: boolean
    image: boolean
    twoWayTalk: boolean
    nightVision: boolean
  }
  // Add required properties for compatibility with device base
  LockName?: string
  Type?: number
  Created?: string
  Updated?: string
  LockId?: string
  HouseID?: string
  HouseName?: string
  Calibrated?: boolean
  timeZone?: string
  battery?: number
  SerialNumber?: string
  lockId?: string
}

/**
 * Platform Accessory for August/Yale Doorbell
 * Provides motion sensor, doorbell sensor, and camera capabilities
 */
export class DoorbellDevice {
  public readonly platform: AugustPlatform
  public readonly accessory: PlatformAccessory
  public device: DoorbellBaseDevice & doorbellConfig

  protected readonly hap
  // Services
  private DoorbellService?: {
    Name: CharacteristicValue
    Service: Service
    ProgrammableSwitchEvent: CharacteristicValue
  }

  private MotionSensor?: {
    Name: CharacteristicValue
    Service: Service
    MotionDetected: CharacteristicValue
  }

  private CameraService?: {
    Name: CharacteristicValue
    Service: Service
  }

  private Battery: {
    Name: CharacteristicValue
    Service: Service
    BatteryLevel: CharacteristicValue
    StatusLowBattery: CharacteristicValue
    ChargingState: CharacteristicValue
  }

  // Doorbell properties
  doorbellDetails!: doorbellDetail
  lastMotionTime = 0
  lastDingTime = 0

  // Update tracking
  doorbellUpdateInProgress: boolean
  doDoorbellUpdate: any

  constructor(
    platform: AugustPlatform,
    accessory: PlatformAccessory,
    device: DoorbellBaseDevice & doorbellConfig,
  ) {
    this.platform = platform
    this.accessory = accessory
    this.device = device
    this.hap = this.platform.api.hap

    // Initialize update subject
    this.doDoorbellUpdate = new Subject()
    this.doorbellUpdateInProgress = false

    // Initialize Doorbell Service
    if (device.hide_device) {
      if (this.DoorbellService?.Service) {
        this.debugLog('Removing Doorbell Service')
        this.DoorbellService.Service = accessory.getService(this.hap.Service.Doorbell) as Service
        accessory.removeService(this.DoorbellService.Service)
        accessory.context.DoorbellService = {}
      }
    } else {
      accessory.context.DoorbellService = accessory.context.DoorbellService ?? {}
      this.DoorbellService = {
        Name: accessory.displayName,
        Service: accessory.getService(this.hap.Service.Doorbell) ?? accessory.addService(this.hap.Service.Doorbell) as Service,
        ProgrammableSwitchEvent: accessory.context.ProgrammableSwitchEvent ?? this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      }
      accessory.context.DoorbellService = this.DoorbellService as object

      // Set up doorbell characteristics
      this.DoorbellService.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.DoorbellService.Name)
        .getCharacteristic(this.hap.Characteristic.ProgrammableSwitchEvent)
        .onGet(() => {
          return this.DoorbellService!.ProgrammableSwitchEvent
        })
    }

    // Initialize Motion Sensor Service
    if (device.hide_motion_sensor) {
      if (this.MotionSensor?.Service) {
        this.debugLog('Removing Motion Sensor Service')
        this.MotionSensor.Service = accessory.getService(this.hap.Service.MotionSensor) as Service
        accessory.removeService(this.MotionSensor.Service)
        accessory.context.MotionSensor = {}
      }
    } else {
      accessory.context.MotionSensor = accessory.context.MotionSensor ?? {}
      this.MotionSensor = {
        Name: `${accessory.displayName} Motion`,
        Service: accessory.getService(this.hap.Service.MotionSensor) ?? accessory.addService(this.hap.Service.MotionSensor, 'Motion Sensor') as Service,
        MotionDetected: accessory.context.MotionDetected ?? false,
      }
      accessory.context.MotionSensor = this.MotionSensor as object

      // Set up motion sensor characteristics
      this.MotionSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.MotionSensor.Name)
        .getCharacteristic(this.hap.Characteristic.MotionDetected)
        .onGet(() => {
          return this.MotionSensor!.MotionDetected
        })
    }

    // Initialize Battery Service
    accessory.context.Battery = accessory.context.Battery ?? {}
    this.Battery = {
      Name: `${accessory.displayName} Battery`,
      Service: accessory.getService(this.hap.Service.Battery) ?? accessory.addService(this.hap.Service.Battery) as Service,
      BatteryLevel: accessory.context.BatteryLevel ?? 100,
      StatusLowBattery: accessory.context.StatusLowBattery ?? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      ChargingState: accessory.context.ChargingState ?? this.hap.Characteristic.ChargingState.NOT_CHARGEABLE,
    }
    accessory.context.Battery = this.Battery as object

    // Set up battery characteristics
    this.Battery.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Battery.Name)
      .setCharacteristic(this.hap.Characteristic.ChargingState, this.Battery.ChargingState)
      .getCharacteristic(this.hap.Characteristic.BatteryLevel)
      .onGet(() => {
        return this.Battery.BatteryLevel
      })

    this.Battery.Service
      .getCharacteristic(this.hap.Characteristic.StatusLowBattery)
      .onGet(() => {
        return this.Battery.StatusLowBattery
      })

    // Start the update interval
    this.doDoorbellUpdate
      .pipe(
        debounceTime((this.platform.platformUpdateRate || 300) * 1000),
        skipWhile(() => this.doorbellUpdateInProgress),
      )
      .subscribe(async () => {
        this.doorbellUpdateInProgress = true
        await this.updateHomeKitCharacteristics()
        this.doorbellUpdateInProgress = false
      })

    // Start the refresh interval
    interval((this.accessory.context.refreshRate || 300) * 1000)
      .pipe(skipWhile(() => this.doorbellUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })

    // Initial status refresh
    this.refreshStatus()
  }

  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.DoorbellService?.Service) {
      this.DoorbellService.Service.updateCharacteristic(
        this.hap.Characteristic.ProgrammableSwitchEvent,
        this.DoorbellService.ProgrammableSwitchEvent,
      )
    }

    if (this.MotionSensor?.Service) {
      this.MotionSensor.Service.updateCharacteristic(
        this.hap.Characteristic.MotionDetected,
        this.MotionSensor.MotionDetected,
      )
    }

    if (this.Battery?.Service) {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel)
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery)
    }

    await this.debugLog('Updated HomeKit characteristics')
  }

  async refreshStatus(): Promise<void> {
    try {
      // Get doorbell details from enhanced API
      if (this.platform.augustEnhancedApi) {
        const doorbellDetails = await this.platform.augustEnhancedApi.getDoorbellDetail(this.device.deviceId)
        await this.parseStatus(doorbellDetails)
      }
    } catch (e: any) {
      if (e.message?.includes('Unauthorized') || e.message?.includes('401')) {
        await this.errorLog(`Received unauthorized error, attempting to re-authenticate: ${e.message ?? e}`)
        try {
          await this.platform.refreshAugustSession()
          await this.platform.validated()
        } catch (authError: any) {
          await this.errorLog(`Re-authentication failed: ${authError.message ?? authError}`)
        }
      } else {
        await this.errorLog(`Failed to refresh doorbell status: ${e.message ?? e}`)
      }

      // Always trigger an update even if there's an error
      this.doDoorbellUpdate.next('Doorbell')
    }
  }

  async parseStatus(doorbellDetails: doorbellDetail): Promise<void> {
    this.doorbellDetails = doorbellDetails

    // Update battery level if available
    if (doorbellDetails.batteryLevel !== undefined) {
      this.Battery.BatteryLevel = Math.max(0, Math.min(100, doorbellDetails.batteryLevel))
      this.Battery.StatusLowBattery = this.Battery.BatteryLevel <= 20
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    }

    // Check for recent activity
    const now = Date.now()
    const activityThreshold = 30 * 1000 // 30 seconds

    // Check for recent motion
    if (doorbellDetails.status?.lastMotion) {
      const lastMotionTime = new Date(doorbellDetails.status.lastMotion).getTime()
      const isRecentMotion = (now - lastMotionTime) < activityThreshold

      if (isRecentMotion && this.MotionSensor) {
        this.MotionSensor.MotionDetected = true
        await this.debugLog(`Motion detected at ${doorbellDetails.status.lastMotion}`)

        // Clear motion after threshold
        setTimeout(() => {
          if (this.MotionSensor) {
            this.MotionSensor.MotionDetected = false
            this.doDoorbellUpdate.next('Motion Reset')
          }
        }, activityThreshold)
      }
    }

    // Check for recent doorbell press
    if (doorbellDetails.status?.lastDing) {
      const lastDingTime = new Date(doorbellDetails.status.lastDing).getTime()
      const isRecentDing = (now - lastDingTime) < activityThreshold

      if (isRecentDing && this.DoorbellService && lastDingTime > this.lastDingTime) {
        this.lastDingTime = lastDingTime
        this.DoorbellService.ProgrammableSwitchEvent = this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
        await this.debugLog(`Doorbell pressed at ${doorbellDetails.status.lastDing}`)
      }
    }

    await this.debugLog(`Parsed doorbell status: Battery ${this.Battery.BatteryLevel}%, Online: ${doorbellDetails.isOnline}`)

    // Trigger characteristic updates
    this.doDoorbellUpdate.next('Doorbell Status Updated')
  }

  async wakeupDoorbell(): Promise<void> {
    try {
      if (this.platform.augustEnhancedApi) {
        await this.platform.augustEnhancedApi.wakeupDoorbell(this.device.deviceId)
        await this.debugLog('Doorbell wakeup command sent')
      }
    } catch (e: any) {
      await this.errorLog(`Failed to wake up doorbell: ${e.message ?? e}`)
    }
  }

  // Override methods from deviceBase to handle doorbell-specific logging
  async infoLog(message: string): Promise<void> {
    if (this.enablDebugMode()) {
      this.platform.log.info('[%s] %s', this.accessory.displayName, message)
    }
  }

  async warnLog(message: string): Promise<void> {
    this.platform.log.warn('[%s] %s', this.accessory.displayName, message)
  }

  async debugWarnLog(message: string): Promise<void> {
    if (this.enablDebugMode()) {
      this.platform.log.warn('[%s] %s', this.accessory.displayName, message)
    }
  }

  async errorLog(message: string): Promise<void> {
    this.platform.log.error('[%s] %s', this.accessory.displayName, message)
  }

  async debugErrorLog(message: string): Promise<void> {
    if (this.enablDebugMode()) {
      this.platform.log.error('[%s] %s', this.accessory.displayName, message)
    }
  }

  async debugLog(message: string): Promise<void> {
    if (this.enablDebugMode()) {
      this.platform.log.debug('[%s] %s', this.accessory.displayName, message)
    }
  }

  enablDebugMode(): boolean {
    return this.accessory.context.debugMode || this.platform.debugMode
  }
}
