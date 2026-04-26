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

import August, { TimeoutError } from 'august-yale'

export type ConnectivityState = 'healthy' | 'degraded' | 'offline' | 'recovering'

/**
 * Backoff schedule for probes after the network is detected as broken.
 * Capped at 5 minutes; ±10% jitter is applied at use to avoid synchronized
 * probes across instances during ISP-level events.
 */
const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000]

/** Probe timeout — short on purpose. A healthy August API responds in <1s. */
const PROBE_TIMEOUT_MS = 8_000

/** Network error codes that classify() treats as connectivity failures. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ETIMEDOUT',
])

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
  private backoffIndex = 0
  private rebuildInFlight?: Promise<void>
  private listeners = new Set<(next: ConnectivityState, prev: ConnectivityState) => void>()

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
    this.log.info('Connectivity: PubNub reconnect signal received — probing immediately')
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
    if (!this.client) {
      return
    }
    try {
      // Cheap authenticated call against the EXISTING client. .locks()
      // returns a small map and is the lightest endpoint. Race against a
      // short timeout — the goal is "is the network working", not
      // "is everything healthy".
      await Promise.race([
        this.client.locks(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new TimeoutError('probe timed out')), PROBE_TIMEOUT_MS),
        ),
      ])
      // Network is back. Rebuild the client to shed any half-open sockets
      // accumulated before the outage, then mark healthy.
      await this.rebuildClient('probe succeeded')
      this.transitionTo('healthy')
      this.backoffIndex = 0
    } catch {
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
    const err = e as { name?: string, statusCode?: number, code?: string, message?: string }
    if (err?.name === 'TimeoutError') {
      return 'network'
    }
    if (err?.code && NETWORK_ERROR_CODES.has(err.code)) {
      return 'network'
    }
    if (err?.message && /ETIMEDOUT|ECONNRESET|ENOTFOUND|ENETUNREACH/i.test(err.message)) {
      return 'network'
    }
    if (err?.statusCode === 502 || err?.statusCode === 503 || err?.statusCode === 504) {
      return 'network'
    }
    if (err?.statusCode === 401) {
      return 'auth'
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
    for (const l of this.listeners) {
      try {
        l(next, prev)
      } catch (e: any) {
        this.log.error(`Connectivity listener threw: ${e?.message ?? e}`)
      }
    }
  }

  private clearProbeTimer(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer)
      this.probeTimer = undefined
    }
  }
}
