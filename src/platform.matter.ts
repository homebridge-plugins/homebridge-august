/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * Platform.Matter.ts: homebridge-august Matter platform.
 */
import type { MatterAccessory, MatterAPI, PlatformAccessory } from 'homebridge'
import type { Subscription } from 'rxjs'

import type { device, devicesConfig, lockEvent } from './settings.js'

import August from 'august-yale'
import { timer } from 'rxjs'
import { exhaustMap } from 'rxjs/operators'

import { AugustPlatform } from './Platform.HAP.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

/**
 * AugustMatterPlatform
 * Extends AugustPlatform to register August locks as Matter DoorLock accessories
 * instead of HAP accessories. Used when Homebridge Matter support is available,
 * enabled, and not disabled by the `disableMatter` config option.
 */
export class AugustMatterPlatform extends AugustPlatform {
  /**
   * Matter's BridgedDeviceBasicInformation.NodeLabel is constrained to 32 characters.
   * Homebridge sets the nodeLabel from the accessory displayName, so longer names make
   * the whole endpoint fail to register with "Behaviors have errors".
   */
  private clampMatterDisplayName(displayName: string): string {
    if (displayName.length <= 32) {
      return displayName
    }
    const clamped = displayName.slice(0, 32).trim()
    this.log.debug(`Display name "${displayName}" exceeds Matter's 32 character limit, using "${clamped}"`)
    return clamped
  }

  // Track restored Matter cached accessories
  public readonly matterAccessories: Map<string, MatterAccessory> = new Map()

  // HAP accessories staged for removal after Matter registration succeeds.
  // Deferred to avoid leaving users with zero accessories if Matter init fails.
  private readonly pendingHapCleanup: Map<string, PlatformAccessory> = new Map()

  // PubNub unsubscribe functions keyed by accessory UUID.
  // Must be captured from August.subscribe() and called on lock removal to
  // prevent accumulating orphaned PubNub instances (equivalent of the fix in
  // lock.ts / PR #206 for the HAP path).
  private readonly matterPubNubUnsubscribes: Map<string, () => void> = new Map()

  // RxJS polling subscriptions keyed by accessory UUID. Must be tracked so
  // they can be unsubscribed when a lock is removed or re-registered, otherwise
  // the polling timer keeps firing forever even after the accessory is gone.
  private readonly matterPollingSubscriptions: Map<string, Subscription> = new Map()

  /**
   * Called when homebridge restores cached HAP accessories from disk at startup.
   * HAP accessories are staged here and removed only after Matter registration
   * succeeds for the same lock, so that if Matter init fails the user is not
   * left with zero accessories.
   */
  override async configureAccessory(accessory: PlatformAccessory): Promise<void> {
    this.log.debug(`Staging cached HAP accessory for deferred cleanup: ${accessory.displayName}`)
    this.pendingHapCleanup.set(accessory.UUID, accessory)
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
   * Run device discovery, then sweep any staged HAP accessories that were not
   * handled during discovery.
   *
   * The normal deferred-cleanup flow removes a staged HAP accessory when Lock()
   * is called for its UUID and Matter registration succeeds. But if a lock has
   * been removed from the user's August account entirely, Lock() is never
   * called for its UUID — leaving the staged HAP accessory registered with
   * Homebridge indefinitely and the pendingHapCleanup map growing on every
   * restart.
   *
   * After discoverDevices() finishes, any remaining entries in
   * pendingHapCleanup correspond to locks no longer in the account, so it is
   * safe to unregister them.
   */
  override async discoverDevices(): Promise<void> {
    await super.discoverDevices()
    await this.sweepUnhandledHapAccessories()
  }

  private async sweepUnhandledHapAccessories(): Promise<void> {
    if (this.pendingHapCleanup.size === 0) {
      return
    }

    // Only a run that actually got a lock list back is evidence about what is on
    // the account. discoverDevices() also returns normally when it got a 401 and
    // asked August for a fresh verification code, having registered nothing - and
    // sweeping on the back of that removed every one of the owner's locks from
    // HomeKit, taking their rooms, scenes and automations with them.
    if (!this.discoveryReturnedDevices) {
      this.log.debug('Leaving the cached HAP accessories alone: no locks were returned this time')
      return
    }
    const accessories = Array.from(this.pendingHapCleanup.values())
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories)
    for (const accessory of accessories) {
      this.log.debug(`Removing unhandled cached HAP accessory (no matching lock found): ${accessory.displayName}`)
    }
    this.pendingHapCleanup.clear()
  }

