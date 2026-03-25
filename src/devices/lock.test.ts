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
