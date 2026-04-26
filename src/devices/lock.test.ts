import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('lock pushChanges method', () => {
  // Test that the improved pushChanges method has better logging and validation
  it('should add defensive logging for API calls', () => {
    // This test validates that our code improvements are present
    // We test the actual code changes by checking the source contains our improvements
    const lockTsPath = join(__dirname, 'lock.ts')
    const lockTsContent = readFileSync(lockTsPath, 'utf8')

    // Verify that our defensive logging is present
    expect(lockTsContent).toContain('Making API call - Target:')
    expect(lockTsContent).toContain('States synchronized before API call')
    expect(lockTsContent).toContain('Double-check that we still need to make the API call')
  })

  it('should have proper error handling structure', () => {
    // Validate that the error handling structure is maintained
    const lockTsPath = join(__dirname, 'lock.ts')
    const lockTsContent = readFileSync(lockTsPath, 'utf8')

    // Verify error handling is still present
    expect(lockTsContent).toContain('await this.statusCode(\'pushChanges\', e)')
    expect(lockTsContent).toContain('pushChanges: ${e.message')
  })
})

describe('lock context seeding for change detection', () => {
  const lockTsPath = join(__dirname, 'lock.ts')
  const lockTsContent = readFileSync(lockTsPath, 'utf8')

  it('should seed LockMechanism context keys for change detection', () => {
    expect(lockTsContent).toContain('accessory.context.LockMechanismLockCurrentState ??= this.LockMechanism.LockCurrentState')
    expect(lockTsContent).toContain('accessory.context.LockMechanismLockTargetState ??= this.LockMechanism.LockTargetState')
  })

  it('should seed ContactSensor context key for change detection', () => {
    expect(lockTsContent).toContain('accessory.context.ContactSensorContactSensorState ??= this.ContactSensor.ContactSensorState')
  })

  it('should seed Battery context keys for change detection', () => {
    expect(lockTsContent).toContain('accessory.context.BatteryBatteryLevel ??= this.Battery.BatteryLevel')
    expect(lockTsContent).toContain('accessory.context.BatteryStatusLowBattery ??= this.Battery.StatusLowBattery')
  })

  it('should seed context keys after creating service objects but before initializing characteristics', () => {
    // Verify seeding happens between object assignment and characteristic initialization
    const lockMechanismSeed = lockTsContent.indexOf('accessory.context.LockMechanismLockCurrentState ??=')
    const lockMechanismAssign = lockTsContent.indexOf('accessory.context.LockMechanism = this.LockMechanism as object')
    const lockCharInit = lockTsContent.indexOf('this.LockMechanism.Service\n        .setCharacteristic(this.hap.Characteristic.Name')

    expect(lockMechanismSeed).toBeGreaterThan(lockMechanismAssign)
    expect(lockMechanismSeed).toBeLessThan(lockCharInit)

    const contactSensorSeed = lockTsContent.indexOf('accessory.context.ContactSensorContactSensorState ??=')
    const contactSensorAssign = lockTsContent.indexOf('accessory.context.ContactSensor = this.ContactSensor as object')
    const contactCharInit = lockTsContent.indexOf('this.ContactSensor.Service\n        .setCharacteristic(this.hap.Characteristic.Name')

    expect(contactSensorSeed).toBeGreaterThan(contactSensorAssign)
    expect(contactSensorSeed).toBeLessThan(contactCharInit)
  })

  it('should use nullish coalescing assignment (??=) to preserve existing persisted values', () => {
    // Ensure ??= is used (not = or ||=) so that persisted context values from previous runs are kept
    const lockCurrentLine = lockTsContent.match(/accessory\.context\.LockMechanismLockCurrentState\s*\?\?=/)
    const lockTargetLine = lockTsContent.match(/accessory\.context\.LockMechanismLockTargetState\s*\?\?=/)
    const contactLine = lockTsContent.match(/accessory\.context\.ContactSensorContactSensorState\s*\?\?=/)
    const batteryLevelLine = lockTsContent.match(/accessory\.context\.BatteryBatteryLevel\s*\?\?=/)
    const batteryLowLine = lockTsContent.match(/accessory\.context\.BatteryStatusLowBattery\s*\?\?=/)

    expect(lockCurrentLine).not.toBeNull()
    expect(lockTargetLine).not.toBeNull()
    expect(contactLine).not.toBeNull()
    expect(batteryLevelLine).not.toBeNull()
    expect(batteryLowLine).not.toBeNull()
  })
})

