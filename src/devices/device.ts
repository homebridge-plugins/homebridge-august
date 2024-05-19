/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-august.
 */
import type { AugustPlatform } from '../platform.js';
import type { device, devicesConfig, AugustPlatformConfig } from '../settings.js';
import type { API, HAP, Logging, PlatformAccessory } from 'homebridge';

export abstract class deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: AugustPlatformConfig;
  protected readonly hap: HAP;

  // Config
  protected deviceLogging!: string;
  protected deviceRefreshRate!: number;

  constructor(
    protected readonly platform: AugustPlatform,
    protected accessory: PlatformAccessory,
    protected device: device & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.deviceLogs(device);
    this.getDeviceRefreshRate(device);
    this.deviceConfigOptions(device);
    this.deviceContext(accessory, device);

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'August Home Inc.')
      .setCharacteristic(this.hap.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, accessory.context.serialnumber)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.currentFirmwareVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(accessory.context.currentFirmwareVersion);
  }

  async deviceLogs(device: device & devicesConfig): Promise<void> {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.config.logging) {
      this.deviceLogging = this.accessory.context.logging = this.config.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  async getDeviceRefreshRate(device: device & devicesConfig): Promise<void> {
    if (device.refreshRate) {
      if (device.refreshRate === 0) {
        this.deviceRefreshRate = 0;
        this.warnLog('Refresh Rate set to 0, this will disable the refresh rate for this device');
      } else if (device.refreshRate < 1800) {
        this.deviceRefreshRate = 1800;
        this.warnLog('Refresh Rate cannot be set to lower the 5 mins, as Lock detail (battery level, etc) are unlikely to change within that period');
      } else {
        this.deviceRefreshRate = device.refreshRate;
      }
      this.accessory.context.deviceRefreshRate = this.deviceRefreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.config.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.config.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  async deviceConfigOptions(device: device & devicesConfig): Promise<void> {
    const deviceConfig = {};
    if (device.logging !== undefined) {
      deviceConfig['logging'] = device.logging;
    }
    if (device.refreshRate !== undefined) {
      deviceConfig['refreshRate'] = device.refreshRate;
    }
    let lockConfig = {};
    if (device.lock) {
      lockConfig = device.lock;
    }
    const config = Object.assign({}, deviceConfig, lockConfig);
    if (Object.entries(config).length !== 0) {
      this.infoLog(`Lock: ${this.accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }

  async deviceContext(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    if (device.firmware) {
      accessory.context.FirmwareRevision = device.firmware;
    } else if (accessory.context.FirmwareRevision === undefined) {
      accessory.context.FirmwareRevision = await this.platform.getVersion();
    } else {
      accessory.context.FirmwareRevision = '3';
    }
  }

  async statusCode(device: device & devicesConfig, error: { message: string; }): Promise<void> {
    if (!device.hide_device) {
      const statusCodeString = String(error); // Convert statusCode to a string
      if (statusCodeString.includes('100')) {
        this.debugLog(`Lock: ${this.accessory.displayName} Command successfully sent, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('200')) {
        this.debugLog(`Lock: ${this.accessory.displayName} Request successful, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('400')) {
        this.errorLog(`Lock: ${this.accessory.displayName} Bad Request, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('429')) {
        this.errorLog(`Lock: ${this.accessory.displayName} Too Many Requests, exceeded the number of `
          + `requests allowed for a given time window, statusCode: ${statusCodeString}`);
      } else {
        this.debugLog(`Lock: ${this.accessory.displayName} Unknown statusCode: ${statusCodeString}, Submit Bugs Here: '
      + 'https://tinyurl.com/AugustYaleBug`);
        this.debugErrorLog(`Lock: ${this.accessory.displayName} failed lockStatus (refreshStatus), Error: ${JSON.stringify(error)}`);
        this.debugErrorLog(`Lock: ${this.accessory.displayName} failed lockStatus (refreshStatus), Error Message: ${JSON.stringify(error.message)}`);
      }
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.info(String(...log));
    }
  }

  successLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.success(String(...log));
    }
  }

  debugSuccessLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.success('[DEBUG]', String(...log));
      }
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      } else {
        this.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}