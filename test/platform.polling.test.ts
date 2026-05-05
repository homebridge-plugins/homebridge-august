/* Copyright(C) 2026, homebridge-plugins (https://github.com/homebridge-plugins). All rights reserved.
 *
 * platform.polling.test.ts: tests for AugustPlatform.startPolling().
 *
 * The platform-level serial poller is what turns the ConnectivityManager
 * state machine into observable behavior. Critical properties:
 *
 *   - SERIAL iteration so a network outage produces ONE timeout per
 *     cycle, not N (one per registered lock). This is the behavior
 *     change that fixes the log-spam cascade after router restarts.
 *
 *   - Short-circuit on the first failure in a cycle. Once execute()
 *     returns undefined, the rest of the locks in the cycle are not
 *     polled — the network is clearly bad and there's no value in
 *     hammering N more endpoints.
 *
 *   - Skip entirely when the manager reports 'offline'. The manager's
 *     probe schedule (with backoff + jitter) drives recovery — the
 *     poll interval should not.
 *
 *   - Skip locks mid-push (lockUpdateInProgress) so a stale poll result
 *     doesn't race the user's lock/unlock command.
 *
 *   - Idempotent startPolling — calling twice does not stack timers.
 *
 *   - No-op when platformRefreshRate === 0.
 */
import type { API, Logging } from 'homebridge'

import type { AugustPlatformConfig } from '../src/settings.js'

import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AugustPlatform } from '../src/Platform.HAP.js'

// Same mock conventions as the rest of the suite.
vi.mock('august-yale', () => {
  // eslint-disable-next-line prefer-arrow-callback
  const MockAugust = vi.fn().mockImplementation(function () {
    return { destroy: vi.fn(), end: vi.fn(), details: vi.fn(), locks: vi.fn() }
  })
  const MockConstructor = MockAugust as any
  MockConstructor.details = vi.fn()
  MockConstructor.authorize = vi.fn()
  MockConstructor.validate = vi.fn()
  return { default: MockConstructor }
})

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

// Helper: install a stub connectivity manager on the platform whose
// execute() runs the supplied fn against a fake "client" passed through
// from the test. Returns the underlying mock execute fn for assertions.
function installConnectivity(
  platform: AugustPlatform,
  client: any,
  state: 'healthy' | 'degraded' | 'offline' | 'recovering' = 'healthy',
) {
  const execute = vi.fn(async (_label: string, fn: (c: any) => Promise<any>) => {
    try {
      return await fn(client)
    } catch {
      return undefined
    }
  })
  ;(platform as any).connectivity = {
    getState: () => state,
    execute,
  }
  return execute
}

// Helper: register N stub LockMechanism objects on the platform. Each
// has its own lockId and a vi.fn() applyRefresh. Returns the array of
// stubs in registration order.
function registerLocks(platform: AugustPlatform, count: number) {
  const locks: any[] = []
  for (let i = 0; i < count; i++) {
    const lock = {
      device: { lockId: `lock-${i}` },
      accessory: { displayName: `Lock ${i}` },
      lockUpdateInProgress: false,
      applyRefresh: vi.fn().mockResolvedValue(undefined),
    }
    ;(platform as any).lockMechanisms.set(lock.device.lockId, lock)
    locks.push(lock)
  }
  return locks
}

