/**
 * What the plugin prints when nobody asked for debug output.
 *
 * v3.4.2 stopped working `debugMode` out from `-D` in the plugin's own process
 * arguments, because a child bridge never receives it — that part was right.
 * But `platformLogging` then became `'debugMode'` in every normal install, and
 * `loggingIsDebug()` treats that as "debug is on". Three of the debug helpers
 * were gated on it while writing through `log.warn`, `log.error` and
 * `log.success`, which Homebridge always prints — so they started appearing for
 * everyone, whether or not debug was enabled (#243).
 *
 * `log.debug` is the only level Homebridge itself gates, so in `debugMode`
 * these have to go out through it, exactly as `debugLog` already does.
 */
import type { Logging } from 'homebridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deviceBase } from '../src/devices/device.js'
import { AugustPlatform } from '../src/Platform.HAP.js'

function makeLog(): Logging {
  const log = vi.fn() as unknown as Logging
  log.info = vi.fn()
  log.success = vi.fn()
  log.warn = vi.fn()
  log.error = vi.fn()
  log.debug = vi.fn()
  return log
}

/**
 * The log helpers only read `platformLogging` and `this.log`, so they can be
 * exercised without standing a whole platform up.
 */
function makeLogger(platformLogging: string) {
  const log = makeLog()
  const host = Object.create(AugustPlatform.prototype)
  host.log = log
  host.platformLogging = platformLogging
  return { host, log }
}

describe('debug logging when debug is not switched on', () => {
  let host: any
  let log: Logging

  beforeEach(() => {
    ({ host, log } = makeLogger('debugMode'))
  })

  it('does not print a debug warning as a warning', async () => {
    await host.debugWarnLog('a debug warning')

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith('a debug warning')
  })

  it('does not print a debug error as an error', async () => {
    await host.debugErrorLog('a debug error')

    expect(log.error).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith('a debug error')
  })

  it('does not print a debug success as a success', async () => {
    await host.debugSuccessLog('a debug success')

    expect(log.success).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith('a debug success')
  })

  it('still sends a plain debug line to the debug logger', async () => {
    await host.debugLog('an ordinary debug line')

    expect(log.debug).toHaveBeenCalledWith('an ordinary debug line')
  })
})

describe('debug logging when the config asks for it explicitly', () => {
  /**
   * `logging: 'debug'` is a deliberate choice to see debug output regardless of
   * how Homebridge is running, so these stay on their visible levels.
   */
  it('still prints a debug warning as a marked warning', async () => {
    const { host, log } = makeLogger('debug')

    await host.debugWarnLog('a debug warning')

    expect(log.warn).toHaveBeenCalledWith('[DEBUG]', 'a debug warning')
    expect(log.debug).not.toHaveBeenCalled()
  })

  it('still prints a debug error as a marked error', async () => {
    const { host, log } = makeLogger('debug')

    await host.debugErrorLog('a debug error')

    expect(log.error).toHaveBeenCalledWith('[DEBUG]', 'a debug error')
  })
})

/**
 * The tests above set `platformLogging` by hand, which pins the log helpers but
 * says nothing about what a real install ends up with. These two halves have to
 * be joined or the regression could come back through the other one: put
 * `'debugMode'` back into `getPlatformLogSettings` and the helper tests would
 * still pass while the log filled up again.
 */
describe('a default install, from the settings it actually works out', () => {
  function makeHost(configLogging?: string) {
    const log = makeLog()
    const host = Object.create(AugustPlatform.prototype)
    host.log = log
    host.config = { options: configLogging ? { logging: configLogging } : {} }
    return { host, log }
  }

  it('resolves to debugMode when nothing is configured', async () => {
    const { host } = makeHost()

    await host.getPlatformLogSettings()

    expect(host.platformLogging).toBe('debugMode')
  })

  it('prints nothing visible on a normal launch, whatever it resolved to', async () => {
    const { host, log } = makeHost()

    await host.getPlatformLogSettings()
    // the three the plugin actually calls while starting up
    await host.debugWarnLog('Config Credentials: {...}')
    await host.debugErrorLog('something worth debugging')
    await host.debugSuccessLog('something that worked')

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
    expect(log.success).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
  })

  it('still honours logging: debug from the config', async () => {
    const { host, log } = makeHost('debug')

    await host.getPlatformLogSettings()
    await host.debugWarnLog('a debug warning')

    expect(host.platformLogging).toBe('debug')
    expect(log.warn).toHaveBeenCalled()
  })

  /**
   * A device with no logging of its own inherits the platform's, so the same
   * question has to be asked one level down - through the real
   * `getDeviceLogSettings`, not a copy of what it does.
   */
  it('does not make a device print visible debug lines either', async () => {
    const { host: platform } = makeHost()
    await platform.getPlatformLogSettings()

    const log = makeLog()
    const device: any = Object.create(deviceBase.prototype)
    device.log = log
    device.platform = platform
    device.accessory = { displayName: 'Front Door' }

    await device.getDeviceLogSettings({})
    await device.debugWarnLog('a debug warning')
    await device.debugErrorLog('a debug error')

    expect(device.deviceLogging).toBe('debugMode')
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })
})

describe('logging switched off entirely', () => {
  it('prints nothing at all', async () => {
    const { host, log } = makeLogger('none')

    await host.debugWarnLog('a debug warning')
    await host.debugLog('an ordinary debug line')
    await host.infoLog('an info line')

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.debug).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
  })
})