  /**
   * Register an August lock as a Matter DoorLock accessory.
   * Overrides the HAP-based Lock() method from AugustPlatform.
   */
  protected override async Lock(device: device & devicesConfig): Promise<void> {
    const matterApi = this.api.matter
    if (!matterApi) {
      await this.errorLog('Matter API is not available. Cannot register Matter accessory.')
      return
    }

    const uuid = matterApi.uuid.generate(device.lockId)

    // Determine whether the device should be registered. If not, clean up any stale Matter
    // accessory from a previous session and return early.
    const shouldRegister = await this.registerDevice(device)
    if (!shouldRegister) {
      // Tear down all per-lock state atomically. Whether there's a stale Matter
      // accessory from a previous session, a PubNub subscription, or a polling
      // subscription, they all need to go together when a lock is hidden or
      // removed from the account.
      await this.tearDownMatterLock(uuid, device.LockName, matterApi)
      await this.debugErrorLog(
        `Unable to Register: ${device.LockName}, Lock ID: ${device.lockId} Check Config to see if is being Hidden.`,
      )
      return
    }

    const displayName = this.clampMatterDisplayName(device.configLockName
      ? await this.validateAndCleanDisplayName(device.configLockName, 'configLockName', device.configLockName)
      : await this.validateAndCleanDisplayName(device.LockName, 'LockName', device.LockName))

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
          // Use DoorLock.LockState enum for type safety and readability:
          //   NotFullyLocked = 0 (unknown until first poll), Locked = 1, Unlocked = 2.
          // timer(0, ...) fires immediately so accurate state is pushed on the first poll tick.
          lockState: matterApi.types.DoorLock.LockState.NotFullyLocked,
          lockType: 0, // 0 = DeadBolt
          actuatorEnabled: true,
          operatingMode: 0, // 0 = Normal
        },
        // PowerSource (Battery feature) so the lock battery reaches Matter
        // controllers (e.g. Home Assistant), matching what the HAP Battery
        // service already exposes. Homebridge composes PowerSourceServer
        // .with('Battery') when batPercentRemaining/batChargeLevel are present.
        // Placeholder values until the first poll pushes real ones (below);
        // batPercentRemaining is Matter half-percent (0..200).
        powerSource: {
          status: 1, // PowerSourceStatus.Active
          order: 0,
          description: 'Battery',
          batReplaceability: 2, // UserReplaceable (AA cells)
          batReplacementNeeded: false,
          batChargeLevel: 0, // BatChargeLevel.Ok
          batPercentRemaining: 200, // 100% until first poll
        },
      },
      handlers: {
        doorLock: {
          lockDoor: async () => {
            try {
              await this.augustCredentials()
              if (!this.connectivity) {
                throw new Error('Connectivity not initialized')
              }
              await this.connectivity.execute(
                `Matter lockDoor ${device.lockId}`,
                client => client.lock(device.lockId),
                { throwOnOffline: true },
              )
              await this.successLog(`Matter: Locked ${displayName}`)
              await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState: matterApi.types.DoorLock.LockState.Locked })
            } catch (e: any) {
              await this.errorLog(`Matter: lockDoor failed: ${e.message ?? e}`)
            }
          },
          unlockDoor: async () => {
            try {
              await this.augustCredentials()
              if (!this.connectivity) {
                throw new Error('Connectivity not initialized')
              }
              await this.connectivity.execute(
                `Matter unlockDoor ${device.lockId}`,
                client => client.unlock(device.lockId),
                { throwOnOffline: true },
              )
              await this.successLog(`Matter: Unlocked ${displayName}`)
              await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState: matterApi.types.DoorLock.LockState.Unlocked })
            } catch (e: any) {
              await this.errorLog(`Matter: unlockDoor failed: ${e.message ?? e}`)
            }
          },
        },
      },
    }

    if (existingAccessory) {
      await this.infoLog(`Restoring existing Matter accessory from cache: ${displayName}, Lock ID: ${device.lockId}`)
    } else {
      await this.infoLog(`Adding new Matter accessory: ${displayName}, Lock ID: ${device.lockId}`)
    }

    // Register (or re-register to update handlers/context) with Homebridge Matter
    await matterApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    this.matterAccessories.set(uuid, accessory)

    // After Matter registration succeeds, clean up any staged HAP accessory for this lock.
    // This deferred removal ensures that if Matter registration had failed, the user would
    // have kept the HAP accessory rather than being left with no accessory at all.
    const stagedHapAccessory = this.pendingHapCleanup.get(uuid)
    if (stagedHapAccessory) {
      this.log.debug(`Removing migrated HAP accessory after successful Matter registration: ${stagedHapAccessory.displayName}`)
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [stagedHapAccessory])
      this.pendingHapCleanup.delete(uuid)
    }

    // Subscribe to August real-time events for instant state updates
    await this.subscribeAugustMatter(device, uuid, matterApi)

    // Start polling for periodic status refresh (fires immediately at 0ms for accurate initial state)
    this.startMatterStatusPolling(device, uuid, matterApi)
  }

  /**
   * Subscribe to August real-time lock events and update the Matter DoorLock state.
   * Captures the unsubscribe function returned by August.subscribe() to allow proper
   * cleanup on lock removal (equivalent of the fix in lock.ts / PR #206 for HAP).
   */
  private async subscribeAugustMatter(
    device: device & devicesConfig,
    uuid: string,
    matterApi: MatterAPI,
  ): Promise<void> {
    try {
      await this.augustCredentials()
      if (this.config.credentials) {
        // Tear down any previous subscription for this lock before creating a new one
        // (defensive: makes this method safe to call on re-registration).
        const existingUnsubscribe = this.matterPubNubUnsubscribes.get(uuid)
        if (existingUnsubscribe) {
          try {
            existingUnsubscribe()
          } catch { /* ignore */ }
          this.matterPubNubUnsubscribes.delete(uuid)
        }
        const normalizedCredentials = await this.getNormalizedCredentials()
        const unsubscribe = await August.subscribe(normalizedCredentials, device.lockId, async (augustEvent: lockEvent) => {
          await this.debugLog(`Matter AugustEvent: ${JSON.stringify(augustEvent)}`)
          if (augustEvent.state) {
            const lockState = this.mapLockState(augustEvent.state, matterApi)
            try {
              await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState })
              await this.debugLog(`Matter: Updated lockState to ${lockState} for ${device.LockName}`)
            } catch (e: any) {
              await this.errorLog(`Matter: updateAccessoryState failed: ${e.message ?? e}`)
            }
          }
        })
        if (typeof unsubscribe === 'function') {
          this.matterPubNubUnsubscribes.set(uuid, unsubscribe)
        }
      }
    } catch (e: any) {
      await this.errorLog(`Matter: subscribeAugust failed: ${e.message ?? e}`)
    }
  }

  /**
   * Map an August lock state (from details() or a PubNub event) to a Matter
   * DoorLock.LockState enum value.
   *
   * If both `locked` and `unlocked` are set simultaneously (unexpected), we
   * treat the lock as Locked (fail-safe). If neither is set, we report
   * NotFullyLocked, which is the correct Matter state for "position unknown".
   */
  private mapLockState(
    state: { locked?: boolean, unlocked?: boolean },
    matterApi: MatterAPI,
  ): number {
    if (state.locked) {
      return matterApi.types.DoorLock.LockState.Locked
    }
    if (state.unlocked) {
      return matterApi.types.DoorLock.LockState.Unlocked
    }
    return matterApi.types.DoorLock.LockState.NotFullyLocked
  }

  /**
   * Fetch the current lock status from the August API and update the Matter DoorLock state.
   *
   * Routed through the platform's ConnectivityManager: failures are
   * classified and the state machine handles retry/backoff/probe-driven
   * recovery. No manual session-refresh-and-retry block is needed here
   * — when the network is down, execute() returns undefined and the
   * next poll cycle will skip until the manager confirms recovery.
   */
  async fetchAndUpdateMatterLockState(
    device: device & devicesConfig,
    uuid: string,
    matterApi: MatterAPI,
  ): Promise<void> {
    if (!this.connectivity) {
      await this.debugLog('Matter: connectivity not initialized — skipping')
      return
    }
    const lockDetails = await this.connectivity.execute(
      `Matter poll ${device.lockId}`,
      client => client.details(device.lockId),
    )
    if (lockDetails === undefined) {
      // execute() returned undefined: either offline, or the call
      // failed and the manager has already taken care of state.
      return
    }
    const details = lockDetails as any

    // Battery -> PowerSource. August reports `battery` as a 0..1 fraction;
    // Matter batPercentRemaining is half-percent (0..200). Mirror the HAP
    // Battery service's <15% low threshold. The /locks/{id} detail carries
    // `battery` even when it has no LockStatus.state (lock state is driven by
    // PubNub events / a separate status call), so push the battery BEFORE the
    // lock-state guard below — otherwise a stateless detail response, which is
    // the norm for this endpoint, drops the battery update entirely.
    if (typeof details.battery === 'number') {
      const pct = Math.min(Math.max(details.battery, 0), 1)
      const low = pct < 0.15
      await matterApi.updateAccessoryState(uuid, 'powerSource', {
        batPercentRemaining: Math.round(pct * 200),
        batChargeLevel: pct < 0.10 ? 2 : low ? 1 : 0, // Critical / Warning / Ok
        batReplacementNeeded: low,
      })
      await this.debugLog(`Matter: Poll updated battery to ${Math.round(pct * 100)}% for ${device.LockName}`)
    }

    if (!details?.LockStatus?.state) {
      return
    }
    const lockState = this.mapLockState(details.LockStatus.state, matterApi)
    await matterApi.updateAccessoryState(uuid, 'doorLock', { lockState })
    await this.debugLog(`Matter: Poll updated lockState to ${lockState} for ${device.LockName}`)
  }

  /**
   * Poll the August API for lock status at the configured refresh rate and update the Matter
   * DoorLock state. Uses `timer(0, ...)` for an immediate first fetch (accurate initial state)
   * and `exhaustMap` to prevent overlapping concurrent requests.
   *
   * Idempotent: disposes any previous polling subscription for the same UUID
   * before starting a new one. The subscription is tracked in
   * matterPollingSubscriptions so it can be disposed on lock removal — otherwise
   * the timer keeps firing forever even after the accessory is gone.
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

    // Dispose any previous polling subscription for this UUID before starting a new one
    const existing = this.matterPollingSubscriptions.get(uuid)
    if (existing) {
      existing.unsubscribe()
      this.matterPollingSubscriptions.delete(uuid)
    }

    const subscription = timer(0, refreshRate * 1000)
      .pipe(
        exhaustMap(() => this.fetchAndUpdateMatterLockState(device, uuid, matterApi)),
      )
      .subscribe()
    this.matterPollingSubscriptions.set(uuid, subscription)
  }

  /**
   * Release all resources associated with a given Matter lock UUID:
   * the registered Matter accessory, the PubNub subscription, and the
   * RxJS polling subscription. Safe to call when some or all of these
   * do not exist.
   */
  private async tearDownMatterLock(
    uuid: string,
    lockName: string,
    matterApi: MatterAPI,
  ): Promise<void> {
    // Polling subscription — must be disposed or the timer keeps firing
    const pollingSub = this.matterPollingSubscriptions.get(uuid)
    if (pollingSub) {
      pollingSub.unsubscribe()
      this.matterPollingSubscriptions.delete(uuid)
    }

    // PubNub subscription — calls the unsubscribe function returned by August.subscribe()
    const pubnubUnsubscribe = this.matterPubNubUnsubscribes.get(uuid)
    if (pubnubUnsubscribe) {
      try {
        pubnubUnsubscribe()
      } catch { /* best-effort */ }
      this.matterPubNubUnsubscribes.delete(uuid)
    }

    // Registered Matter accessory
    const staleAccessory = this.matterAccessories.get(uuid)
    if (staleAccessory) {
      await matterApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [staleAccessory])
      this.matterAccessories.delete(uuid)
      await this.warnLog(`Removing stale Matter accessory: ${lockName}`)
    }
  }
}