describe('augustPlatform.startPolling', () => {
  let platform: AugustPlatform
  let mockApi: API
  let mockLog: Logging
  let mockConfig: AugustPlatformConfig

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Quiet the package.json read in the platform constructor.
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0-test' }))

    mockApi = {
      hap: { uuid: { generate: vi.fn(() => 'mock-uuid') } },
      user: { configPath: vi.fn(() => '/mock/config.json') },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      publishExternalAccessories: vi.fn(),
    } as unknown as API

    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    } as any

    mockConfig = {
      platform: 'August',
      name: 'Test August',
      credentials: {
        augustId: 'test@example.com',
        password: 'testpassword',
        countryCode: 'US',
        installId: 'test-install-id',
        isValidated: true,
      },
      options: { logging: 'debug' },
    }

    platform = new AugustPlatform(mockLog, mockConfig, mockApi)
    // Force a deterministic poll interval (1s) so tests can advance
    // time precisely.
    ;(platform as any).platformRefreshRate = 1
  })

  afterEach(() => {
    platform.stopPolling()
    vi.useRealTimers()
  })

  describe('cycle iteration', () => {
    it('iterates locks serially in registration order, calling applyRefresh on each', async () => {
      const client = {
        details: vi.fn().mockImplementation(async (lockId: string) => ({ lockId })),
      }
      installConnectivity(platform, client)
      const locks = registerLocks(platform, 3)

      platform.startPolling()
      // Advance to the first tick.
      await vi.advanceTimersByTimeAsync(1_000)

      // All three locks polled.
      expect(client.details).toHaveBeenCalledTimes(3)
      expect(client.details).toHaveBeenNthCalledWith(1, 'lock-0')
      expect(client.details).toHaveBeenNthCalledWith(2, 'lock-1')
      expect(client.details).toHaveBeenNthCalledWith(3, 'lock-2')
      // applyRefresh fired for each.
      expect(locks[0].applyRefresh).toHaveBeenCalledTimes(1)
      expect(locks[1].applyRefresh).toHaveBeenCalledTimes(1)
      expect(locks[2].applyRefresh).toHaveBeenCalledTimes(1)
    })

    it('short-circuits the rest of the cycle when execute returns undefined', async () => {
      // First lock fails (execute returns undefined), the next two should
      // NOT be polled in this cycle.
      const client = {
        details: vi.fn().mockImplementation(async (lockId: string) => {
          if (lockId === 'lock-0') {
            throw new Error('network down')
          }
          return { lockId }
        }),
      }
      installConnectivity(platform, client)
      const locks = registerLocks(platform, 3)

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(1_000)

      // Only the first lock's details() was called; the other two were
      // skipped. Note: execute() is what returns undefined; the inner
      // details() function only ran for lock-0.
      expect(client.details).toHaveBeenCalledTimes(1)
      expect(locks[0].applyRefresh).not.toHaveBeenCalled()
      expect(locks[1].applyRefresh).not.toHaveBeenCalled()
      expect(locks[2].applyRefresh).not.toHaveBeenCalled()
    })

    it('skips entire cycle when connectivity is offline', async () => {
      const client = { details: vi.fn() }
      installConnectivity(platform, client, 'offline')
      const locks = registerLocks(platform, 3)

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(client.details).not.toHaveBeenCalled()
      for (const lock of locks) {
        expect(lock.applyRefresh).not.toHaveBeenCalled()
      }
    })

    it('skips locks with lockUpdateInProgress=true but continues to the next', async () => {
      const client = {
        details: vi.fn().mockImplementation(async (lockId: string) => ({ lockId })),
      }
      installConnectivity(platform, client)
      const locks = registerLocks(platform, 3)
      // Middle lock is mid-push.
      locks[1].lockUpdateInProgress = true

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(client.details).toHaveBeenCalledTimes(2)
      expect(client.details).toHaveBeenNthCalledWith(1, 'lock-0')
      expect(client.details).toHaveBeenNthCalledWith(2, 'lock-2')
      expect(locks[0].applyRefresh).toHaveBeenCalledTimes(1)
      expect(locks[1].applyRefresh).not.toHaveBeenCalled()
      expect(locks[2].applyRefresh).toHaveBeenCalledTimes(1)
    })

    it('continues polling on subsequent ticks', async () => {
      const client = {
        details: vi.fn().mockImplementation(async (lockId: string) => ({ lockId })),
      }
      installConnectivity(platform, client)
      registerLocks(platform, 1)

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(1_000)

      // 3 ticks × 1 lock = 3 calls.
      expect(client.details).toHaveBeenCalledTimes(3)
    })

    it('keeps the loop alive even if applyRefresh throws synchronously', async () => {
      const client = {
        details: vi.fn().mockImplementation(async (lockId: string) => ({ lockId })),
      }
      installConnectivity(platform, client)
      const locks = registerLocks(platform, 1)
      // applyRefresh throws on the first call but resolves on the second.
      locks[0].applyRefresh
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined)

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(1_000)

      // Both ticks fired.
      expect(locks[0].applyRefresh).toHaveBeenCalledTimes(2)
    })
  })

  describe('lifecycle', () => {
    it('startPolling is idempotent — calling twice does not stack timers', async () => {
      const client = { details: vi.fn().mockResolvedValue({}) }
      installConnectivity(platform, client)
      registerLocks(platform, 1)

      platform.startPolling()
      platform.startPolling() // second call should be a no-op

      await vi.advanceTimersByTimeAsync(1_000)

      // If timers were stacked we'd see 2 calls per tick.
      expect(client.details).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when platformRefreshRate is 0', async () => {
      const client = { details: vi.fn() }
      installConnectivity(platform, client)
      registerLocks(platform, 1)
      ;(platform as any).platformRefreshRate = 0

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(client.details).not.toHaveBeenCalled()
    })

    it('stopPolling clears the timer', async () => {
      const client = { details: vi.fn().mockResolvedValue({}) }
      installConnectivity(platform, client)
      registerLocks(platform, 1)

      platform.startPolling()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(client.details).toHaveBeenCalledTimes(1)

      platform.stopPolling()
      await vi.advanceTimersByTimeAsync(5_000)

      // No additional calls after stopPolling.
      expect(client.details).toHaveBeenCalledTimes(1)
    })
  })
})
