/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-august.
 */
import type { AugustPlatform } from '../platform.js';
import type { device, devicesConfig, AugustPlatformConfig } from '../settings.js';
import type { API, HAP, Logging, PlatformAccessory, CharacteristicValue, Service } from 'homebridge';

export abstract class deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: AugustPlatformConfig;
  protected readonly hap: HAP;

  // Service
  FirmwareUpdate!: {
    Name: string;
    Service: Service;
    FirmwareUpdateReadiness: CharacteristicValue;
    FirmwareUpdateStatus: CharacteristicValue;
  };

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

  async getDeviceRateSettings(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
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
    // refreshRate
    if (device.refreshRate) {
      this.deviceRefreshRate = device.refreshRate;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.config.options?.refreshRate) {
      this.deviceRefreshRate = this.config.options.refreshRate;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    } else {
      this.deviceRefreshRate = 5;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Default refreshRate: ${this.deviceRefreshRate}`);
    }
    accessory.context.deviceRefreshRate = this.deviceRefreshRate;
    // updateRate
    if (device.updateRate) {
      this.deviceUpdateRate = device.updateRate;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Device Config updateRate: ${this.deviceUpdateRate}`);
    } else if (this.config.options?.updateRate) {
      this.deviceUpdateRate = this.config.options.updateRate;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Platform Config updateRate: ${this.deviceUpdateRate}`);
    } else {
      this.deviceUpdateRate = 5;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Default updateRate: ${this.deviceUpdateRate}`);
    }
    accessory.context.deviceUpdateRate = this.deviceUpdateRate;
    // pushRate
    if (device.pushRate) {
      this.devicePushRate = device.pushRate;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Device Config pushRate: ${this.deviceUpdateRate}`);
    } else if (this.config.options?.pushRate) {
      this.devicePushRate = this.config.options.pushRate;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Platform Config pushRate: ${this.deviceUpdateRate}`);
    } else {
      this.devicePushRate = 1;
      this.debugLog(`${device.Type}: ${accessory.displayName} Using Default pushRate: ${this.deviceUpdateRate}`);
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
      this.infoLog(`Lock: ${accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }

  async getDeviceContext(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    // Firmware Version
    let deviceFirmwareVersion: string;
    if (device.firmware) {
      deviceFirmwareVersion = device.firmware;
      this.debugSuccessLog(`${device.Type}: ${accessory.displayName} 1 FirmwareRevision: ${device.firmware}`);
    } else if (device.currentFirmwareVersion) {
      deviceFirmwareVersion = device.currentFirmwareVersion;
      this.debugSuccessLog(`${device.Type}: ${accessory.displayName} 2 FirmwareRevision: ${device.currentFirmwareVersion}`);
    } else if (accessory.context.deviceVersion) {
      deviceFirmwareVersion = accessory.context.deviceVersion;
      this.debugSuccessLog(`${device.Type}: ${accessory.displayName} 3 FirmwareRevision: ${accessory.context.deviceVersion}`);
    } else {
      deviceFirmwareVersion = this.platform.version ?? '0.0.0';
      if (this.platform.version) {
        this.debugSuccessLog(`${device.Type}: ${accessory.displayName} 4 FirmwareRevision: ${this.platform.version}`);
      } else {
        this.debugSuccessLog(`${device.Type}: ${accessory.displayName} 5 FirmwareRevision: ${deviceFirmwareVersion}`);
      }
    }
    const version = deviceFirmwareVersion.toString();
    this.debugLog(`${this.device.Type}: ${accessory.displayName} Firmware Version: ${version?.replace(/^V|-.*$/g, '')}`);
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
    this.debugSuccessLog(`${device.Type}: ${accessory.displayName} deviceVersion: ${accessory.context.deviceVersion}`);

    // Initialize FirmwareUpdate Service
    accessory.context.FirmwareUpdate = accessory.context.FirmwareUpdate ?? {};
    this.FirmwareUpdate = {
      Name: accessory.context.Battery.Name ?? `${accessory.displayName} Firmware Update`,
      Service: accessory.getService(this.hap.Service.Battery) ?? accessory.addService(this.hap.Service.Battery) as Service,
      FirmwareUpdateStatus: accessory.context.FirmwareUpdateStatus ?? 0,
      FirmwareUpdateReadiness: accessory.context.FirmwareUpdateReadiness ?? 0,
    };
    accessory.context.FirmwareUpdate = this.FirmwareUpdate as object;
    // Initialize FirmwareUpdate Characteristics
    this.FirmwareUpdate.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.FirmwareUpdate.Name)
      .setCharacteristic(this.hap.Characteristic.FirmwareUpdateStatus, true)
      .setCharacteristic(this.hap.Characteristic.FirmwareUpdateReadiness, true)
      .getCharacteristic(this.hap.Characteristic.FirmwareUpdateReadiness)
      .onGet(() => {
        return this.FirmwareUpdate.FirmwareUpdateReadiness;
      });
  }

  async statusCode(accessory: PlatformAccessory, device: device & devicesConfig, error: { message: string; }): Promise<void> {
    if (!device.hide_device) {
      const statusCodeString = JSON.stringify(error); // Convert statusCode to a string
      if (statusCodeString.includes('100')) {
        this.debugLog(`Lock: ${accessory.displayName} Command successfully sent, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('200')) {
        this.debugLog(`Lock: ${accessory.displayName} Request successful, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('400')) {
        this.errorLog(`Lock: ${accessory.displayName} Bad Request, statusCode: ${statusCodeString}`);
      } else if (statusCodeString.includes('429')) {
        this.errorLog(`Lock: ${accessory.displayName} Too Many Requests, exceeded the number of `
          + `requests allowed for a given time window, statusCode: ${statusCodeString}`);
      } else {
        this.debugLog(`Lock: ${accessory.displayName} Unknown statusCode: ${statusCodeString}, Submit Bugs Here: '
      + 'https://tinyurl.com/AugustYaleBug`);
        this.debugErrorLog(`Lock: ${accessory.displayName} failed lockStatus (refreshStatus), Error: ${JSON.stringify(error)}`);
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