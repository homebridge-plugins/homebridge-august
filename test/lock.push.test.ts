/* Copyright(C) 2026, homebridge-plugins (https://github.com/homebridge-plugins). All rights reserved.
 *
 * lock.push.test.ts: tests for LockMechanism.pushChanges() using the reply
 * from August's lock/unlock call to update LockCurrentState, instead of
 * waiting for the PubNub event that arrives a few seconds later.
 */
import { describe, expect, it, vi } from 'vitest'

import { LockMechanism } from '../src/devices/lock.js'

vi.mock('august-yale', () => ({ default: vi.fn() }))

const Characteristic = {
  LockCurrentState: { UNSECURED: 0, SECURED: 1, JAMMED: 2, UNKNOWN: 3 },
  LockTargetState: { UNSECURED: 0, SECURED: 1 },
  ContactSensorState: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
}

class HapStatusError extends Error {
  constructor(readonly hapStatus: number) {
    super(`HAP status ${hapStatus}`)
  }
}

const hap = { Characteristic, HapStatusError, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 } }

// Builds a LockMechanism without running its constructor, with just the
// state pushChanges() touches. `reply` is what client.lock()/unlock() return.
function makeLock(target: number, current: number, reply: unknown, error?: Error) {
  const client = {
    lock: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(reply),
    unlock: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(reply),
  }
  const lock = Object.create(LockMechanism.prototype) as any
  Object.assign(lock, {
    hap,
    device: { lockId: 'LOCK1' },
    bridgeOffline: false,
    LockMechanism: { LockTargetState: target, LockCurrentState: current, Service: { updateCharacteristic: vi.fn() } },
    ContactSensor: { ContactSensorState: 0, Service: { updateCharacteristic: vi.fn() } },
    platform: {
      connectivity: {
        execute: vi.fn(async (_label: string, fn: (c: typeof client) => Promise<unknown>) => fn(client)),
      },
    },
    debugLog: vi.fn(),
    infoLog: vi.fn(),
    warnLog: vi.fn(),
    successLog: vi.fn(),
    errorLog: vi.fn(),
    scheduleConfirmCheck: vi.fn(),
    statusCode: vi.fn(),
    updateHomeKitCharacteristics: vi.fn(),
  })
  return { lock, client }
}

describe('pushChanges() with the operation reply', () => {
  it('sets UNSECURED from an unlocked reply', async () => {
    const { lock, client } = makeLock(0, 1, { status: 'kAugLockState_Unlocked', state: { locked: false, unlocked: true } })
    await lock.pushChanges()
    expect(client.unlock).toHaveBeenCalledWith('LOCK1')
    expect(lock.LockMechanism.LockCurrentState).toBe(Characteristic.LockCurrentState.UNSECURED)
    expect(lock.updateHomeKitCharacteristics).toHaveBeenCalled()
  })

  it('sets SECURED from a locked reply', async () => {
    const { lock, client } = makeLock(1, 0, { status: 'kAugLockState_Locked', state: { locked: true, unlocked: false } })
    await lock.pushChanges()
    expect(client.lock).toHaveBeenCalledWith('LOCK1')
    expect(lock.LockMechanism.LockCurrentState).toBe(Characteristic.LockCurrentState.SECURED)
  })

  it('leaves the state alone when the reply is still in progress', async () => {
    const { lock } = makeLock(0, 1, { status: 'kAugLockState_Unlocking', state: { locked: false, unlocked: false, unlocking: true } })
    await lock.pushChanges()
    expect(lock.LockMechanism.LockCurrentState).toBe(Characteristic.LockCurrentState.SECURED)
  })

  it('logs the timing of a completed command', async () => {
    const { lock } = makeLock(0, 1, { status: 'kAugLockState_Unlocked', state: { locked: false, unlocked: true }, info: { duration: 3158 }, retryCount: 0 })
    lock.commandStartedAt = Date.now()
    await lock.pushChanges()
    expect(lock.successLog).toHaveBeenCalledWith(expect.stringMatching(/^HomeKit Unlock: Unlocked \+\d+\.\ds \(sent \+\d+\.\ds, August replied after \d+\.\ds, bridge 3\.2s\)$/))
  })

  it('sends the command even when the lock already reports that state', async () => {
    const { lock, client } = makeLock(0, 0, { status: 'kAugLockState_Unlocked', state: { locked: false, unlocked: true } })
    await lock.pushChanges()
    expect(client.unlock).toHaveBeenCalledWith('LOCK1')
    expect(lock.infoLog).toHaveBeenCalledWith('HomeKit Unlock: lock already reports Unlocked, sending anyway')
  })

  it('leaves the state alone when the reply has no state', async () => {
    const { lock } = makeLock(0, 1, undefined)
    await lock.pushChanges()
    expect(lock.LockMechanism.LockCurrentState).toBe(Characteristic.LockCurrentState.SECURED)
    expect(lock.errorLog).not.toHaveBeenCalled()
  })
})

