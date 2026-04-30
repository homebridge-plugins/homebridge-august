/* Copyright(C) 2026, homebridge-plugins (https://github.com/homebridge-plugins). All rights reserved.
 *
 * connectivity-manager.ts: single owner of the August HTTP client,
 * connectivity state, and retry/backoff policy.
 *
 * Design rationale
 * ----------------
 * Before this class, every LockMechanism owned its own retry logic, and
 * the platform reacted to timeouts with a 5-minute cooldown that could
 * trap the system with a fresh-but-broken Agent built into a still-bad
 * network. After a router restart with N locks configured, that produced
 * N timeouts per poll cycle and the pattern never recovered until a
 * full Homebridge restart.
 *
 * This class makes connectivity health a property of the platform, not
 * of each lock. Every API call goes through execute(); the manager
 * classifies failures, drives a state machine, and decides when (and
 * whether) to rebuild the underlying August client.
 *
 * Key design choices:
 *
 *   1. Probes run against the EXISTING client, not a fresh one. Rebuilding
 *      a new Agent into a still-broken network just orphans another
 *      dispatcher — exactly the bug we're fixing. Only after the probe
 *      succeeds do we rebuild, to shed any half-open sockets from before
 *      the outage.
 *
 *   2. classify() splits errors into network / auth / transient. 401
 *      rebuilds the client without changing connectivity state. 4xx like
 *      422 / 429 are pushed back to the caller as a thrown error
 *      (transient — caller's responsibility, not a network issue). Only
 *      true network errors and 502/503/504 drive the state machine.
 *
 *   3. Backoff with jitter (5s → 5min cap), not a flat cooldown. A flat
 *      cooldown freezes the system at one decision point; backoff scales
 *      naturally with outage duration and the jitter avoids synchronized
 *      probes when many homebridge instances recover from the same
 *      upstream event.
 *
 *   4. PubNub reconnect is a public input (onPubNubReconnect()). PubNub's
 *      WebSocket recovers seconds before HTTP polling would notice — so
 *      it's the fastest signal the network is back.
 */
import type { Logging } from 'homebridge'

import type { credentials } from './settings.js'

import August, { AbortedError, InvalidAuth, NetworkError, TimeoutError } from 'august-yale'

export type ConnectivityState = 'healthy' | 'degraded' | 'offline' | 'recovering'

/**
 * Backoff schedule for probes after the network is detected as broken.
 * Capped at 5 minutes; ±10% jitter is applied at use to avoid synchronized
 * probes across instances during ISP-level events.
 */
const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000]

/** Probe timeout — short on purpose. A healthy August API responds in <1s. */
const PROBE_TIMEOUT_MS = 8_000

/**
 * How often to emit a heartbeat log line while offline.
 *
 * Without it the log goes silent after the initial healthy → degraded →
 * offline transition, making it impossible to distinguish "state machine
 * is working hard, probes are failing every backoff slot" from "state
 * machine is silently stuck". The heartbeat surfaces probe attempts and
 * the most recent failure so future regressions are debuggable from the
 * log alone.
 *
 * One hour matches the typical "I checked on it later" cadence; not so
 * frequent it becomes log spam during a real ISP outage.
 */
const OFFLINE_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000

type ErrorKind = 'network' | 'auth' | 'transient'

interface ExecuteOptions {
  /**
   * When true, OfflineError is thrown instead of returning undefined when
   * the manager is offline. Used for user-initiated calls (lock/unlock)
   * where HomeKit needs to see a real failure rather than a silent no-op.
   */
  throwOnOffline?: boolean
}

export class OfflineError extends Error {
  constructor(label: string) {
    super(`Operation skipped — connectivity is offline: ${label}`)
    this.name = 'OfflineError'
  }
}

export class ConnectivityManager {
  private state: ConnectivityState = 'healthy'
  private client?: August
  private probeTimer?: NodeJS.Timeout
  private heartbeatTimer?: NodeJS.Timeout
  private backoffIndex = 0
  private rebuildInFlight?: Promise<void>
  private listeners = new Set<(next: ConnectivityState, prev: ConnectivityState) => void>()

