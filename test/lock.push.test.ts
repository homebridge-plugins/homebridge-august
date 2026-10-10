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
}

// Builds a LockMechanism without running its constructor, with just the
// state pushChanges() touches. `reply` is what client.lock()/unlock() return.
function makeLock(target: number, current: number, reply: unknown) {
  const client = {
    lock: vi.fn().mockResolvedValue(reply),
    unlock: vi.fn().mockResolvedValue(reply),
  }
  const lock = Object.create(LockMechanism.prototype) as any
  Object.assign(lock, {
    hap: { Characteristic },
    device: { lockId: 'LOCK1' },
    LockMechanism: { LockTargetState: target, LockCurrentState: current },
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

  it('warns when the command is dropped because the lock already reports that state', async () => {
    const { lock, client } = makeLock(0, 0, undefined)
    await lock.pushChanges()
    expect(client.unlock).not.toHaveBeenCalled()
    expect(lock.warnLog).toHaveBeenCalledWith(expect.stringContaining('HomeKit Unlock: lock already reports Unlocked, nothing sent to August'))
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
      hap: { Characteristic },
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
