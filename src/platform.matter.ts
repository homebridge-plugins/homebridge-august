/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.matter.ts: homebridge-august Matter platform.
 */
import type { MatterAccessory, MatterAPI, PlatformAccessory } from 'homebridge'

import type { device, devicesConfig, lockEvent } from './settings.js'

import August from 'august-yale'
import { timer } from 'rxjs'
import { exhaustMap } from 'rxjs/operators'

import { AugustPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

/**
 * AugustMatterPlatform
 * Extends AugustPlatform to register August locks as Matter DoorLock accessories
 * instead of HAP accessories. Used when Homebridge Matter support is available,
 * enabled, and not disabled by the `disableMatter` config option.
 */
export class AugustMatterPlatform extends AugustPlatform {
  // Track restored Matter cached accessories
  public readonly matterAccessories: Map<string, MatterAccessory> = new Map()

  /**
   * Called when homebridge restores cached HAP accessories from disk at startup.
   * Since this platform now registers Matter accessories instead of HAP accessories,
   * any restored cached HAP accessories must be unregistered to avoid orphaned
   * or duplicate accessories after migration from HAP to Matter.
   */
  override async configureAccessory(accessory: PlatformAccessory): Promise<void> {
    this.log.debug(`Removing cached HAP accessory migrated to Matter: ${accessory.displayName}`)
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
  }

  /**
   * Called when homebridge restores cached Matter accessories from disk at startup.
   * Stores the restored accessory so we can update it later during device discovery.
   */
  configureMatterAccessory(accessory: MatterAccessory): void {
    this.log.debug(`Loading cached Matter accessory: ${accessory.displayName}`)
    this.matterAccessories.set(accessory.UUID, accessory)
  }

  /**
   * Register an August lock as a Matter DoorLock accessory.
   * Overrides the HAP-based Lock() method from AugustPlatform.
   */
  protected override async Lock(device: device & devicesConfig): Promise<void> {
    const matterApi: MatterAPI = this.api.matter
    if (!matterApi) {
      await this.errorLog('Matter API is not available. Cannot register Matter accessory.')
      return
    }

    const uuid = matterApi.uuid.generate(device.lockId)

    // Determine whether the device should be registered. If not, clean up any stale Matter
    // accessory from a previous session and return early.
    const shouldRegister = await this.registerDevice(device)
    if (!shouldRegister) {
      const staleAccessory = this.matterAccessories.get(uuid)
      if (staleAccessory) {
        await matterApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [staleAccessory])
        this.matterAccessories.delete(uuid)
        await this.warnLog(`Removing stale Matter accessory: ${device.LockName} (${device.lockId})`)
      }
      await this.debugErrorLog(
        `Unable to Register: ${device.LockName}, Lock ID: ${device.lockId} Check Config to see if is being Hidden.`,
      )
      return
    }

    const displayName = device.configLockName
      ? await this.validateAndCleanDisplayName(device.configLockName, 'configLockName', device.configLockName)
      : await this.validateAndCleanDisplayName(device.LockName, 'LockName', device.LockName)

    const existingAccessory = this.matterAccessories.get(uuid)

    const accessory: MatterAccessory = {
      UUID: uuid,
      displayName,
      deviceType: matterApi.deviceTypes.DoorLock,
      serialNumber: device.SerialNumber || device.lockId,
      manufacturer: 'August Home Inc.',
      model: device.skuNumber || 'August Lock',
      firmwareRevision: device.currentFirmwareVersion || this.version || '0.0.0',
      hardwareRevision: device.currentFirmwareVersion || this.version || '0.0.0',
      context: {
        lockId: device.lockId,
      },
      clusters: {
        doorLock: {
          // LockState: 0 = NotFullyLocked (unknown until first poll), 1 = Locked, 2 = Unlocked.
          // timer(0, ...) fires immediately so accurate state is pushed on the first poll tick.
          lockState: 0,
          lockType: 0, // 0 = DeadBolt
          actuatorEnabled: true,
          operatingMode: 0, // 0 = Normal
        },
      },
      handlers: {
        doorLock: {
          lockDoor: async () => {
            try {
              await this.augustCredentials()
              await this.augustConfig.lock(device.lockId)
              await this.successLog(`Matter: Locked ${displayName}`)
              await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState: 1 })
            }
            catch (e: any) {
              await this.errorLog(`Matter: lockDoor failed: ${e.message ?? e}`)
            }
          },
          unlockDoor: async () => {
            try {
              await this.augustCredentials()
              await this.augustConfig.unlock(device.lockId)
              await this.successLog(`Matter: Unlocked ${displayName}`)
              await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState: 2 })
            }
            catch (e: any) {
              await this.errorLog(`Matter: unlockDoor failed: ${e.message ?? e}`)
            }
          },
        },
      },
    }

    if (existingAccessory) {
      await this.infoLog(`Restoring existing Matter accessory from cache: ${displayName}, Lock ID: ${device.lockId}`)
    }
    else {
      await this.infoLog(`Adding new Matter accessory: ${displayName}, Lock ID: ${device.lockId}`)
    }

    // Register (or re-register to update handlers/context) with Homebridge Matter
    await matterApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    this.matterAccessories.set(uuid, accessory)

    // Subscribe to August real-time events for instant state updates
    await this.subscribeAugustMatter(device, uuid, matterApi)

    // Start polling for periodic status refresh (fires immediately at 0ms for accurate initial state)
    this.startMatterStatusPolling(device, uuid, matterApi)
  }

  /**
   * Subscribe to August real-time lock events and update the Matter DoorLock state.
   */
  private async subscribeAugustMatter(
    device: device & devicesConfig,
    uuid: string,
    matterApi: MatterAPI,
  ): Promise<void> {
    try {
      await this.augustCredentials()
      if (this.config.credentials) {
        const normalizedCredentials = await this.getNormalizedCredentials()
        await August.subscribe(normalizedCredentials, device.lockId, async (augustEvent: lockEvent, _timestamp: Date) => {
          await this.debugLog(`Matter AugustEvent: ${JSON.stringify(augustEvent)}`)
          if (augustEvent.state) {
            let lockState: number
            // If both flags are somehow set simultaneously, treat as Locked (fail-safe).
            if (augustEvent.state.locked) {
              lockState = 1 // Locked
            }
            else if (augustEvent.state.unlocked) {
              lockState = 2 // Unlocked
            }
            else {
              lockState = 0 // NotFullyLocked / unknown
            }
            try {
              await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState })
              await this.debugLog(`Matter: Updated lockState to ${lockState} for ${device.LockName}`)
            }
            catch (e: any) {
              await this.errorLog(`Matter: updateAccessoryState failed: ${e.message ?? e}`)
            }
          }
        })
        // Register re-subscribe callback so session refresh re-establishes the subscription
        this.registerResubscribeCallback(
          device.lockId,
          () => this.subscribeAugustMatter(device, uuid, matterApi),
        )
      }
    }
    catch (e: any) {
      await this.errorLog(`Matter: subscribeAugust failed: ${e.message ?? e}`)
    }
  }

  /**
   * Fetch the current lock status from the August API and update the Matter DoorLock state.
   */
  async fetchAndUpdateMatterLockState(
    device: device & devicesConfig,
    uuid: string,
    matterApi: MatterAPI,
  ): Promise<void> {
    try {
      if (this.augustConfig?.details) {
        const lockDetails: any = await this.augustConfig.details(device.lockId)
        if (lockDetails?.LockStatus?.state) {
          const state = lockDetails.LockStatus.state
          let lockState: number
          // If both flags are somehow set simultaneously, treat as Locked (fail-safe).
          if (state.locked) {
            lockState = 1 // Locked
          }
          else if (state.unlocked) {
            lockState = 2 // Unlocked
          }
          else {
            lockState = 0 // NotFullyLocked / unknown
          }
          await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState })
          await this.debugLog(`Matter: Poll updated lockState to ${lockState} for ${device.LockName}`)
        }
      }
    }
    catch (e: any) {
      await this.debugLog(`Matter: refreshStatus failed: ${e.message ?? e}`)
    }
  }

  /**
   * Poll the August API for lock status at the configured refresh rate and update the Matter
   * DoorLock state. Uses `timer(0, ...)` for an immediate first fetch (accurate initial state)
   * and `exhaustMap` to prevent overlapping concurrent requests.
   */
  private startMatterStatusPolling(
    device: device & devicesConfig,
    uuid: string,
    matterApi: MatterAPI,
  ): void {
    const refreshRate = this.platformRefreshRate ?? 30
    if (refreshRate === 0) {
      return
    }

    timer(0, refreshRate * 1000)
      .pipe(
        exhaustMap(() => this.fetchAndUpdateMatterLockState(device, uuid, matterApi)),
      )
      .subscribe()
  }
}