  // Diagnostic counters. Reset on transition out of offline. Used by the
  // heartbeat log so an ongoing outage is visible in the log without
  // having to trace per-probe details.
  private offlineSinceMs?: number
  private probeAttempts = 0
  private lastFailureMessage?: string

  constructor(
    private readonly log: Logging,
    private readonly credentialsFactory: () => Promise<credentials>,
    /**
     * Called whenever the manager builds or rebuilds the August client.
     * The platform uses this to keep its public `augustConfig` field in
     * sync, so existing call sites that read `platform.augustConfig`
     * continue to see the current client without going through the
     * manager's accessor.
     */
    private readonly onClientChanged: (client: August | undefined) => void = () => {},
  ) {}

  async init(): Promise<void> {
    if (this.client) {
      return
    }
    this.client = new August(await this.credentialsFactory())
    this.onClientChanged(this.client)
  }

  /**
   * Single entry point for every August API call. Wraps the call,
   * classifies any error, and updates connectivity state.
   *
   * Default behavior: returns undefined when state is 'offline' or when
   * the call fails with a network/auth error. The platform-level poller
   * treats undefined as 'skip this cycle'. Set throwOnOffline:true for
   * user-initiated calls (lock/unlock) where HomeKit needs to see a
   * real failure.
   *
   * Transient errors (4xx other than 401) are always rethrown — they're
   * not connectivity issues and the caller needs to handle them.
   */
  async execute<T>(
    label: string,
    fn: (client: August) => Promise<T>,
    opts: ExecuteOptions = {},
  ): Promise<T | undefined> {
    if (this.state === 'offline') {
      if (opts.throwOnOffline) {
        throw new OfflineError(label)
      }
      return undefined
    }
    if (!this.client) {
      if (opts.throwOnOffline) {
        throw new OfflineError(label)
      }
      return undefined
    }

    try {
      const result = await fn(this.client)
      this.reportSuccess()
      return result
    } catch (e) {
      const kind = this.classify(e)
      this.reportFailure(label, kind)
      if (kind === 'transient') {
        // Not a connectivity issue — let the caller see the real error.
        throw e
      }
      if (opts.throwOnOffline) {
        throw e
      }
      return undefined
    }
  }

  /**
   * External signal: PubNub WebSocket reported a (re)connection. PubNub
   * recovers from a network blip seconds before HTTP polling would notice,
   * so this is the fastest path back to healthy. Triggers an immediate
   * probe that bypasses the current backoff delay.
   */
  onPubNubReconnect(): void {
    if (this.state === 'healthy') {
      return
    }
    const offlineFor = this.offlineSinceMs
      ? ` (offline for ${Math.floor((Date.now() - this.offlineSinceMs) / 1000)}s)`
      : ''
    this.log.info(`Connectivity: PubNub reconnect signal received in ${this.state}${offlineFor} — probing immediately`)
    this.clearProbeTimer()
    void this.runProbe()
  }

  getState(): ConnectivityState {
    return this.state
  }

  /**
   * Returns the current August client. Used by code paths that need
   * direct access (e.g. addSimpleProps, which is a pure utility) and
   * during the transition period while not all callers are routed
   * through execute(). New code should prefer execute().
   */
  getClient(): August | undefined {
    return this.client
  }