describe('setLockTargetState() waits for the lock', () => {
  // A lock whose doLockUpdate runs `push` when next() is called, standing in
  // for the debounced subscription set up in the constructor.
  function makeSettable(push: () => Promise<void>) {
    const lock = Object.create(LockMechanism.prototype) as any
    Object.assign(lock, {
      hap,
      bridgeOffline: false,
      accessory: { context: {} },
      LockMechanism: { LockTargetState: 1, LockCurrentState: 1 },
      pendingLockUpdates: [],
      debugLog: vi.fn(),
      infoLog: vi.fn(),
      warnLog: vi.fn(),
    })
    lock.doLockUpdate = {
      next: () => {
        void push().then(() => {
          for (const resolve of lock.pendingLockUpdates.splice(0)) {
            resolve()
          }
        })
      },
    }
    return lock
  }

  it('answers HomeKit once pushChanges() has finished', async () => {
    let finish!: () => void
    const lock = makeSettable(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    let answered = false
    const set = lock.setLockTargetState(0).then(() => {
      answered = true
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(answered).toBe(false)
    finish()
    await set
    expect(answered).toBe(true)
  })

  it('stops waiting after 8 seconds', async () => {
    vi.useFakeTimers()
    try {
      const lock = makeSettable(() => new Promise<void>(() => {}))
      let answered = false
      const set = lock.setLockTargetState(0).then(() => {
        answered = true
      })
      await vi.advanceTimersByTimeAsync(7_999)
      expect(answered).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await set
      expect(answered).toBe(true)
      expect(lock.warnLog).toHaveBeenCalledWith(expect.stringContaining('no answer from August after 8.0s'))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('an offline bridge', () => {
  const offline = new Error('Bridge is offline')

  it('is detected from a failed lock or unlock, and pushes No Response to HomeKit', async () => {
    const { lock } = makeLock(0, 1, undefined, offline)
    await lock.pushChanges()
    expect(lock.bridgeOffline).toBe(true)
    const pushed = lock.LockMechanism.Service.updateCharacteristic.mock.calls.map((c: unknown[]) => c[1])
    expect(pushed).toHaveLength(2)
    expect(pushed.every((v: unknown) => v instanceof HapStatusError)).toBe(true)
    expect(lock.ContactSensor.Service.updateCharacteristic).toHaveBeenCalledWith(Characteristic.ContactSensorState, expect.any(HapStatusError))
  })

  it('is detected from the poll, which then stops updating the stale lock state', async () => {
    const { lock } = makeLock(1, 1, undefined)
    lock.parseStatus = vi.fn()
    lock.updateHomeKitCharacteristics = vi.fn()
    await lock.applyRefresh({ LockStatus: { status: 'unlocked' }, Bridge: { status: { current: 'offline' } } })
    expect(lock.bridgeOffline).toBe(true)
    await lock.applyRefresh({ LockStatus: { status: 'locked' }, Bridge: { status: { current: 'online' } } })
    expect(lock.bridgeOffline).toBe(false)
    // Coming back pushes the real values again, replacing HomeKit's error
    expect(lock.LockMechanism.Service.updateCharacteristic).toHaveBeenCalledWith(Characteristic.LockCurrentState, 1)
  })

  it('ignores locks without a bridge', async () => {
    const { lock } = makeLock(1, 1, undefined)
    lock.parseStatus = vi.fn()
    lock.updateHomeKitCharacteristics = vi.fn()
    await lock.applyRefresh({ LockStatus: { status: 'locked' } })
    expect(lock.bridgeOffline).toBe(false)
  })

  it('clears when a lock or unlock succeeds', async () => {
    const { lock } = makeLock(0, 1, { status: 'kAugLockState_Unlocked', state: { locked: false, unlocked: true } })
    lock.bridgeOffline = true
    await lock.pushChanges()
    expect(lock.bridgeOffline).toBe(false)
    expect(lock.infoLog).toHaveBeenCalledWith('Bridge back online (unlock succeeded)')
  })

  it('fails the HomeKit write so Siri reports the lock as not responding', async () => {
    const lock = Object.create(LockMechanism.prototype) as any
    Object.assign(lock, {
      hap,
      bridgeOffline: false,
      accessory: { context: {} },
      LockMechanism: { LockTargetState: 1, LockCurrentState: 1 },
      pendingLockUpdates: [],
      debugLog: vi.fn(),
      infoLog: vi.fn(),
      warnLog: vi.fn(),
    })
    lock.doLockUpdate = {
      next: () => {
        lock.bridgeOffline = true
        for (const resolve of lock.pendingLockUpdates.splice(0)) {
          resolve()
        }
      },
    }
    await expect(lock.setLockTargetState(0)).rejects.toBeInstanceOf(HapStatusError)
  })
})
