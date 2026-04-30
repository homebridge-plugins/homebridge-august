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
    return {
      _id: id,
      details: vi.fn().mockResolvedValue({ ok: true }),
      locks: vi.fn().mockResolvedValue({}),
      lock: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      resetTransport: vi.fn(),
      end: vi.fn(),
    }
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

      // Probe calls resetTransport() on the existing client and then its
      // .locks(). Default mock = locks resolves, so probe succeeds.

      // Advance time past the first backoff slot (~5s plus jitter).
      await vi.advanceTimersByTimeAsync(7_000)

      // Probe success → healthy. onClientChanged was called only once
      // (at init). The resetTransport-based design does NOT swap the
      // client instance on recovery; it just recycles its transport.
      expect(m.getState()).toBe('healthy')
      expect(onClientChanged).toHaveBeenCalledTimes(1)
    })

    it('escalates from degraded to offline when probe fails, with longer backoff', async () => {
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const client = m.getClient() as any

      const { TimeoutError } = await import('august-yale')

      // Make the existing client's .locks() always fail. With the
      // resetTransport-based design, probes reuse this client, so a
      // single mockImplementation is sufficient for every probe attempt.
      client.locks = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new TimeoutError('still down')), 100)
      }))

      // Trigger degraded.
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

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

    it('probes call resetTransport() on the existing client (sheds stale sockets)', async () => {
      // Regression test for the production bug: the original
      // implementation probed against the existing client without
      // resetting its socket pool. The pool kept stale half-open sockets
      // from before the outage, probes failed on those sockets, system
      // stayed offline.
      //
      // The fix: probe still uses the existing client (so we keep auth
      // state), but resetTransport() is called first to throw away the
      // dispatcher and its stale connections. New transport, same auth.
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const client = m.getClient() as any

      // Sanity: the mock client has a resetTransport method.
      expect(typeof client.resetTransport).toBe('function')

      // Trigger degraded.
      const { TimeoutError } = await import('august-yale')
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Advance past the first backoff: probe runs, default mock has
      // .locks() resolving, recovery completes.
      await vi.advanceTimersByTimeAsync(7_000)
      expect(m.getState()).toBe('healthy')

      // The probe must have called resetTransport on the existing
      // client. This is the structural assertion that locks in the fix.
      expect(client.resetTransport).toHaveBeenCalled()
      // The same client instance is still in place (we did NOT
      // construct a new client — this distinguishes the resetTransport
      // approach from the previous fresh-client approach).
      expect(m.getClient()).toBe(client)
    })

    it('failed probe leaves the existing client in place (no leak, no rotation)', async () => {
      // With resetTransport(), failed probes don't construct a temp
      // client, so there's nothing to leak. The existing client stays
      // the current client throughout the offline period — only its
      // transport gets recycled, not the August instance itself.
      const m = new ConnectivityManager(makeLog(), fakeCredentials)
      await m.init()
      const client = m.getClient() as any

      const { TimeoutError } = await import('august-yale')

      // Make the client's .locks() always fail.
      client.locks = vi.fn().mockImplementation(() => new Promise((_, reject) =>
        setTimeout(() => reject(new TimeoutError('still down')), 100),
      ))

      // Trigger degraded.
      await m.execute('test', async () => { throw new TimeoutError('boom') })
      expect(m.getState()).toBe('degraded')

      // Advance past first probe → offline.
      await vi.advanceTimersByTimeAsync(15_000)
      expect(m.getState()).toBe('offline')

      // The existing client is still the current client; nothing got
      // destroyed or replaced.
      expect(m.getClient()).toBe(client)
      expect(client.destroy).not.toHaveBeenCalled()
      // resetTransport was called for each probe attempt.
      expect(client.resetTransport).toHaveBeenCalled()
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

      // PubNub reconnect → immediate probe. Default mock has .locks()
      // resolving, so the probe (which calls resetTransport on the
      // existing client and then locks()) succeeds.
      m.onPubNubReconnect()

      // Probe runs synchronously inside onPubNubReconnect's microtask;
      // need to flush promises but no timer advance required.
      await vi.runAllTimersAsync()
      expect(m.getState()).toBe('healthy')
      // onClientChanged was only called once (at init). Recovery via
      // resetTransport does not swap the client instance.
      expect(onClientChanged).toHaveBeenCalledTimes(1)
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
      const client = m.getClient() as any

      const { TimeoutError } = await import('august-yale')

      // Make every probe fail by making the existing client's .locks
      // always reject. With the resetTransport-based design, probes
      // reuse this client across attempts, so a single mockImplementation
      // covers every probe in the offline period.
      client.locks = vi.fn().mockImplementation(() => new Promise((_resolve, reject) =>
        setTimeout(() => reject(new TimeoutError('still down')), 100),
      ))

      // Trigger degraded.
      await m.execute('test', async () => { throw new TimeoutError('boom') })

      // Drive past first probe so we land in offline.
      await vi.advanceTimersByTimeAsync(15_000)
      return { m, log, client }
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
      const { m, log, client } = await getOfflineWithLog()

      // Allow recovery on the next probe by making .locks resolve again.
      client.locks = vi.fn().mockResolvedValue({})

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