  /**
   * Subscribe to connectivity state changes. Used by the platform-level
   * poller to pause polling when offline and resume when healthy.
   * Returns an unsubscribe function.
   */
  onStateChange(l: (next: ConnectivityState, prev: ConnectivityState) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  shutdown(): void {
    this.clearProbeTimer()
    this.stopHeartbeat()
    this.client?.destroy()
    this.client = undefined
    this.onClientChanged(undefined)
    this.listeners.clear()
  }

  // --- internals ---

  private reportSuccess(): void {
    if (this.state !== 'healthy') {
      this.transitionTo('healthy')
    }
    this.backoffIndex = 0
  }

  private reportFailure(label: string, kind: ErrorKind): void {
    if (kind === 'auth') {
      // Session expired. Rebuild the client; do not change connectivity state.
      this.log.info(`Connectivity: auth expiry on "${label}" — rebuilding client`)
      void this.rebuildClient('auth expiry')
      return
    }
    if (kind === 'transient') {
      // 4xx/422/429/etc. — caller's responsibility, not a network issue.
      return
    }
    // kind === 'network'
    if (this.state === 'healthy') {
      this.log.warn(`Connectivity: network error on "${label}" — entering degraded state`)
      this.transitionTo('degraded')
      this.backoffIndex = 0
      this.scheduleProbe()
    }
    // If already degraded/offline, the probe timer is already running.
  }

  private scheduleProbe(): void {
    this.clearProbeTimer()
    const idx = Math.min(this.backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)
    const base = BACKOFF_SCHEDULE_MS[idx]
    const jittered = base * (0.9 + Math.random() * 0.2)
    this.probeTimer = setTimeout(() => void this.runProbe(), jittered)
  }

  private async runProbe(): Promise<void> {
    this.probeAttempts++

    let client = this.client
    if (!client) {
      // No client at all — rebuild from credentials. This branch is
      // hit only at startup if init() hasn't completed; in steady
      // state we always have a client.
      this.log.warn(`Connectivity: probe attempt #${this.probeAttempts} — no client to probe; trying to (re)build`)
      try {
        await this.rebuildClient('probe with no client')
      } catch (e: any) {
        this.lastFailureMessage = `probe-build: ${e?.message ?? e}`
        this.scheduleProbe()
        return
      }
      client = this.client
      if (!client) {
        // rebuildClient resolved but didn't actually populate this.client.
        // Defensive: don't proceed without a client; reschedule and try
        // again on the next backoff slot.
        this.lastFailureMessage = 'probe-build: rebuildClient produced no client'
        this.scheduleProbe()
        return
      }
    }

    // Reset the transport BEFORE probing.
    //
    // The previous implementation probed against the existing client's
    // socket pool. That pool may hold stale half-open sockets from
    // before the outage; probing against them just keeps failing on
    // dead connections, so the system stayed offline even after the
    // network had recovered. The PubNub-triggered immediate probe
    // hit the same wall.
    //
    // resetTransport() throws away the dispatcher and creates a fresh
    // one without losing auth state, the session token, or
    // configuration. Distinct from destroy() + new August() — that
    // would force a re-auth round-trip on the next call, which itself
    // can fail on a still-flaky network and leave us stuck. With just
    // a transport reset, the next request gets a clean connection
    // pool and reuses the cached session token; if it succeeds, we're
    // healthy in one round-trip.
    client.resetTransport()

    this.log.info(`Connectivity: probe attempt #${this.probeAttempts} (state=${this.state})`)

    try {
      await Promise.race([
        client.locks(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new TimeoutError('probe timed out')), PROBE_TIMEOUT_MS),
        ),
      ])
      this.log.info(`Connectivity: probe attempt #${this.probeAttempts} succeeded`)
      this.transitionTo('healthy')
      this.backoffIndex = 0
    } catch (e: any) {
      this.lastFailureMessage = `${this.classify(e)}: ${e?.message ?? e}`
      if (this.state !== 'offline') {
        this.log.warn('Connectivity: probe failed — entering offline state')
        this.transitionTo('offline')
      }
      this.backoffIndex = Math.min(this.backoffIndex + 1, BACKOFF_SCHEDULE_MS.length - 1)
      this.scheduleProbe()
    }
  }

  private async rebuildClient(reason: string): Promise<void> {
    if (this.rebuildInFlight) {
      return this.rebuildInFlight
    }
    this.rebuildInFlight = (async () => {
      this.log.info(`Connectivity: rebuilding August client (${reason})`)
      const old = this.client
      this.client = new August(await this.credentialsFactory())
      this.onClientChanged(this.client)
      old?.destroy()
    })()
    try {
      await this.rebuildInFlight
    } finally {
      this.rebuildInFlight = undefined
    }
  }

  private classify(e: unknown): ErrorKind {
    // august-yale wraps every transport-level fetch failure into one of
    // its typed exceptions before the error reaches us. We rely on those
    // types here rather than re-implementing undici's 24-class taxonomy.
    //
    // - NetworkError (and its TimeoutError subclass) covers connect
    //   timeouts, socket resets, headers/body timeouts, DNS failures,
    //   TLS proxy failures, malformed responses, etc.
    //
    // - AbortedError reflects an in-flight request racing with our own
    //   teardown (e.g. during rebuildClient). NOT 'network': the consumer
    //   intent was to tear down, so we don't want this to drive the
    //   state machine into degraded.
    //
    // - InvalidAuth is august-yale's auth-failure type. Maps to 'auth'.
    //
    // Anything else (including programmer errors and server-answered
    // 4xx/5xx that august-yale leaves unwrapped) is 'transient' — bubble
    // back to the caller, don't change connectivity state.
    if (e instanceof NetworkError) {
      return 'network'
    }
    if (e instanceof AbortedError) {
      return 'transient'
    }
    if (e instanceof TimeoutError) {
      // Defensive: TimeoutError is also a NetworkError so the first
      // check should match. Kept for clarity in case of future
      // exception hierarchy changes upstream.
      return 'network'
    }
    if (e instanceof InvalidAuth) {
      return 'auth'
    }

    // Fallback for HTTP-level errors that august-yale leaves unwrapped
    // (e.g. server answered with a non-2xx without bare-401 semantics).
    const err = e as { statusCode?: number }
    if (err?.statusCode === 401) {
      return 'auth'
    }
    if (err?.statusCode === 502 || err?.statusCode === 503 || err?.statusCode === 504) {
      // 5xx responses where the server is reachable but reporting an
      // upstream issue. Treat as network — these are recoverable by
      // waiting and retrying (matches the state-machine semantic).
      return 'network'
    }
    return 'transient'
  }

  private transitionTo(next: ConnectivityState): void {
    const prev = this.state
    if (prev === next) {
      return
    }
    this.state = next
    this.log.info(`Connectivity: ${prev} -> ${next}`)

    // Heartbeat lifecycle: start when entering offline, stop when leaving.
    // offlineSinceMs is set on entry; probe-attempt count is NOT reset
    // here because runProbe() already incremented it for the failure
    // that triggered this transition.
    if (next === 'offline') {
      this.offlineSinceMs = Date.now()
      this.startHeartbeat()
    } else if (prev === 'offline') {
      this.stopHeartbeat()
      this.offlineSinceMs = undefined
      this.probeAttempts = 0
    }

    for (const l of this.listeners) {
      try {
        l(next, prev)
      } catch (e: any) {
        this.log.error(`Connectivity listener threw: ${e?.message ?? e}`)
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), OFFLINE_HEARTBEAT_INTERVAL_MS)
    // Allow Node to exit if this is the only outstanding timer; we
    // don't want the heartbeat to keep the process alive on shutdown.
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref()
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private emitHeartbeat(): void {
    if (this.state !== 'offline' || this.offlineSinceMs === undefined) {
      return
    }
    const minutes = Math.floor((Date.now() - this.offlineSinceMs) / 60000)
    const lastFailure = this.lastFailureMessage ?? 'unknown'
    this.log.warn(
      `Connectivity: still offline after ${minutes} min — `
      + `${this.probeAttempts} probe attempt${this.probeAttempts === 1 ? '' : 's'}, `
      + `last failure: ${lastFailure}`,
    )
  }

  private clearProbeTimer(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer)
      this.probeTimer = undefined
    }
  }
}
