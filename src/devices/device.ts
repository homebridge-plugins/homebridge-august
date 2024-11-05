import type { API, CharacteristicValue, HAP, Logging, PlatformAccessory, Service } from 'homebridge'

/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-august.
 */
import type { AugustPlatform } from '../platform.js'
import type { AugustPlatformConfig, device, devicesConfig } from '../settings.js'

export abstract class deviceBase {
  public readonly api: API
  public readonly log: Logging
  public readonly config!: AugustPlatformConfig
  protected readonly hap: HAP

  // Config
  protected deviceLogging!: string
  protected deviceRefreshRate!: number
  protected deviceUpdateRate!: number
  protected devicePushRate!: number
  protected deviceFirmwareVersion!: string

  constructor(
    protected readonly platform: AugustPlatform,
    protected accessory: PlatformAccessory,
    protected device: device & devicesConfig,
  ) {
    this.api = this.platform.api
    this.log = this.platform.log
    this.config = this.platform.config
    this.hap = this.api.hap

    this.getDeviceLogSettings(device)
    this.getDeviceRateSettings(device)
    this.getDeviceConfigSettings(device)
    this.getDeviceContext(accessory, device)

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'August Home Inc.')
      .setCharacteristic(this.hap.Characteristic.AppMatchingIdentifier, 'id648730592')
      .setCharacteristic(this.hap.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.Model, device.skuNumber)
      .setCharacteristic(this.hap.Characteristic.ProductData, device.lockId)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.SerialNumber)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion)
  }

  async getDeviceLogSettings(device: devicesConfig): Promise<void> {
    this.deviceLogging = this.platform.debugMode ? 'debugMode' : device.logging ?? this.platform.platformLogging ?? 'standard'
    const logging = this.platform.debugMode ? 'Debug Mode' : device.logging ? 'Device Config' : this.platform.platformLogging ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${logging} Logging: ${this.deviceLogging}`)
  }

  async getDeviceRateSettings(device: devicesConfig): Promise<void> {
    // refreshRate
    this.deviceRefreshRate = device.refreshRate ?? this.platform.platformRefreshRate ?? 30
    const refreshRate = device.refreshRate ? 'Device Config' : this.platform.platformRefreshRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${refreshRate} refreshRate: ${this.deviceRefreshRate}`)
    // updateRate
    this.deviceUpdateRate = device.updateRate ?? this.platform.platformUpdateRate ?? 5
    const updateRate = device.updateRate ? 'Device Config' : this.platform.platformUpdateRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${updateRate} updateRate: ${this.deviceUpdateRate}`)
    // pushRate
    this.devicePushRate = device.pushRate ?? this.platform.platformPushRate ?? 1
    const pushRate = device.pushRate ? 'Device Config' : this.platform.platformPushRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${pushRate} pushRate: ${this.devicePushRate}`)
  }

  async getDeviceConfigSettings(device: devicesConfig): Promise<void> {
    const deviceConfig = {}
    const properties = [
      'logging',
      'refreshRate',
      'updateRate',
      'pushRate',
      'overrideHomeKitEnabled',
      'external',
    ]
    properties.forEach((prop) => {
      if (device[prop] !== undefined) {
        deviceConfig[prop] = device[prop]
      }
    })
    if (Object.keys(deviceConfig).length !== 0) {
      this.infoLog(`Config: ${JSON.stringify(deviceConfig)}`)
    }
  }

  async getDeviceContext(accessory: PlatformAccessory, device: devicesConfig): Promise<void> {
    const deviceFirmwareVersion = device.firmware ?? device.currentFirmwareVersion ?? this.platform.version ?? '0.0.0'
    const version = deviceFirmwareVersion.toString()
    this.debugLog(`Firmware Version: ${version.replace(/^V|-.*$/g, '')}`)
    if (version?.includes('.') === false) {
      const replace = version?.replace(/^V|-.*$/g, '')
      const match = replace?.match(/./g)
      const validVersion = match?.join('.')
      this.deviceFirmwareVersion = validVersion ?? '0.0.0'
    } else {
      this.deviceFirmwareVersion = version.replace(/^V|-.*$/g, '') ?? '0.0.0'
    }
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.deviceFirmwareVersion)
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, this.deviceFirmwareVersion)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion)
    this.debugSuccessLog(`deviceFirmwareVersion: ${this.deviceFirmwareVersion}`)
  }

  /**
   * Updates the value of a HomeKit characteristic and logs the change.
   *
   * This function updates the specified characteristic of a given service with a new value.
   * It also logs the updated value and the context before and after the update for debugging purposes.
   *
   * @param Service - The HomeKit service that contains the characteristic to be updated.
   * @param ServiceName - The name of the service being updated.
   * @param Characteristic - The specific characteristic to be updated.
   * @param CharacteristicValue - The new value to set for the characteristic. If undefined, the function logs the value and returns without updating.
   * @param CharacteristicName - The name of the characteristic being updated, used for logging purposes.
   * @param Value - The value to compare against to determine the status.
   * @param StatusMatch - The status message to log if the characteristic value matches the provided value.
   * @param StatusDoesNotMatch - The status message to log if the chxaracteristic value does not match the provided value.
   * @return void
   */
  async updateCharacteristic(
    Service: Service,
    ServiceName: string,
    Characteristic: any,
    CharacteristicValue: CharacteristicValue,
    CharacteristicName: string,
    Value?: CharacteristicValue,
    StatusMatch?: string,
    StatusDoesNotMatch?: string,
  ): Promise<void> {
    if (CharacteristicValue === undefined) {
      await this.debugLog(`${CharacteristicName}: ${CharacteristicValue}`)
    } else {
      Service.updateCharacteristic(Characteristic, CharacteristicValue)
      await this.debugLog(`updateCharacteristic ${CharacteristicName}: ${CharacteristicValue} (${CharacteristicValue === Value ? StatusMatch : StatusDoesNotMatch})`)
      await this.debugWarnLog(`context before: ${this.accessory.context[ServiceName[CharacteristicName]]}`)
      const contextBefore = this.accessory.context[ServiceName[CharacteristicName]]
      this.accessory.context[ServiceName[CharacteristicName]] = CharacteristicValue
      await this.debugWarnLog(`context after: ${this.accessory.context[ServiceName[CharacteristicName]]}`)
      if ((contextBefore !== this.accessory.context[ServiceName[CharacteristicName]]) && StatusMatch && StatusDoesNotMatch) {
        await this.infoLog(`was ${CharacteristicValue === Value ? StatusMatch : StatusDoesNotMatch}`)
      }
    }
  }

  async statusCode(action: string, error: { message: string }): Promise<void> {
    const statusCodeString = error.message // Convert statusCode to a string
    const logMap = {
      100: `Command successfully sent, statusCode: ${statusCodeString}`,
      200: `Request successful, statusCode: ${statusCodeString}`,
      400: `Bad Request, statusCode: ${statusCodeString}`,
      429: `Too Many Requests, exceeded the number of requests allowed for a given time window, statusCode: ${statusCodeString}`,
    }
    const logMessage = logMap[statusCodeString.slice(0, 3)]
      ?? `Unknown statusCode: ${statusCodeString}, Submit Bugs Here: https://tinyurl.com/AugustYaleBug`
    await this.debugLog(logMessage)
    if (!logMap[statusCodeString.slice(0, 3)]) {
      await this.debugErrorLog(`failed ${action}, Error: ${error}`)
    }
  }

  /**
   * Logging for Device
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.info(`Lock: ${this.accessory.displayName}`, String(...log))
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.success(`Lock: ${this.accessory.displayName}`, String(...log))
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.success(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log))
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.warn(`Lock: ${this.accessory.displayName}`, String(...log))
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.warn(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log))
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.error(`Lock: ${this.accessory.displayName}`, String(...log))
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.error(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log))
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log))
      } else if (this.deviceLogging === 'debugMode') {
        this.log.debug(`Lock: ${this.accessory.displayName}`, String(...log))
      }
    }
  }

  async loggingIsDebug(): Promise<boolean> {
    return this.deviceLogging === 'debugMode' || this.deviceLogging === 'debug'
  }

  async enablingDeviceLogging(): Promise<boolean> {
    return this.deviceLogging === 'debugMode' || this.deviceLogging === 'debug' || this.deviceLogging === 'standard'
  }
}