describe('parseStatus uses lockStatus not lockEvent', () => {
  const lockTsPath = join(__dirname, 'lock.ts')
  const lockTsContent = readFileSync(lockTsPath, 'utf8')

  // Extract the two methods so we can assert on each independently
  const parseStatusMatch = lockTsContent.match(/async parseStatus\(\)[\s\S]*?(?=\n {2}async parseEventStatus)/)
  const parseEventStatusMatch = lockTsContent.match(/async parseEventStatus\(\)[\s\S]*?(?=\n {2}\/\*\*|\n {2}async refreshStatus)/)
  const parseStatusBody = parseStatusMatch?.[0] ?? ''
  const parseEventStatusBody = parseEventStatusMatch?.[0] ?? ''

  it('should have extractable parseStatus and parseEventStatus methods', () => {
    expect(parseStatusBody.length).toBeGreaterThan(0)
    expect(parseEventStatusBody.length).toBeGreaterThan(0)
  })

  it('should use lockStatus.state for the guard condition in parseStatus', () => {
    // The definitive-state check must reference lockStatus, not lockEvent
    expect(parseStatusBody).toContain('this.lockStatus.state.locked !== this.lockStatus.state.unlocked')
  })

  it('should NOT reference lockEvent.state in parseStatus guard condition', () => {
    // Regression guard: lockEvent is undefined on startup when parseStatus runs
    expect(parseStatusBody).not.toContain('this.lockEvent.state.locked')
    expect(parseStatusBody).not.toContain('this.lockEvent.state.unlocked')
  })

  it('should log lockStatus in parseStatus warn messages', () => {
    // The locking/unlocking warn log and UNKNOWN warn log should reference lockStatus
    expect(parseStatusBody).toMatch(/lockStatus: \$\{JSON\.stringify\(this\.lockStatus\)\}/)
    expect(parseStatusBody).not.toMatch(/lockEvent: \$\{JSON\.stringify\(this\.lockEvent\)\}/)
  })

  it('should still use lockEvent.state in parseEventStatus', () => {
    // parseEventStatus handles PubNub subscription events where lockEvent IS populated
    expect(parseEventStatusBody).toContain('this.lockEvent.state.locked !== this.lockEvent.state.unlocked')
    expect(parseEventStatusBody).toContain('this.lockEvent.state.locked')
  })

  it('should guard parseEventStatus with an if (this.lockEvent) check', () => {
    // parseEventStatus must be guarded so it only runs when lockEvent is defined
    expect(parseEventStatusBody).toMatch(/if\s*\(this\.lockEvent\)/)
  })

  it('should still derive LockCurrentState from lockStatus.state in parseStatus', () => {
    // The actual state assignment inside the guard should use lockStatus
    expect(parseStatusBody).toContain('this.lockStatus.state.locked')
    expect(parseStatusBody).toContain('this.lockStatus.state.unlocked')
  })
})

describe('lock commands are not dropped during updates', () => {
  const lockTsPath = join(__dirname, 'lock.ts')
  const lockTsContent = readFileSync(lockTsPath, 'utf8')

  const parseStatusMatch = lockTsContent.match(/async parseStatus\(\)[\s\S]*?(?=\n {2}async parseEventStatus)/)
  const parseEventStatusMatch = lockTsContent.match(/async parseEventStatus\(\)[\s\S]*?(?=\n {2}\/\*\*|\n {2}async refreshStatus)/)
  const parseStatusBody = parseStatusMatch?.[0] ?? ''
  const parseEventStatusBody = parseEventStatusMatch?.[0] ?? ''

  it('should use filter (not skipWhile) on the refresh interval', () => {
    // skipWhile only suppresses at the start of the stream and then permanently
    // stops filtering. filter evaluates on every emission.
    expect(lockTsContent).toContain('filter(() => !this.lockUpdateInProgress)')
    expect(lockTsContent).not.toContain('skipWhile')
  })

  it('should import filter from rxjs/operators', () => {
    expect(lockTsContent).toMatch(/import\s*\{[^}]*filter[^}]*\}\s*from\s*'rxjs\/operators'/)
  })

  it('should guard LockTargetState sync in parseStatus with lockUpdateInProgress', () => {
    // parseStatus must NOT unconditionally overwrite TargetState, or it will
    // erase the user's lock/unlock intent before pushChanges can act on it
    expect(parseStatusBody).toContain('if (!this.lockUpdateInProgress)')
    expect(parseStatusBody).toContain('this.LockMechanism.LockTargetState = this.LockMechanism.LockCurrentState')
  })

  it('should guard LockTargetState sync in parseEventStatus with lockUpdateInProgress', () => {
    // PubNub events arrive continuously and must not reset TargetState during updates
    expect(parseEventStatusBody).toContain('if (!this.lockUpdateInProgress)')
    expect(parseEventStatusBody).toContain('this.LockMechanism.LockTargetState = this.LockMechanism.LockCurrentState')
  })

  it('should always update LockCurrentState regardless of lockUpdateInProgress', () => {
    // LockCurrentState should reflect the physical lock state at all times.
    // The lockUpdateInProgress guard must only wrap TargetState, not CurrentState.
    // Verify that the CurrentState assignment is NOT inside the guard.
    const parseStatusCurrentAssign = parseStatusBody.indexOf('this.LockMechanism.LockCurrentState = this.lockStatus.state.locked')
    const parseStatusGuard = parseStatusBody.indexOf('if (!this.lockUpdateInProgress)')
    expect(parseStatusCurrentAssign).toBeLessThan(parseStatusGuard)

    const parseEventCurrentAssign = parseEventStatusBody.indexOf('this.LockMechanism.LockCurrentState = this.lockEvent.state.locked')
    const parseEventGuard = parseEventStatusBody.indexOf('if (!this.lockUpdateInProgress)')
    expect(parseEventCurrentAssign).toBeLessThan(parseEventGuard)
  })
})

