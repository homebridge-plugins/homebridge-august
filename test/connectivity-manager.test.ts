/* Copyright(C) 2026, homebridge-plugins (https://github.com/homebridge-plugins). All rights reserved.
 *
 * connectivity-manager.test.ts: unit tests for ConnectivityManager.
 *
 * The manager is the centerpiece of the connectivity refactor and the
 * piece most likely to regress under future changes (state machine,
 * timer-driven probes, async rebuild coalescing). These tests cover
 * the contract that the rest of the codebase relies on.
 */
import type { Logging } from 'homebridge'

import type { credentials } from '../src/settings.js'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectivityManager, OfflineError } from '../src/connectivity-manager.js'

// Mock the august-yale module. We need:
//   - August: a constructor we can instantiate, with details() and destroy()
//   - TimeoutError: a real error class so `name === 'TimeoutError'` works
vi.mock('august-yale', () => {
  class TimeoutError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'TimeoutError'
    }
  }
  // Each new August() returns a unique object so tests can assert which
  // client is being used (initial vs. rebuilt).
  let nextId = 0
  // eslint-disable-next-line prefer-arrow-callback
  const MockAugust = vi.fn().mockImplementation(function () {
    const id = ++nextId
    return {
      _id: id,
      details: vi.fn().mockResolvedValue({ ok: true }),
      locks: vi.fn().mockResolvedValue({}),
      lock: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      end: vi.fn(),
    }
  })
  return {
    default: MockAugust,
    TimeoutError,
  }
})

// Helper: build a stub Logging object that records calls.
function makeLog(): Logging & { _calls: { level: string, msg: string }[] } {
  const calls: { level: string, msg: string }[] = []
  const stub = ((..._args: any[]) => {}) as any
  stub._calls = calls
  for (const level of ['info', 'warn', 'error', 'debug', 'success'] as const) {
    stub[level] = (msg: string) => calls.push({ level, msg })
  }
  return stub
}

// Helper: trivial credentials factory.
async function fakeCredentials(): Promise<credentials> {
  return { installId: 'test-install', apiKey: 'test-key' } as unknown as credentials
}

