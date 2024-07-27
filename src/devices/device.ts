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
      .setCharacteristic(this.hap.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.Model, device.skuNumber)
      .setCharacteristic(this.hap.Characteristic.ProductData, device.lockId)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.SerialNumber);
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
    const deviceConfig = {
      ...(device.logging && device.logging !== 'standard' && { logging: device.logging }),
      ...(device.refreshRate !== undefined && { refreshRate: device.refreshRate }),
      ...(device.overrideHomeKitEnabled === true && { overrideHomeKitEnabled: device.overrideHomeKitEnabled }),
      ...(device.updateRate !== undefined && { updateRate: device.updateRate }),
      ...(device.pushRate !== undefined && { pushRate: device.pushRate }),
      ...(device.lock?.hide_contactsensor === true && { hide_contactsensor: device.lock.hide_contactsensor }),
      ...(device.lock?.hide_lock === true && { hide_lock: device.lock.hide_lock }),
    };

    if (Object.keys(deviceConfig).length) {
      await this.debugSuccessLog(`Config: ${JSON.stringify(deviceConfig)}`);
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
   * Updates the value of a HomeKit characteristic and logs the change.
   *
   * This function updates the specified characteristic of a given service with a new value.
   * It also logs the updated value and the context before and after the update for debugging purposes.
   *
   * @param Service - The HomeKit service that contains the characteristic to be updated.
   * @param Characteristic - The specific characteristic to be updated.
   * @param CharacteristicValue - The new value to set for the characteristic. If undefined, the function logs the value and returns without updating.
   * @param CharacteristicName - The name of the characteristic being updated, used for logging purposes.
   * @return void
   */
  async updateCharacteristic(
    Service: Service,
    Characteristic: any,
    CharacteristicValue: CharacteristicValue,
    CharacteristicName: string,
  ): Promise<void> {
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

  /**
   * Logs the status update of a characteristic.
   *
   * This function compares the current characteristic value with its context value.
   * If they are the same, it logs that there are no changes. If they are different,
   * it logs the previous status based on the provided value and status strings.
   *
   * @param CharacteristicValue - The current value of the characteristic.
   * @param CharacteristicValueContext - The stored context value of the characteristic.
   * @param Value - The value to compare against to determine the status.
   * @param CharacteristicName - The name of the characteristic being logged.
   * @param Status1 - The status message to log if the characteristic value matches the provided value.
   * @param Status2 - The status message to log if the characteristic value does not match the provided value.
   * @return void
   */
  async logStatusUpdate(
    CharacteristicValue: CharacteristicValue,
    CharacteristicValueContext: CharacteristicValue,
    Value: CharacteristicValue,
    CharacteristicName: string,
    Status1: string,
    Status2: string,
  ): Promise<void> {
    if (CharacteristicValue === CharacteristicValueContext) {
      await this.debugLog(`No Changes, ${CharacteristicName}: ${CharacteristicValue} ${CharacteristicName}Context: ${CharacteristicValueContext}`);
    } else {
      await this.debugLog(`was ${CharacteristicValue === Value ? Status1 : Status2}`);
    }
  }

  async statusCode(device: device & devicesConfig, action: string, error: { message: string; }): Promise<void> {
    const statusCodeString = error.message; // Convert statusCode to a string
    const logMap = {
      '100': `Command successfully sent, statusCode: ${statusCodeString}`,
      '200': `Request successful, statusCode: ${statusCodeString}`,
      '400': `Bad Request, statusCode: ${statusCodeString}`,
      '429': `Too Many Requests, exceeded the number of requests allowed for a given time window, statusCode: ${statusCodeString}`,
    };
    const logMessage = logMap[statusCodeString.slice(0, 3)]
      ?? `Unknown statusCode: ${statusCodeString}, Submit Bugs Here: https://tinyurl.com/AugustYaleBug`;
    await this.debugLog(logMessage);
    if (!logMap[statusCodeString.slice(0, 3)]) {
      await this.debugErrorLog(`failed ${action}, Error: ${error}`);
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
      if (await this.loggingIsDebug()) {
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
      if (await this.loggingIsDebug()) {
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
      if (await this.loggingIsDebug()) {
        this.log.error(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info(`[DEBUG] Lock: ${this.accessory.displayName}`, String(...log));
      } else if (this.deviceLogging === 'debugMode') {
        this.log.debug(`Lock: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async loggingIsDebug(): Promise<boolean> {
    return this.deviceLogging === 'debugMode' || this.deviceLogging === 'debug';
  }

  async enablingDeviceLogging(): Promise<boolean> {
    return this.deviceLogging === 'debugMode' || this.deviceLogging === 'debug' || this.deviceLogging === 'standard';
  }
}