describe('session refresh and PubNub subscription lifecycle', () => {
  const lockTsPath = join(__dirname, 'lock.ts')
  const lockTsContent = readFileSync(lockTsPath, 'utf8')
  const platformTsPath = join(__dirname, '..', 'platform.ts')
  const platformTsContent = readFileSync(platformTsPath, 'utf8')

  // Extract refreshAugustSession and executeSessionRefresh
  const refreshMatch = platformTsContent.match(/async refreshAugustSession\(\)[\s\S]*?(?=\n {2}private async executeSessionRefresh)/)
  const executeMatch = platformTsContent.match(/private async executeSessionRefresh\(\)[\s\S]*?(?=\n {2}async pluginConfig)/)
  const refreshBody = refreshMatch?.[0] ?? ''
  const executeBody = executeMatch?.[0] ?? ''

  it('should have extractable refreshAugustSession and executeSessionRefresh methods', () => {
    expect(refreshBody.length).toBeGreaterThan(0)
    expect(executeBody.length).toBeGreaterThan(0)
  })

  // --- Promise coalescing (concurrent 502 protection) ---

  it('should use promise coalescing, not a boolean flag', () => {
    // Promise coalescing: concurrent callers share the same promise.
    // Boolean flag causes "skip" — callers retry with a dead instance.
    expect(refreshBody).toContain('this.sessionRefreshPromise')
    expect(platformTsContent).not.toContain('sessionRefreshInProgress')
  })

  it('should return the existing promise when a refresh is already in progress', () => {
    // This is the coalescing: callers await the in-flight refresh
    // instead of starting their own or skipping entirely
    expect(refreshBody).toContain('return this.sessionRefreshPromise')
  })

  it('should clear the promise after refresh completes', () => {
    // Ensures the next 502 triggers a fresh refresh
    expect(refreshBody).toContain('this.sessionRefreshPromise = undefined')
  })

  // --- Session refresh lifecycle ---

  it('should destroy the old instance before creating a new one', () => {
    const destroyCall = executeBody.indexOf('.destroy()')
    const nullAssign = executeBody.indexOf('this.augustConfig = undefined')
    const credentialsCall = executeBody.indexOf('this.augustCredentials()')

    // Verify the order: destroy → null → create. destroy() releases the
    // undici Agent + its socket pool; end() alone only clears the token
    // and would leak the dispatcher across refreshes.
    expect(destroyCall).toBeGreaterThan(-1)
    expect(nullAssign).toBeGreaterThan(destroyCall)
    expect(credentialsCall).toBeGreaterThan(nullAssign)
  })

  it('should NOT rebuild PubNub subscriptions during session refresh', () => {
    // PubNub subscriptions are independent of the HTTP session and should
    // NOT be torn down or rebuilt during a session refresh. Doing so
    // caused the 502 cascade + memory leak in earlier versions.
    expect(executeBody).not.toContain('resubscribeCallbacks')
    expect(executeBody).not.toContain('subscribeAugust')
    expect(platformTsContent).not.toContain('registerResubscribeCallback')
    expect(platformTsContent).not.toContain('unregisterResubscribeCallback')
  })

  // --- PubNub subscription cleanup on lock removal ---

  it('should capture the unsubscribe function returned by August.subscribe', () => {
    // Previously the return value was discarded, leaking PubNub instances.
    expect(lockTsContent).toMatch(/this\.pubnubUnsubscribe\s*=\s*await August\.subscribe/)
  })

  it('should provide a tearDownPubNubSubscription method on LockMechanism', () => {
    expect(lockTsContent).toMatch(/tearDownPubNubSubscription\(\)/)
    expect(lockTsContent).toContain('this.pubnubUnsubscribe()')
  })

  it('should call the unsubscribe function and clear the reference', () => {
    // Extract tearDownPubNubSubscription method definition (not calls to it)
    const tearDownMatch = lockTsContent.match(/tearDownPubNubSubscription\(\):\s*void\s*\{[\s\S]*?\n {2}\}/)
    const tearDownBody = tearDownMatch?.[0] ?? ''
    expect(tearDownBody).toContain('this.pubnubUnsubscribe()')
    expect(tearDownBody).toContain('this.pubnubUnsubscribe = undefined')
  })

  it('should tear down PubNub subscription before creating a new one (idempotent subscribeAugust)', () => {
    // subscribeAugust() should clean up any previous subscription first,
    // so repeated calls do not leak PubNub instances.
    const subscribeMatch = lockTsContent.match(/async subscribeAugust\(\)[\s\S]*?(?=\n {2}\/\*\*|\n {2}tearDownPubNubSubscription)/)
    const subscribeBody = subscribeMatch?.[0] ?? ''
    const tearDownCall = subscribeBody.indexOf('this.tearDownPubNubSubscription()')
    const augustSubscribeCall = subscribeBody.indexOf('August.subscribe')
    expect(tearDownCall).toBeGreaterThan(-1)
    expect(augustSubscribeCall).toBeGreaterThan(tearDownCall)
  })

  // --- Platform-side tracking for proper cleanup ---

  it('should track LockMechanism instances by lockId for cleanup', () => {
    expect(platformTsContent).toMatch(/lockMechanisms\s*=\s*new Map<string, LockMechanism>/)
  })

  it('should tear down LockMechanism PubNub subscription when unregistering accessory', () => {
    expect(platformTsContent).toMatch(/tearDownLockMechanism\(device\.lockId\)/)
  })

  it('should tear down LockMechanism when excluding lock via excludeLockIds', () => {
    expect(platformTsContent).toMatch(/tearDownLockMechanism\(excludedId\)/)
  })

  it('tearDownLockMechanism should call tearDownPubNubSubscription and remove from map', () => {
    const tearDownMatch = platformTsContent.match(/private tearDownLockMechanism\([\s\S]*?(?=\n {2}\})/)
    const body = tearDownMatch?.[0] ?? ''
    expect(body).toContain('tearDownPubNubSubscription()')
    expect(body).toContain('this.lockMechanisms.delete')
  })
})