describe('ConnectivityManager', () => {
  beforeEach(() => {
    // Use fake timers so probes can be advanced deterministically without
    // waiting for real backoff windows (5s..5min).
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('init / lifecycle', () => {
    it('init() builds a client and fires onClientChanged exactly once', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      expect(onClientChanged).toHaveBeenCalledTimes(1)
      // The current client is whatever was passed to onClientChanged.
      expect(m.getClient()).toBe(onClientChanged.mock.calls[0][0])
      expect(m.getState()).toBe('healthy')
    })

    it('init() is idempotent — calling twice does not rebuild', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      await m.init()
      expect(onClientChanged).toHaveBeenCalledTimes(1)
    })

    it('shutdown() destroys the client, clears state, fires onClientChanged(undefined)', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      const client = m.getClient() as any
      m.shutdown()
      expect(client.destroy).toHaveBeenCalledTimes(1)
      expect(m.getClient()).toBeUndefined()
      // Last call to onClientChanged was with undefined.
      const lastCall = onClientChanged.mock.calls.at(-1)
      expect(lastCall?.[0]).toBeUndefined()
    })
  })

  describe('execute() — happy path and routing', () => {
    it('returns the result and stays healthy on success', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const result = await m.execute('test', async client => (client as any).details('lock-1'))
      expect(result).toEqual({ ok: true })
      expect(m.getState()).toBe('healthy')
    })

    it('returns undefined and does not invoke fn when offline', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      ;(m as any).state = 'offline' // force state for this case
      const fn = vi.fn()
      const result = await m.execute('test', fn)
      expect(result).toBeUndefined()
      expect(fn).not.toHaveBeenCalled()
    })

    it('throws OfflineError when offline and throwOnOffline:true', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      ;(m as any).state = 'offline'
      await expect(
        m.execute('user-action', async () => 'ok', { throwOnOffline: true }),
      ).rejects.toBeInstanceOf(OfflineError)
    })

    it('returns undefined when init() has not been called', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      const result = await m.execute('test', async () => 'never-called')
      expect(result).toBeUndefined()
    })
  })

  describe('execute() — error classification', () => {
    it('rethrows transient (4xx like 422) errors without changing state', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const transientErr = Object.assign(new Error('Unprocessable Entity'), { statusCode: 422 })
      await expect(
        m.execute('test', async () => { throw transientErr }),
      ).rejects.toBe(transientErr)
      expect(m.getState()).toBe('healthy')
    })

    it('rethrows transient errors even with throwOnOffline:true', async () => {
      // throwOnOffline only governs the offline branch; transient errors
      // are always rethrown regardless of that option.
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const err = Object.assign(new Error('rate limited'), { statusCode: 429 })
      await expect(
        m.execute('user', async () => { throw err }, { throwOnOffline: true }),
      ).rejects.toBe(err)
    })

    it('rebuilds the client on 401 without changing connectivity state', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      expect(onClientChanged).toHaveBeenCalledTimes(1)
      const authErr = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
      const result = await m.execute('test', async () => { throw authErr })
      expect(result).toBeUndefined()
      // Allow the rebuild promise to resolve.
      await vi.runAllTimersAsync()
      expect(onClientChanged).toHaveBeenCalledTimes(2)
      expect(m.getState()).toBe('healthy')
    })

    it('treats TimeoutError as network and transitions to degraded', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const { TimeoutError } = await import('august-yale')
      const result = await m.execute('test', async () => { throw new TimeoutError('timed out') })
      expect(result).toBeUndefined()
      expect(m.getState()).toBe('degraded')
    })

    it('treats 502/503/504 as network errors', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const err = Object.assign(new Error('Bad Gateway'), { statusCode: 502 })
      await m.execute('test', async () => { throw err })
      expect(m.getState()).toBe('degraded')
    })

    it('treats ECONNRESET / ENETUNREACH / ENOTFOUND as network errors', async () => {
      for (const code of ['ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ECONNREFUSED']) {
        const m = new ConnectivityManager(makeLog(), fakeCredentials)
        await m.init()
        const err = Object.assign(new Error(code), { code })
        await m.execute('test', async () => { throw err })
        expect(m.getState(), `code=${code}`).toBe('degraded')
        m.shutdown()
      }
    })
  })

  describe('probe-driven recovery', () => {
    it('schedules a probe on first network failure and recovers when probe succeeds', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      const client = m.getClient() as any
      expect(onClientChanged).toHaveBeenCalledTimes(1)

      // Network failure: degrades and schedules probe.
      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Probe will call client.locks() — ensure it succeeds.
      client.locks.mockResolvedValue({})

      // Advance time past the first backoff slot (~5s plus jitter).
      await vi.advanceTimersByTimeAsync(7_000)

      // Probe success → rebuild + healthy. onClientChanged fires again.
      expect(m.getState()).toBe('healthy')
      expect(onClientChanged).toHaveBeenCalledTimes(2)
    })

    it('escalates from degraded to offline when probe fails, with longer backoff', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const client = m.getClient() as any

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Probe will fail (locks() rejects with timeout).
      client.locks.mockImplementation(() => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new TimeoutError('still down')), 100)
      }))

      // Advance past first backoff + probe timeout.
      await vi.advanceTimersByTimeAsync(15_000)
      expect(m.getState()).toBe('offline')
    })

    it('execute() after entering offline returns undefined without calling fn', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      ;(m as any).state = 'offline'
      const fn = vi.fn()
      const result = await m.execute('test', fn)
      expect(result).toBeUndefined()
      expect(fn).not.toHaveBeenCalled()
    })

    it('successful execute() call recovers state from degraded to healthy', async () => {
      // This case covers the natural-recovery path: a network blip that
      // resolves before the probe fires. The next real execute() call
      // succeeds and the manager reports healthy.
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('blip') })
      expect(m.getState()).toBe('degraded')
      // Next call succeeds.
      const result = await m.execute('test', async () => 'recovered')
      expect(result).toBe('recovered')
      expect(m.getState()).toBe('healthy')
    })
  })

  describe('onPubNubReconnect — fast recovery', () => {
    it('triggers an immediate probe when degraded', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      const client = m.getClient() as any

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      client.locks.mockResolvedValue({})
      m.onPubNubReconnect()

      // Probe runs synchronously inside onPubNubReconnect's microtask;
      // need to flush promises but no timer advance required.
      await vi.runAllTimersAsync()
      expect(m.getState()).toBe('healthy')
      // Initial build + rebuild after successful probe.
      expect(onClientChanged).toHaveBeenCalledTimes(2)
    })

    it('is a no-op when already healthy', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      const callsAfterInit = onClientChanged.mock.calls.length
      m.onPubNubReconnect()
      await vi.runAllTimersAsync()
      // No probe, no rebuild.
      expect(onClientChanged).toHaveBeenCalledTimes(callsAfterInit)
      expect(m.getState()).toBe('healthy')
    })
  })

  describe('rebuild coalescing', () => {
    it('two concurrent 401s produce one rebuild, not two', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      expect(onClientChanged).toHaveBeenCalledTimes(1)

      const authErr = Object.assign(new Error('Unauthorized'), { statusCode: 401 })

      // Fire two execute()s concurrently — each will see a 401, each will
      // request a rebuild. The manager must coalesce these into one rebuild.
      await Promise.all([
        m.execute('a', async () => { throw authErr }),
        m.execute('b', async () => { throw authErr }),
      ])
      await vi.runAllTimersAsync()

      // Initial build + exactly one rebuild = 2 total.
      expect(onClientChanged).toHaveBeenCalledTimes(2)
    })
  })

  describe('state-change listeners', () => {
    it('onStateChange fires on transitions and not on no-op transitions', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const listener = vi.fn()
      m.onStateChange(listener)

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      // healthy -> degraded fires once.
      expect(listener).toHaveBeenCalledWith('degraded', 'healthy')
      expect(listener).toHaveBeenCalledTimes(1)

      // A second network error while already degraded should NOT fire
      // again (no transition).
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('unsubscribe stops further notifications', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const listener = vi.fn()
      const unsubscribe = m.onStateChange(listener)
      unsubscribe()

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(listener).not.toHaveBeenCalled()
    })

    it('a throwing listener does not block other listeners', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const good = vi.fn()
      m.onStateChange(() => { throw new Error('listener bug') })
      m.onStateChange(good)

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(good).toHaveBeenCalledTimes(1)
    })
  })
})
