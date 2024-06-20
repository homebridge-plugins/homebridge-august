/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-august.
 */
import type { AugustPlatform } from '../platform.js';
import type { API, HAP, Logging, PlatformAccessory } from 'homebridge';
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
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      await this.debugWarnLog(`Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      await this.debugWarnLog(`Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.config.logging) {
      this.deviceLogging = this.accessory.context.logging = this.config.logging;
      await this.debugWarnLog(`Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      await this.debugWarnLog(`Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  async getDeviceRateSettings(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    if (device.refreshRate) {
      if (device.refreshRate === 0) {
        this.deviceRefreshRate = 0;
        await this.warnLog('Refresh Rate set to 0, this will disable the refresh rate for this device');
      } else if (device.refreshRate < 1800) {
        this.deviceRefreshRate = 1800;
        await this.warnLog('Refresh Rate cannot be set to lower the 5 mins, Lock detail are unlikely to change within that period');
      } else {
        this.deviceRefreshRate = device.refreshRate;
      }
      this.accessory.context.deviceRefreshRate = this.deviceRefreshRate;
      await this.debugLog(`Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.config.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.config.refreshRate;
      await this.debugLog(`Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
    // refreshRate
    if (device.refreshRate) {
      this.deviceRefreshRate = device.refreshRate;
      await this.debugLog(`Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.config.options?.refreshRate) {
      this.deviceRefreshRate = this.config.options.refreshRate;
      await this.debugLog(`Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    } else {
      this.deviceRefreshRate = 5;
      await this.debugLog(`Using Default refreshRate: ${this.deviceRefreshRate}`);
    }
    accessory.context.deviceRefreshRate = this.deviceRefreshRate;
    // updateRate
    if (device.updateRate) {
      this.deviceUpdateRate = device.updateRate;
      await this.debugLog(`Using Device Config updateRate: ${this.deviceUpdateRate}`);
    } else if (this.config.options?.updateRate) {
      this.deviceUpdateRate = this.config.options.updateRate;
      await this.debugLog(`Using Platform Config updateRate: ${this.deviceUpdateRate}`);
    } else {
      this.deviceUpdateRate = 5;
      await this.debugLog(`Using Default updateRate: ${this.deviceUpdateRate}`);
    }
    accessory.context.deviceUpdateRate = this.deviceUpdateRate;
    // pushRate
    if (device.pushRate) {
      this.devicePushRate = device.pushRate;
      await this.debugLog(`Using Device Config pushRate: ${this.deviceUpdateRate}`);
    } else if (this.config.options?.pushRate) {
      this.devicePushRate = this.config.options.pushRate;
      await this.debugLog(`Using Platform Config pushRate: ${this.deviceUpdateRate}`);
    } else {
      this.devicePushRate = 1;
      await this.debugLog(`Using Default pushRate: ${this.deviceUpdateRate}`);
    }
    accessory.context.devicePushRate = this.devicePushRate;
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
    let deviceFirmwareVersion: string;
    if (device.firmware) {
      deviceFirmwareVersion = device.firmware;
      await this.debugSuccessLog(`1 FirmwareRevision: ${device.firmware}`);
    } else if (device.currentFirmwareVersion) {
      deviceFirmwareVersion = device.currentFirmwareVersion;
      await this.debugSuccessLog(`2 FirmwareRevision: ${device.currentFirmwareVersion}`);
    } else if (accessory.context.deviceVersion) {
      deviceFirmwareVersion = accessory.context.deviceVersion;
      await this.debugSuccessLog(`3 FirmwareRevision: ${accessory.context.deviceVersion}`);
    } else {
      deviceFirmwareVersion = this.platform.version ?? '0.0.0';
      if (this.platform.version) {
        await this.debugSuccessLog(`4 FirmwareRevision: ${this.platform.version}`);
      } else {
        await this.debugSuccessLog(`5 FirmwareRevision: ${deviceFirmwareVersion}`);
      }
    }
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

  async statusCode(device: device & devicesConfig, error: { message: string; }): Promise<void> {
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
        await this.debugErrorLog(`failed lockStatus (refreshStatus), Error: ${JSON.stringify(error)}`);
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