describe('session refresh cooldown', () => {
  const platformTsPath = join(__dirname, '..', 'platform.ts')
  const platformTsContent = readFileSync(platformTsPath, 'utf8')
  const refreshMatch = platformTsContent.match(/async refreshAugustSession\(\)[\s\S]*?(?=\n {2}private async executeSessionRefresh)/)
  const refreshBody = refreshMatch?.[0] ?? ''

  it('should track the time of the last refresh attempt', () => {
    expect(platformTsContent).toMatch(/lastSessionRefresh\s*=\s*0/)
  })

  it('should define a cooldown constant', () => {
    expect(platformTsContent).toMatch(/SESSION_REFRESH_COOLDOWN_MS/)
  })

  it('should skip refresh when within the cooldown window', () => {
    expect(refreshBody).toContain('sinceLastRefresh')
    expect(refreshBody).toMatch(/sinceLastRefresh\s*<\s*AugustPlatform\.SESSION_REFRESH_COOLDOWN_MS/)
  })

  it('should update lastSessionRefresh after a refresh completes', () => {
    expect(refreshBody).toContain('this.lastSessionRefresh = Date.now()')
  })

  it('should check cooldown after coalescing check', () => {
    // Promise coalescing should still take priority over the cooldown.
    // If a refresh is in flight, callers await it regardless of cooldown.
    const coalescingCheck = refreshBody.indexOf('this.sessionRefreshPromise')
    const cooldownCheck = refreshBody.indexOf('sinceLastRefresh')
    expect(coalescingCheck).toBeGreaterThan(-1)
    expect(cooldownCheck).toBeGreaterThan(coalescingCheck)
  })
})
