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
//   - The full exception hierarchy that classify() now uses for routing:
//     NetworkError, TimeoutError (subclass), AbortedError, InvalidAuth.
vi.mock('august-yale', () => {
  class YaleApiError extends Error {
    public originalError?: Error
    constructor(message?: string, originalError?: Error) {
      super(message)
      this.name = 'YaleApiError'
      this.originalError = originalError
    }
  }
  class NetworkError extends YaleApiError {
    public code?: string
    constructor(message?: string, originalError?: Error, code?: string) {
      super(message, originalError)
      this.name = 'NetworkError'
      this.code = code
    }
  }
  class TimeoutError extends NetworkError {
    constructor(message?: string, originalError?: Error, code?: string) {
      super(message, originalError, code)
      this.name = 'TimeoutError'
    }
  }
  class AbortedError extends YaleApiError {
    public code?: string
    constructor(message?: string, originalError?: Error, code?: string) {
      super(message, originalError)
      this.name = 'AbortedError'
      this.code = code
    }
  }
  class InvalidAuth extends YaleApiError {
    constructor(message?: string, originalError?: Error) {
      super(message, originalError)
      this.name = 'InvalidAuth'
    }
  }
  // Each new August() returns a unique object so tests can assert which
  // client is being used (initial vs. rebuilt). Tests can also override
  // the methods of the NEXT client to be built by setting fields on
  // `nextClientOverride`. After one use the override is cleared.
  let nextId = 0
  // eslint-disable-next-line prefer-arrow-callback
  const MockAugust = vi.fn().mockImplementation(function () {
    const id = ++nextId
    const base: any = {
      _id: id,
      details: vi.fn().mockResolvedValue({ ok: true }),
      locks: vi.fn().mockResolvedValue({}),
      lock: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      end: vi.fn(),
    }
    const override = (globalThis as any).__nextClientOverride
    if (override) {
      Object.assign(base, override)
      // Stickiness: if the override has __sticky set, preserve it across
      // multiple new August() calls. Used by the heartbeat tests where
      // every probe in a sequence should fail.
      if (!override.__sticky) {
        ;(globalThis as any).__nextClientOverride = undefined
      }
    }
    return base
  })
  return {
    default: MockAugust,
    YaleApiError,
    NetworkError,
    TimeoutError,
    AbortedError,
    InvalidAuth,
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
    // Clean up any per-test mock-client override so it can't leak into
    // the next test.
    ;(globalThis as any).__nextClientOverride = undefined
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

    it('treats NetworkError as network and transitions to degraded', async () => {
      // NetworkError covers all transport-level failures from august-yale —
      // socket reset, DNS failure, malformed response, etc. — without us
      // having to enumerate undici's 24 error classes.
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const { NetworkError } = await import('august-yale')
      const result = await m.execute('test', async () => { throw new NetworkError('socket hang up', undefined, 'ECONNRESET') })
      expect(result).toBeUndefined()
      expect(m.getState()).toBe('degraded')
    })

    it('treats InvalidAuth as auth and rebuilds without changing state', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      expect(onClientChanged).toHaveBeenCalledTimes(1)
      const { InvalidAuth } = await import('august-yale')
      const result = await m.execute('test', async () => { throw new InvalidAuth('session expired') })
      expect(result).toBeUndefined()
      await vi.runAllTimersAsync()
      expect(onClientChanged).toHaveBeenCalledTimes(2)
      expect(m.getState()).toBe('healthy')
    })

    it('treats AbortedError as transient and does NOT change connectivity state', async () => {
      // AbortedError reflects a request racing with our own teardown
      // (e.g. inside rebuildClient). Treating it as 'network' would
      // make the state machine fight itself: every rebuild produces
      // ClientDestroyedError -> degraded -> probe -> rebuild ->
      // ClientDestroyedError -> ...
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const { AbortedError } = await import('august-yale')
      const err = new AbortedError('client destroyed', undefined, 'UND_ERR_DESTROYED')
      await expect(
        m.execute('test', async () => { throw err }),
      ).rejects.toBe(err)
      // State stays healthy — no probe scheduled.
      expect(m.getState()).toBe('healthy')
    })

    it('treats 502/503/504 as network errors (HTTP-level fallback)', async () => {
      // Most transport failures are now wrapped upstream as NetworkError,
      // but if august-yale ever surfaces a clean HTTP 5xx response, we
      // still want to recognize 502/503/504 as network-class and probe.
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const err = Object.assign(new Error('Bad Gateway'), { statusCode: 502 })
      await m.execute('test', async () => { throw err })
      expect(m.getState()).toBe('degraded')
    })
  })

  describe('probe-driven recovery', () => {
    it('schedules a probe on first network failure and recovers when probe succeeds', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      expect(onClientChanged).toHaveBeenCalledTimes(1)

      // Network failure: degrades and schedules probe.
      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Probe builds a fresh August client. The default mock makes its
      // .locks() resolve, so the probe will succeed without further setup.

      // Advance time past the first backoff slot (~5s plus jitter).
      await vi.advanceTimersByTimeAsync(7_000)

      // Probe success → adopt fresh client → healthy. onClientChanged fires
      // a second time (initial build + post-probe adoption).
      expect(m.getState()).toBe('healthy')
      expect(onClientChanged).toHaveBeenCalledTimes(2)
    })

    it('escalates from degraded to offline when probe fails, with longer backoff', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Override the NEXT (and all subsequent) clients built during this
      // test so their .locks() rejects. __sticky keeps the override active
      // across multiple probe attempts; without it, only the first probe
      // would fail and the next would succeed against a default-mock
      // client, recovering before we observe offline.
      ;(globalThis as any).__nextClientOverride = {
        __sticky: true,
        locks: vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
          setTimeout(() => reject(new TimeoutError('still down')), 100)
        })),
      }

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

    it('probes use a FRESH client, not the existing (possibly-stale) one', async () => {
      // This is the regression test for the production bug: the previous
      // implementation probed against `this.client`, which kept failing
      // on stale sockets even after the network had recovered. The
      // PubNub-triggered immediate probe couldn't help because it used
      // the same stale Agent.
      //
      // Verify: when the existing client's .locks() would fail but a
      // freshly-built client's .locks() succeeds, the probe still
      // recovers the system to healthy.
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()
      const initialClient = m.getClient() as any

      // Make the EXISTING client's .locks() reject, simulating a stale
      // Agent. If the probe were running against `this.client`, it
      // would fail and the system would stay offline.
      const { TimeoutError } = await import('august-yale')
      initialClient.locks = vi.fn().mockImplementation(() =>
        new Promise((_resolve, reject) => setTimeout(() => reject(new TimeoutError('stale')), 100)),
      )

      // Trigger degraded.
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Advance: probe builds a NEW client (default mock = locks resolves)
      // → succeeds → adopt → healthy. The initialClient.locks rejection
      // is irrelevant because the probe never calls it.
      await vi.advanceTimersByTimeAsync(7_000)
      expect(m.getState()).toBe('healthy')

      // The current client should be a different instance.
      expect(m.getClient()).not.toBe(initialClient)
      // The old client got destroyed.
      expect(initialClient.destroy).toHaveBeenCalled()
    })

    it('failed probe destroys the temporary client (no Agent leak)', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Override probe's fresh client so its .locks() rejects AND
      // capture its destroy mock. __sticky so any retried probe also
      // fails (we want to verify destroy is called on the failing
      // probe's client, not test recovery).
      const probeDestroy = vi.fn()
      ;(globalThis as any).__nextClientOverride = {
        __sticky: true,
        destroy: probeDestroy,
        locks: vi.fn().mockImplementation(() => new Promise((_, reject) =>
          setTimeout(() => reject(new TimeoutError('still down')), 100),
        )),
      }

      await vi.advanceTimersByTimeAsync(15_000)
      expect(m.getState()).toBe('offline')
      // Probe's fresh client must be destroyed; otherwise we'd leak
      // an Agent on every failed probe attempt.
      expect(probeDestroy).toHaveBeenCalled()
    })
  })

  describe('onPubNubReconnect — fast recovery', () => {
    it('triggers an immediate probe when degraded', async () => {
      const onClientChanged = vi.fn()
      const m = new ConnectivityManager(makeLog(), fakeCredentials, onClientChanged)
      await m.init()

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // PubNub reconnect → immediate probe. Default mock has the fresh
      // client's .locks() resolving, so the probe succeeds.
      m.onPubNubReconnect()

      // Probe runs synchronously inside onPubNubReconnect's microtask;
      // need to flush promises but no timer advance required.
      await vi.runAllTimersAsync()
      expect(m.getState()).toBe('healthy')
      // Initial build + adoption-of-fresh-client after successful probe.
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

  describe('offline heartbeat', () => {
    // Helper: drive the manager into offline state and capture the log.
    async function getOfflineWithLog() {
      const log = makeLog()
      const m = new ConnectivityManager(log, fakeCredentials)
      await m.init()

      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })

      // Make probes fail forever — every fresh client's .locks() rejects.
      // __sticky keeps the override active across multiple probe attempts
      // so we can stay in offline state long enough for the heartbeat.
      ;(globalThis as any).__nextClientOverride = {
        __sticky: true,
        locks: vi.fn().mockImplementation(() => new Promise((_resolve, reject) =>
          setTimeout(() => reject(new TimeoutError('still down')), 100),
        )),
      }

      // Drive past first probe so we land in offline.
      await vi.advanceTimersByTimeAsync(15_000)
      return { m, log }
    }

    it('emits a heartbeat after one hour of being offline', async () => {
      const { log } = await getOfflineWithLog()

      // Less than an hour: no heartbeat yet.
      await vi.advanceTimersByTimeAsync(30 * 60_000)
      const beforeHour = log._calls.filter(c => c.msg.includes('still offline')).length
      expect(beforeHour).toBe(0)

      // Past one hour: heartbeat fires. Probes are still failing in the
      // background, so we filter for the heartbeat-specific message.
      await vi.advanceTimersByTimeAsync(35 * 60_000)
      const afterHour = log._calls.filter(c => c.msg.includes('still offline')).length
      expect(afterHour).toBeGreaterThan(0)
      // Heartbeat content includes attempt count and last failure.
      const heartbeatLine = log._calls.find(c => c.msg.includes('still offline'))
      expect(heartbeatLine?.msg).toMatch(/\d+ probe attempts?/)
      expect(heartbeatLine?.msg).toContain('last failure')
    })

    it('stops emitting heartbeats after recovery', async () => {
      const { m, log } = await getOfflineWithLog()

      // Allow recovery on the next probe by clearing any pending override.
      ;(globalThis as any).__nextClientOverride = undefined

      // Skip ahead enough for a probe to fire and succeed.
      await vi.advanceTimersByTimeAsync(60 * 1000)
      expect(m.getState()).toBe('healthy')

      const beforeIdle = log._calls.filter(c => c.msg.includes('still offline')).length
      // Advance two more hours — should NOT see new heartbeat lines.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
      const afterIdle = log._calls.filter(c => c.msg.includes('still offline')).length
      expect(afterIdle).toBe(beforeIdle)
    })
  })
})
