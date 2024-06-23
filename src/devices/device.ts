/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-august.
 */
import type { AugustPlatform } from '../platform.js';
import type { API, HAP, Logging, PlatformAccessory, Service, CharacteristicValue } from 'homebridge';
import type { device, devicesConfig, AugustPlatformConfig } from '../settings.js';

export abstract class deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: AugustPlatformConfig;
  protected readonly hap: HAP;

  // Config
  protected deviceLogging!: string;
  protected deviceRefreshRate!: number;
  protected deviceUpdateRate!: number;
  protected devicePushRate!: number;

  constructor(
    protected readonly platform: AugustPlatform,
    protected accessory: PlatformAccessory,
    protected device: device & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.getDeviceLogSettings(accessory, device);
    this.getDeviceRateSettings(accessory, device);
    this.getDeviceConfigSettings(accessory, device);
    this.getDeviceContext(accessory, device);

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'August Home Inc.')
      .setCharacteristic(this.hap.Characteristic.AppMatchingIdentifier, 'id648730592')
      .setCharacteristic(this.hap.Characteristic.Model, device.skuNumber ?? accessory.context.model)
      .setCharacteristic(this.hap.Characteristic.ProductData, accessory.context.serialnumber)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.LockId ?? accessory.context.serialnumber);
  }

  async getDeviceLogSettings(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    this.deviceLogging = this.platform.debugMode ? 'debugMode' : device.logging ?? this.config.options?.logging ?? 'standard';
    const logging = this.platform.debugMode ? 'debugMode' : device.logging ? 'Device Config' : this.config.options?.logging
      ? 'Platform Confg' : 'Default';
    accessory.context.logging = this.deviceLogging;
    await this.debugLog(`Using ${logging} Logging: ${this.deviceLogging}`);
  }

  async getDeviceRateSettings(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    // refreshRate
    this.deviceRefreshRate = device.refreshRate === 0 ? 0 : device.refreshRate ?? this.config.options?.refreshRate ?? 30;
    const refreshRate = device.refreshRate === 0 ? 'Disabled' : device.refreshRate ? 'Device Config' : this.config.options?.refreshRate
      ? 'Platform Config' : 'Default';
    accessory.context.deviceRefreshRate = this.deviceRefreshRate;
    await this.debugLog(`Using ${refreshRate} refreshRate`);
    // updateRate
    this.deviceUpdateRate = device.updateRate ?? this.config.options?.updateRate ?? 5;
    const updateRate = device.updateRate ? 'Device Config' : this.config.options?.updateRate ? 'Platform Config' : 'Default';
    accessory.context.deviceUpdateRate = this.deviceUpdateRate;
    await this.debugLog(`Using ${updateRate} updateRate`);
    // pushRate
    this.devicePushRate = device.pushRate ?? this.config.options?.pushRate ?? 1;
    const pushRate = device.pushRate ? 'Device Config' : this.config.options?.pushRate ? 'Platform Config' : 'Default';
    accessory.context.devicePushRate = this.devicePushRate;
    await this.debugLog(`Using ${pushRate} pushRate`);
  }

  async getDeviceConfigSettings(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    const deviceConfig = {};
    if ((device.logging !== 'standard') && (device.logging !== undefined)) {
      deviceConfig['logging'] = device.logging;
    }
    if (device.refreshRate !== undefined) {
      deviceConfig['refreshRate'] = device.refreshRate;
    }
    if (device.overrideHomeKitEnabled === true) {
      deviceConfig['refreshRate'] = device.refreshRate;
    }
    if (device.updateRate !== undefined) {
      deviceConfig['refreshRate'] = device.updateRate;
    }
    if (device.pushRate !== undefined) {
      deviceConfig['refreshRate'] = device.pushRate;
    }
    if (device.lock) {
      if (device.lock.hide_contactsensor === true) {
        deviceConfig['hide_contactsensor'] = device.lock.hide_contactsensor;
      }
      if (device.lock.hide_lock === true) {
        deviceConfig['hide_lock'] = device.lock.hide_lock;
      }
    }
    const config = Object.assign({}, deviceConfig);
    if (Object.entries(config).length !== 0) {
      await this.infoLog(`Config: ${JSON.stringify(config)}`);
    }
  }

  async getDeviceContext(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    // Firmware Version
    const deviceFirmwareVersion = device.firmware ?? device.currentFirmwareVersion ?? this.platform.version ?? '0.0.0';
    const version = deviceFirmwareVersion.toString();
    await this.debugLog(`${this.device.Type}: ${accessory.displayName} Firmware Version: ${version?.replace(/^V|-.*$/g, '')}`);
    let deviceVersion: string;
    if (version?.includes('.') === false) {
      const replace = version?.replace(/^V|-.*$/g, '');
      const match = replace?.match(/.{1,1}/g);
      const validVersion = match?.join('.');
      deviceVersion = validVersion ?? '0.0.0';
    } else {
      deviceVersion = version?.replace(/^V|-.*$/g, '') ?? '0.0.0';
    }
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, deviceVersion)
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, deviceVersion)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, deviceVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(deviceVersion);
    accessory.context.deviceVersion = deviceVersion;
    await this.debugSuccessLog(`deviceVersion: ${accessory.context.deviceVersion}`);
  }

  /**
  * Update the characteristic value and log the change.
  *
  * @param Service: Service
  * @param Characteristic: Characteristic
  * @param CharacteristicValue: CharacteristicValue | undefined
  * @param CharacteristicName: string
  * @return: void
  *
  */
  async updateCharacteristic(Service: Service, Characteristic: any,
    CharacteristicValue: CharacteristicValue | undefined, CharacteristicName: string): Promise<void> {
    if (CharacteristicValue === undefined) {
      this.debugLog(`${CharacteristicName}: ${CharacteristicValue}`);
    } else {
      Service.updateCharacteristic(Characteristic, CharacteristicValue);
      this.debugLog(`updateCharacteristic ${CharacteristicName}: ${CharacteristicValue}`);
      this.debugWarnLog(`context before: ${this.accessory.context[CharacteristicName]}`);
      this.accessory.context[CharacteristicName] = CharacteristicValue;
      this.debugWarnLog(`context after: ${this.accessory.context[CharacteristicName]}`);
    }
  }

  async statusCode(device: device & devicesConfig, action, error: { message: string; }): Promise<void> {
    if (!device.hide_device) {
      const statusCodeString = error.message; // Convert statusCode to a string
      if (statusCodeString.includes('100')) {
        await this.debugLog(`Command successfully sent, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('200')) {
        await this.debugLog(`Request successful, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('400')) {
        await this.errorLog(`Bad Request, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('429')) {
        await this.errorLog(`Too Many Requests, exceeded the number of requests allowed for a given time window, statusCode: ${statusCodeString}`);
      } else {
        await this.debugLog(`Unknown statusCode: ${statusCodeString}, Submit Bugs Here: https://tinyurl.com/AugustYaleBug`);
        await this.debugErrorLog(`failed ${action}, Error: ${JSON.stringify(error)}`);
      }
    }
  }

  /**
   * Logging for Device
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.info(`Lock: ${this.accessory.displayName}`, String(...log));
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.success(`Lock: ${this.accessory.displayName}`, String(...log));
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.success(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.warn(`Lock: ${this.accessory.displayName}`, String(...log));
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.warn(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.error(`Lock: ${this.accessory.displayName}`, String(...log));
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.error(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log));
      } else {
        this.log.debug(`Lock: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async enablingDeviceLogging(): Promise<boolean> {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}