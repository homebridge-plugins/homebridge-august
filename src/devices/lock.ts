import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { AugustPlatform } from '../platform.js'
import type { device, devicesConfig, lockDetails, lockEvent, lockStatus } from '../settings.js'

/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * lock.ts: homebridge-august.
 */
import August from 'august-yale'
import { Subject } from 'rxjs'
import { debounceTime, tap } from 'rxjs/operators'

import { deviceBase } from './device.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockMechanism extends deviceBase {
  // Service
  private LockMechanism?: {
    Name: CharacteristicValue
    Service: Service
    LockTargetState: CharacteristicValue
    LockCurrentState: CharacteristicValue
  }

  private Battery: {
    Name: CharacteristicValue
    Service: Service
    BatteryLevel: CharacteristicValue
    StatusLowBattery: CharacteristicValue
    ChargingState: CharacteristicValue
  }

  private ContactSensor?: {
    Name: CharacteristicValue
    Service: Service
    ContactSensorState: CharacteristicValue
  }

  // Lock Mechanism
  lockEvent!: lockEvent
  lockStatus!: lockStatus
  lockDetails!: lockDetails

  // Lock Updates
  lockUpdateInProgress: boolean
  doLockUpdate: any

  // PubNub subscription cleanup function. Captured from August.subscribe()
  // so the subscription can be properly torn down (both when the lock is
  // unregistered and before creating a replacement subscription).
  private pubnubUnsubscribe?: () => void

  constructor(
    readonly platform: AugustPlatform,
    accessory: PlatformAccessory,
    device: device & devicesConfig,
  ) {
    super(platform, accessory, device)

    // this is subject we use to track when we need to POST changes to the August API
    this.doLockUpdate = new Subject()
    this.lockUpdateInProgress = false

    // Initialize Lock Mechanism Service
    if (device.lock?.hide_lock) {
      if (this.LockMechanism?.Service) {
        this.debugLog('Removing Lock Mechanism Service')
        this.LockMechanism.Service = accessory.getService(this.hap.Service.LockMechanism) as Service
        accessory.removeService(this.LockMechanism.Service)
        accessory.context.LockMechanism = {}
      }
    } else {
      accessory.context.LockMechanism = accessory.context.LockMechanism ?? {}
      this.LockMechanism = {
        Name: accessory.displayName,
        Service: accessory.getService(this.hap.Service.LockMechanism) ?? accessory.addService(this.hap.Service.LockMechanism) as Service,
        LockTargetState: accessory.context.LockMechanismLockTargetState ?? this.hap.Characteristic.LockTargetState.SECURED,
        LockCurrentState: accessory.context.LockMechanismLockCurrentState ?? this.hap.Characteristic.LockCurrentState.SECURED,
      }
      accessory.context.LockMechanism = this.LockMechanism as object
      // Seed context keys for updateCharacteristic change detection
      accessory.context.LockMechanismLockCurrentState ??= this.LockMechanism.LockCurrentState
      accessory.context.LockMechanismLockTargetState ??= this.LockMechanism.LockTargetState
      // Initialize Lock Mechanism Characteristics
      this.LockMechanism.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.LockMechanism.Name)
        .getCharacteristic(this.hap.Characteristic.LockTargetState)
        .onGet(() => {
          return this.LockMechanism!.LockTargetState
        })
        .onSet(this.setLockTargetState.bind(this))
    }
    // Initialize Contact Sensor Service
    if (device.lock?.hide_contactsensor) {
      if (this.ContactSensor?.Service) {
        this.debugLog('Removing Conact Sensor Service')
        this.ContactSensor.Service = accessory.getService(this.hap.Service.ContactSensor) as Service
        accessory.removeService(this.ContactSensor.Service)
        accessory.context.ContactSensor = {}
      }
    } else {
      accessory.context.ContactSensor = accessory.context.ContactSensor ?? {}
      this.ContactSensor = {
        Name: `${accessory.displayName} Contact Sensor`,
        Service: accessory.getService(this.hap.Service.ContactSensor) ?? accessory.addService(this.hap.Service.ContactSensor) as Service,
        ContactSensorState: accessory.context.ContactSensorContactSensorState ?? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED,
      }
      accessory.context.ContactSensor = this.ContactSensor as object
      // Seed context key for updateCharacteristic change detection
      accessory.context.ContactSensorContactSensorState ??= this.ContactSensor.ContactSensorState
      // Initialize Conact Sensor Characteristics
      this.ContactSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.ContactSensor.Name)
        .getCharacteristic(this.hap.Characteristic.ContactSensorState)
        .onGet(() => {
          return this.ContactSensor!.ContactSensorState
        })
    }

    // Initialize Battery Service
    accessory.context.Battery = accessory.context.Battery ?? {}
    this.Battery = {
      Name: `${accessory.displayName} Battery`,
      Service: accessory.getService(this.hap.Service.Battery) ?? accessory.addService(this.hap.Service.Battery) as Service,
      BatteryLevel: accessory.context.BatteryBatteryLevel ?? 100,
      StatusLowBattery: accessory.context.BatteryStatusLowBattery ?? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      ChargingState: accessory.context.ChargingState ?? this.hap.Characteristic.ChargingState.NOT_CHARGING,
    }
    accessory.context.Battery = this.Battery as object
    // Seed context keys for updateCharacteristic change detection
    accessory.context.BatteryBatteryLevel ??= this.Battery.BatteryLevel
    accessory.context.BatteryStatusLowBattery ??= this.Battery.StatusLowBattery
    // Initialize Battery Characteristics
    this.Battery.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Battery.Name)
      .setCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGEABLE)
      .getCharacteristic(this.hap.Characteristic.BatteryLevel)
      .onGet(() => {
        return this.Battery.BatteryLevel
      })

    this.Battery.Service
      .getCharacteristic(this.hap.Characteristic.StatusLowBattery)
      .onGet(() => {
        return this.Battery.StatusLowBattery
      })

    // Initial Device Refresh
    this.refreshStatus()

    // Subscribe to august changes. PubNub subscriptions are independent of
    // the HTTP session and survive refreshAugustSession() — no resubscribe
    // needed. The August.subscribe() call uses its own internal August
    // instance dedicated to PubNub, separate from platform.augustConfig.
    this.subscribeAugust()

    // Polling is now owned by the platform. AugustPlatform.startPolling()
    // iterates registered locks serially and short-circuits on the first
    // failure, so a network outage produces ONE timeout per cycle instead
    // of N (one per lock). The previous per-lock rxjs interval that lived
    // here was the source of the log-spam cascade after router restarts.

    // Watch for Lock change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    if (!device.lock?.hide_lock) {
      this.doLockUpdate
        .pipe(
          tap(() => {
            this.lockUpdateInProgress = true
          }),
          debounceTime(this.devicePushRate * 1000),
        )
        .subscribe(async () => {
          try {
            await this.pushChanges()
          } catch (e: any) {
            await this.statusCode('pushChanges', e)
            await this.errorLog(`doLockUpdate pushChanges: ${e.message ?? e}`)
          }
          this.lockUpdateInProgress = false
        })
    }
  }

  /**
   * Parse the device status from the August api
   */
  async parseStatus(): Promise<void> {
    await this.debugLog('parseStatus')
    const retryCount = 1
    if (this.lockStatus) {
      if (this.lockStatus.state) {
      // Lock Mechanism
        this.platform.augustConfig?.addSimpleProps(this.lockStatus)
        if (this.LockMechanism && (this.lockStatus.state.unlocking || this.lockStatus.state.locking)) {
          await this.warnLog(`LockCurrentState: ${this.LockMechanism.LockCurrentState}, locking/unlocking parseStatus`
            + ` lockStatus: ${JSON.stringify(this.lockStatus)}`)
        }
        if (!this.device.lock?.hide_lock && this.LockMechanism?.Service && (this.lockStatus.state.locked !== this.lockStatus.state.unlocked)) {
          this.LockMechanism.LockCurrentState = this.lockStatus.state.locked
            ? this.hap.Characteristic.LockCurrentState.SECURED
            : this.lockStatus.state.unlocked
              ? this.hap.Characteristic.LockCurrentState.UNSECURED
              : retryCount > 1 ? this.hap.Characteristic.LockCurrentState.JAMMED : this.hap.Characteristic.LockCurrentState.UNKNOWN
          if (!this.lockUpdateInProgress) {
            this.LockMechanism.LockTargetState = this.LockMechanism.LockCurrentState
          }

          if (this.LockMechanism.LockCurrentState === this.hap.Characteristic.LockCurrentState.UNKNOWN) {
            await this.warnLog(`LockCurrentState: ${this.LockMechanism.LockCurrentState}, (UNKNOWN) parseStatus`
              + ` lockStatus: ${JSON.stringify(this.lockStatus)}`)
          }
          await this.debugLog(`LockCurrentState: ${this.LockMechanism.LockCurrentState}`)
          await this.debugLog(`LockTargetState: ${this.LockMechanism.LockTargetState}`)
        }
        // Contact Sensor
        if (!this.device.lock?.hide_contactsensor && this.ContactSensor?.Service) {
        // ContactSensorState
          this.ContactSensor.ContactSensorState = this.lockStatus.state.open
            ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.lockStatus.state.closed
              ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
              : this.lockStatus.doorState?.includes('open')
                ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : this.lockStatus.doorState?.includes('closed')
                  ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
                  : this.ContactSensor.ContactSensorState
          await this.debugLog(`ContactSensorState: ${this.ContactSensor.ContactSensorState}`)
        }
      } else {
        await this.debugWarnLog(`lockStatus state: ${JSON.stringify(this.lockStatus)}`)
      }
    }
    if (this.lockDetails) {
      // BatteryLevel
      this.Battery.BatteryLevel = Math.min(Math.max(Number((this.lockDetails.battery * 100).toFixed()), 0), 100)
      await this.debugLog(`BatteryLevel: ${this.Battery.BatteryLevel}`)
      // StatusLowBattery
      this.Battery.StatusLowBattery = this.Battery.BatteryLevel < 15
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
      await this.debugLog(`StatusLowBattery: ${this.Battery.StatusLowBattery}`)
      // Firmware Version
      if (this.accessory.context.currentFirmwareVersion !== this.lockDetails.currentFirmwareVersion) {
        await this.warnLog(`Firmware Version changed to Current Firmware Version: ${this.lockDetails.currentFirmwareVersion}`)
        this.accessory
          .getService(this.hap.Service.AccessoryInformation)!
          .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.lockDetails.currentFirmwareVersion)
          .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.lockDetails.currentFirmwareVersion)
          .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
          .updateValue(this.lockDetails.currentFirmwareVersion)
        this.accessory.context.currentFirmwareVersion = this.lockDetails.currentFirmwareVersion
      }
    }
  }

  /**
   * Parse the device status from the August api
   */
  async parseEventStatus(): Promise<void> {
    await this.debugLog('parseEventStatus')
    const retryCount = 1
    if (this.lockEvent) {
      if (this.lockEvent.state) {
        this.debugLog(`lockEvent: ${JSON.stringify(this.lockEvent)}`)
        // Lock Mechanism
        this.platform.augustConfig?.addSimpleProps(this.lockEvent)
        if (this.LockMechanism && (this.lockEvent.state.unlocking || this.lockEvent.state.locking)) {
          await this.debugLog(`is  ${this.lockEvent.state.unlocking ? 'Unlocking' : this.lockEvent.state.locking ? 'Locking' : ''}, parseEventStatus`
            + ` lockEventState: ${JSON.stringify(this.lockEvent.state)}`)
          return
        }
        if (!this.device.lock?.hide_lock && this.LockMechanism?.Service && (this.lockEvent.state.locked !== this.lockEvent.state.unlocked)) {
          this.LockMechanism.LockCurrentState = this.lockEvent.state.locked
            ? this.hap.Characteristic.LockCurrentState.SECURED
            : this.lockEvent.state.unlocked
              ? this.hap.Characteristic.LockCurrentState.UNSECURED
              : retryCount > 1 ? this.hap.Characteristic.LockCurrentState.JAMMED : this.hap.Characteristic.LockCurrentState.UNKNOWN
          if (!this.lockUpdateInProgress) {
            this.LockMechanism.LockTargetState = this.LockMechanism.LockCurrentState
          }

          if (this.LockMechanism.LockCurrentState === this.hap.Characteristic.LockCurrentState.UNKNOWN) {
            await this.warnLog(`LockCurrentState: ${this.LockMechanism.LockCurrentState}, (UNKNOWN) parseEventStatus`
              + ` lockEvent: ${JSON.stringify(this.lockEvent)}`)
          }
          await this.debugLog(`LockCurrentState: ${this.LockMechanism.LockCurrentState}`)
          await this.debugLog(`LockTargetState: ${this.LockMechanism.LockTargetState}`)
        }
        // Contact Sensor
        if (!this.device.lock?.hide_contactsensor && this.ContactSensor?.Service) {
        // ContactSensorState
          this.ContactSensor.ContactSensorState = this.lockEvent.state.open
            ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.lockEvent.state.closed
              ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
              : this.lockEvent.doorState === 'open'
                ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : this.lockEvent.doorState === 'closed'
                  ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
                  : this.ContactSensor.ContactSensorState
          await this.debugLog(`ContactSensorState: ${this.ContactSensor.ContactSensorState}`)
        }
      } else {
        await this.debugWarnLog(`lovckEvent state: ${JSON.stringify(this.lockStatus)}`)
      }
    }
  }

  /**
   * Asks the August Home API for the latest device information.
   *
   * Used for the initial fetch in the constructor. Periodic polling is
   * driven by AugustPlatform.startPolling(), which calls applyRefresh()
   * directly with details fetched serially across all registered locks.
   *
   * On failure: returns silently. The ConnectivityManager has already
   * classified the error and (if it's a network error) put itself into
   * 'degraded' state — a probe is scheduled and the next poll cycle
   * will skip until the probe confirms recovery.
   */
  async refreshStatus(): Promise<void> {
    if (this.deviceRefreshRate === 0) {
      await this.debugLog(`(refreshStatus) deviceRefreshRate: ${this.deviceRefreshRate}`)
      return
    }
    if (!this.platform.connectivity) {
      await this.debugLog('(refreshStatus) connectivity not initialized — skipping')
      return
    }
    const lockDetails = await this.platform.connectivity.execute(
      `refreshStatus ${this.accessory.displayName}`,
      client => client.details(this.device.lockId),
    )
    if (lockDetails === undefined) {
      // Either offline, or the call failed. ConnectivityManager has the
      // state machine; nothing to do here.
      return
    }
    await this.applyRefresh(lockDetails as unknown as lockDetails)
  }

  /**
   * Apply a freshly-fetched lockDetails payload to HomeKit characteristics.
   *
   * Public so AugustPlatform.startPolling() can hand-off the result of
   * its serial details() call without going through refreshStatus()
   * (which would re-fetch).
   */
  async applyRefresh(lockDetails: lockDetails): Promise<void> {
    await this.debugSuccessLog(`(applyRefresh) lockDetails: ${JSON.stringify(lockDetails)}`)
    this.lockDetails = lockDetails
    this.lockStatus = lockDetails.LockStatus
    await this.parseStatus()
    await this.updateHomeKitCharacteristics()
  }

  /**
   * Pushes the requested changes to the August API
   */
  async pushChanges(): Promise<void> {
    if (!this.LockMechanism) {
      await this.errorLog(`lockTargetState: ${JSON.stringify(this.LockMechanism)}`)
      return
    }
    const targetState = this.LockMechanism.LockTargetState
    const currentState = this.LockMechanism.LockCurrentState
    if (targetState === currentState) {
      await this.debugLog(`No changes, LockTargetState: ${targetState}, LockCurrentState: ${currentState}`)
      this.LockMechanism.LockTargetState = currentState === this.hap.Characteristic.LockCurrentState.SECURED
        ? this.hap.Characteristic.LockTargetState.SECURED
        : this.hap.Characteristic.LockTargetState.UNSECURED
      await this.updateHomeKitCharacteristics()
      return
    }

    await this.debugLog(`Making API call - Target: ${targetState}, Current: ${currentState}`)

    if (!this.platform.connectivity) {
      await this.errorLog('pushChanges: connectivity not initialized')
      return
    }

    try {
      // throwOnOffline:true: user-initiated lock/unlock should fail
      // visibly to HomeKit when the network is down rather than
      // silently dropping the request. The ConnectivityManager
      // classifies the error and updates state, but we re-raise so
      // HomeKit sees a real failure.
      //
      // The manager handles auth/network failures internally
      // (rebuilds the client on auth, schedules a probe on network),
      // so the explicit retry block that used to live here is gone.
      // If the user retries the action, the manager will either be
      // recovered by then or still offline (and throw OfflineError
      // again).
      await this.platform.connectivity.execute(
        `pushChanges ${this.device.lockId}`,
        async (client) => {
          if (targetState === this.hap.Characteristic.LockTargetState.UNSECURED) {
            await client.unlock(this.device.lockId)
          } else {
            await client.lock(this.device.lockId)
          }
        },
        { throwOnOffline: true },
      )
      await this.successLog(`Sending request to August API: ${targetState === 1 ? 'Locked' : 'Unlocked'}`)
      await this.updateHomeKitCharacteristics()
    } catch (e: any) {
      await this.statusCode('pushChanges', e)
      await this.errorLog(`pushChanges: ${e.message ?? e}`)
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    await this.debugLog('updateHomeKitCharacteristics')
    // Lock Mechanism
    if (!this.device.lock?.hide_lock && this.LockMechanism?.Service) {
      // LockTargetState
      await this.updateCharacteristic(this.LockMechanism.Service, 'LockMechanism', this.hap.Characteristic.LockTargetState, this.LockMechanism.LockTargetState, 'LockTargetState')
      // LockCurrentState
      await this.updateCharacteristic(this.LockMechanism.Service, 'LockMechanism', this.hap.Characteristic.LockCurrentState, this.LockMechanism.LockCurrentState, 'LockCurrentState', 1, 'Locked', 'Unlocked')
    }
    // Battery
    // BatteryLevel
    await this.updateCharacteristic(this.Battery.Service, 'Battery', this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel, 'BatteryLevel')
    // StatusLowBattery
    await this.updateCharacteristic(this.Battery.Service, 'Battery', this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery, 'StatusLowBattery')
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor && this.ContactSensor?.Service) {
      // ContactSensorState
      await this.updateCharacteristic(this.ContactSensor.Service, 'ContactSensor', this.hap.Characteristic.ContactSensorState, this.ContactSensor.ContactSensorState, 'ContactSensorState', 1, 'Opened', 'Closed')
    }
  }

  async setLockTargetState(value: CharacteristicValue): Promise<void> {
    if (this.LockMechanism) {
      if (this.LockMechanism.LockTargetState !== this.LockMechanism.LockCurrentState) {
        await this.debugLog(`Set LockTargetState: ${value}`)
      } else {
        await this.debugLog(`No changes, LockTargetState: ${this.LockMechanism.LockTargetState},`
          + ` LockCurrentState: ${this.LockMechanism.LockCurrentState}`)
      }

      this.accessory.context.LockMechanismLockTargetState = this.LockMechanism.LockTargetState = value
      this.doLockUpdate.next()
    }
  }

  async subscribeAugust(): Promise<void> {
    await this.debugLog('subscribeAugust')
    await this.platform.augustCredentials()
    if (this.config.credentials) {
      // Clean up any previous subscription before creating a new one.
      // This is defensive: subscribeAugust() is currently only called once
      // from the constructor, but this makes the method idempotent and safe
      // to call again in the future.
      this.tearDownPubNubSubscription()

      const normalizedCredentials = await this.platform.getNormalizedCredentials()
      this.pubnubUnsubscribe = await August.subscribe(normalizedCredentials, this.device.lockId, async (AugustEvent: lockEvent, timestamp: Date) => {
        await this.debugLog(`AugustEvent: ${JSON.stringify(AugustEvent)}, ${JSON.stringify(timestamp)}`)
        // Update HomeKit
        this.lockEvent = AugustEvent
        await this.parseEventStatus()
        await this.updateHomeKitCharacteristics()
      })
    } else {
      await this.errorLog('subscribeAugust: No credentials')
    }
  }

  /**
   * Tear down the PubNub subscription for this lock. Safe to call multiple
   * times and when no subscription exists. Called on lock removal to free
   * the PubNub instance, WebSocket connection, and listener.
   */
  tearDownPubNubSubscription(): void {
    if (this.pubnubUnsubscribe) {
      try {
        this.pubnubUnsubscribe()
      } catch (e: any) {
        this.debugLog(`Error tearing down PubNub subscription: ${e.message || e}`)
      }
      this.pubnubUnsubscribe = undefined
    }
  }
}
