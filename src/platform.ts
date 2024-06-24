
/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: homebridge-august.
 */
import August from 'august-yale';
import { readFileSync, writeFileSync } from 'fs';
import { LockMechanism } from './devices/lock.js';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings.js';

import type { AugustPlatformConfig, credentials, device, devicesConfig, options } from './settings.js';
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class AugustPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory[];
  public readonly api: API;
  public readonly log: Logging;
  public config!: AugustPlatformConfig;

  platformConfig!: AugustPlatformConfig['options'];
  platformLogging!: options['logging'];
  platformRefreshRate!: options['refreshRate'];
  platformPushRate!: options['pushRate'];
  platformUpdateRate!: options['updateRate'];
  registeringDevice!: boolean;
  debugMode!: boolean;
  version!: string;

  // August API
  augustConfig!: August;

  constructor(
    log: Logging,
    config: AugustPlatformConfig,
    api: API,
  ) {
    // Initialize
    this.accessories = [];
    this.api = api;
    this.log = log;

    // only load if configured
    if (!config) {
      return;
    }

    // Plugin options into our config variables.
    this.config = {
      platform: 'August',
      name: config.name,
      credentials: config.credentials as credentials,
      options: config.options as object,
    };

    // Plugin Configuration
    this.getPlatformLogSettings();
    this.getPlatformRateSettings();
    this.getPlatformConfigSettings();
    this.getVersion();

    // Finish initializing the plugin
    this.debugLog(`Finished initializing platform: ${config.name}`);

    // verify the config
    (async () => {
      try {
        this.verifyConfig();
        this.debugLog('Config OK');
      } catch (e: any) {
        await this.errorLog(`Verify Config, Error Message: ${e.message}, Submit Bugs Here: https://bit.ly/august-bug-report`);
        await this.debugErrorLog(`Verify Config, Error: ${e}`);
        return;
      }
    })();

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      await this.debugLog('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories

      if (this.config.credentials?.isValidated === false || this.config.credentials?.isValidated === undefined) {
        await this.debugWarnLog(`Config Credentials: ${JSON.stringify(this.config.credentials)}`);
        try {
          await this.validated();
        } catch (e: any) {
          this.errorLog(`Validate: ${e}`);
        }
      } else {
        await this.debugWarnLog(`Config Credentials: ${JSON.stringify(this.config.credentials)}`);
        try {
          await this.discoverDevices();
        } catch (e: any) {
          await this.errorLog(`Validated, Discover Devices: ${e}`);
        }
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  async configureAccessory(accessory: PlatformAccessory): Promise<void> {
    await this.debugLog(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    if (!this.config.credentials) {
      throw 'Missing Credentials';
    } else {
      if (!this.config.credentials.augustId) {
        throw 'Missing August ID (E-mail/Phone Number';
      }
      if (!this.config.credentials.password) {
        throw 'Missing August Password';
      }
    }
  }

  /**
   * This method looks to see if session is already Validate, if not then sends a validateCode and saves the installId.
   * After validateCode is saved to the config user must restart homebridge
   * this process then looks to see if session is already validated and if the validateCode in config;
   * if isValidated is false then it will validate iwth the validateCode and save isValidated as true in the config.json file
   * will also make the validateCode undefined
   * @param this.config.credentials.installId
   * @param this.config.credentials.isValidated
   * @param this.config.credentials.validateCode
   */
  async validated() {
    if (!this.config.credentials?.installId) {
      this.config.credentials!.installId = this.api.hap.uuid.generate(`${this.config.credentials?.augustId}`);
    }
    await this.augustCredentials();
    if (!this.config.credentials?.isValidated && this.config.credentials?.validateCode) {
      const validateCode = this.config.credentials?.validateCode;
      const isValidated = await August.validate(this.config.credentials!, validateCode);
      // If validated successfully, set flag for future use, and you can now use the API
      this.config.credentials.isValidated = isValidated;
      // load in the current config
      const { pluginConfig, currentConfig } = await this.pluginConfig();

      pluginConfig.credentials.isValidated = this.config.credentials?.isValidated;
      if (this.config.credentials.isValidated) {
        pluginConfig.credentials.validateCode = undefined;
      }

      await this.debugWarnLog(`isValidated: ${pluginConfig.credentials.isValidated}`);
      await this.debugWarnLog(`validateCode: ${pluginConfig.credentials.validateCode}`);

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));
      if (!isValidated) {
        return;
      } else {
        try {
          await this.discoverDevices();
          await this.debugWarnLog(`isValidated: ${this.config.credentials?.isValidated}`);
        } catch (e: any) {
          await this.errorLog(`Validate, Discover Devices: ${e}`);
        }
      }
    } else {
      // load in the current config
      const { pluginConfig, currentConfig } = await this.pluginConfig();
      // set the refresh token
      pluginConfig.credentials.installId = this.config.credentials?.installId;

      await this.debugWarnLog(`installId: ${pluginConfig.credentials.installId}`);
      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));

      // A 6-digit code will be sent to your email or phone (depending on what you used for your augustId).
      // Need some way to get this code from the user.
      August.authorize(this.config.credentials!);
      await this.warnLog('Input Your August email verification code into the validateCode config and restart Homebridge.');
    }
  }

  async augustCredentials() {
    if (!this.config.credentials) {
      throw 'Missing Credentials';
    } else {
      this.augustConfig = new August(this.config.credentials);
      await this.debugLog(`August Credentials: ${JSON.stringify(this.augustConfig)}`);
    }
  }

  async pluginConfig() {
    const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));
    // check the platforms section is an array before we do array things on it
    if (!Array.isArray(currentConfig.platforms)) {
      throw new Error('Cannot find platforms array in config');
    }
    // find this plugins current config
    const pluginConfig = currentConfig.platforms.find((x: { platform: string; }) => x.platform === PLATFORM_NAME);
    if (!pluginConfig) {
      throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
    }
    // check the .credentials is an object before doing object things with it
    if (typeof pluginConfig.credentials !== 'object') {
      throw new Error('pluginConfig.credentials is not an object');
    }
    return { pluginConfig, currentConfig };
  }

  /**
   * This method is used to discover the your location and devices.
   */
  async discoverDevices() {
    // August Locks
    const devices = await August.details(this.config.credentials!, '');
    let deviceLists: any[];
    if (devices.length > 1) {
      deviceLists = devices;
      await this.infoLog(`Total August Locks Found: ${deviceLists.length}`);
    } else {
      deviceLists = [devices];
      await this.infoLog(`Total August Locks Found: ${deviceLists.length}`);
    }
    if (!this.config.options?.devices) {
      await this.debugWarnLog(`August Platform Config Not Set: ${JSON.stringify(this.config.options?.devices)}`);
      const devices = deviceLists.map((v: any) => v);
      for (const device of devices) {
        if (device.configDeviceName) {
          device.deviceName = device.configDeviceName;
        }
        await this.debugLog(`August Devices: ${JSON.stringify(device)}`);
        await this.Lock(device);
      }
    } else if (this.config.options.devices) {
      await this.debugWarnLog(`August Platform Config Set: ${JSON.stringify(this.config.options?.devices)}`);
      const deviceConfigs = this.config.options?.devices;

      const mergeBylockId = (a1: { lockId: string }[], a2: any[]) =>
        a1.map((itm: { lockId: string }) => ({
          ...a2.find(
            (item: { lockId: string }) =>
              item.lockId.toUpperCase().replace(/[^A-Z0-9]+/g, '') === itm.lockId.toUpperCase().replace(/[^A-Z0-9]+/g, '') && item,
          ),
          ...itm,
        }));
      const devices = mergeBylockId(deviceLists, deviceConfigs);
      await this.debugLog(`August Lock(s): ${JSON.stringify(devices)}`);
      for (const device of devices) {
        if (device.configDeviceName) {
          device.deviceName = device.configDeviceName;
        }
        await this.debugLog(`device: ${JSON.stringify(device)}`);
        await this.Lock(device);
      }
    } else {
      await this.errorLog('August ID & Password Supplied, Issue with Auth.');
    }
  }

  private async Lock(device: device & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(device.lockId);
    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {

      // the accessory already exists
      if (await this.registerDevice(device)) {
        await this.infoLog(`Restoring existing accessory from cache: ${device.LockName}, Lock ID: ${device.lockId}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        existingAccessory.displayName = device.LockName;
        existingAccessory.context.currentFirmwareVersion = device.currentFirmwareVersion;
        existingAccessory.context.model = device.skuNumber;
        existingAccessory.context.serialnumber = device.SerialNumber;
        existingAccessory.context.lockId = device.lockId;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new LockMechanism(this, existingAccessory, device);
        await this.debugLog(`Lock: ${device.LockName} (${device.lockId}) uuid: ${existingAccessory.UUID}`);
      } else {
        await this.unregisterPlatformAccessories(existingAccessory, device);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        await this.infoLog(`Adding new accessory: ${device.LockName}, Lock ID: ${device.lockId}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.LockName, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.displayName = device.LockName;
      accessory.context.currentFirmwareVersion = device.currentFirmwareVersion;
      accessory.context.model = device.skuNumber;
      accessory.context.serialnumber = device.SerialNumber;
      accessory.context.lockId = device.lockId;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new LockMechanism(this, accessory, device);
      await this.debugLog(`Lock: ${device.LockName} (${device.lockId}) uuid:  ${accessory.UUID}`);

      // link the accessory to your platform
      await this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      await this.debugErrorLog(`Unable to Register: ${device.LockName}, Lock ID: ${device.lockId} Check Config to see if is being Hidden.`);
    }
  }

  async registerDevice(device: device & devicesConfig) {
    if (!device.hide_device && !device.homeKitEnabled) {
      this.registeringDevice = true;
      await this.debugLog(`Device: ${device.LockName} Enabled`);
    } else if (device.homeKitEnabled && device.overrideHomeKitEnabled) {
      this.registeringDevice = true;
      await this.debugWarnLog(`Device: ${device.LockName} HomeKit Enabled: ${device.homeKitEnabled}, `
        + `Override HomeKit Enabled: ${device.overrideHomeKitEnabled}`);
    } else if (device.homeKitEnabled && !device.overrideHomeKitEnabled) {
      this.registeringDevice = false;
      this.debugErrorLog(`Device: ${device.LockName} HomeKit Enabled: `
        + `${device.homeKitEnabled}, device will not be registered. To enable, set overrideHomeKitEnabled to true.`);
    } else {
      this.registeringDevice = false;
      await this.debugLog(`Device: ${device.LockName} is Hidden.`);
    }
    return this.registeringDevice;
  }

  public async externalOrPlatform(device: device & devicesConfig, accessory: PlatformAccessory) {
    if (device.external) {
      await this.infoLog(`${accessory.displayName} External Accessory Mode: ${device.external}`);
      await this.externalAccessory(accessory);
    } else {
      await this.debugLog(`${accessory.displayName} External Accessory Mode: ${device.external}`);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  public async externalAccessory(accessory: PlatformAccessory) {
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  public async unregisterPlatformAccessories(existingAccessory: PlatformAccessory, device: device & devicesConfig) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    await this.warnLog(`Removing existing accessory from cache: ${device.LockName}`);
  }

  async getVersion() {
    const json = JSON.parse(
      readFileSync(
        new URL('../package.json', import.meta.url),
        'utf-8',
      ),
    );
    await this.debugLog(`Plugin Version: ${json.version}`);
    this.version = json.version;
  }

  async getPlatformConfigSettings() {
    if (this.config.options) {
      const platformConfig: AugustPlatformConfig['options'] = {};
      platformConfig.logging = this.config.options.logging ? this.config.options.logging : undefined;
      platformConfig.refreshRate = this.config.options.refreshRate ? this.config.options.refreshRate : undefined;
      platformConfig.updateRate = this.config.options.updateRate ? this.config.options.updateRate : undefined;
      platformConfig.pushRate = this.config.options.pushRate ? this.config.options.pushRate : undefined;
      if (Object.entries(platformConfig).length !== 0) {
        await this.debugLog(`Platform Config: ${JSON.stringify(platformConfig)}`);
      }
      this.platformConfig = platformConfig;
    }
  }

  async getPlatformRateSettings() {
    this.platformRefreshRate = this.config.options?.refreshRate ? this.config.options.refreshRate : 0;
    const refreshRate = this.config.options?.refreshRate ? 'Using Platform Config refreshRate' : 'refreshRate Disabled by Default';
    await this.debugLog(`${refreshRate}: ${this.platformRefreshRate}`);
    this.platformUpdateRate = this.config.options?.updateRate ? this.config.options.updateRate : 1;
    const updateRate = this.config.options?.updateRate ? 'Using Platform Config updateRate' : 'Using Default updateRate';
    await this.debugLog(`${updateRate}: ${this.platformUpdateRate}`);
    this.platformPushRate = this.config.options?.pushRate ? this.config.options.pushRate : 1;
    const pushRate = this.config.options?.pushRate ? 'Using Platform Config pushRate' : 'Using Default pushRate';
    await this.debugLog(`${pushRate}: ${this.platformPushRate}`);
  }

  async getPlatformLogSettings() {
    this.debugMode = process.argv.includes('-D') ?? process.argv.includes('--debug');
    this.platformLogging = this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard'
    || this.config.options?.logging === 'none' ? this.config.options.logging : this.debugMode ? 'debugMode' : 'standard';
    const logging = this.config.options?.logging ? 'Platform Config' : this.debugMode ? 'debugMode' : 'Default';
    await this.debugLog(`Using ${logging} Logging: ${this.platformLogging}`);
  }

  /**
    * If device level logging is turned on, log to log.warn
    * Otherwise send debug logs to log.debug
    */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.info(String(...log));
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.success(String(...log));
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.success('[DEBUG]', String(...log));
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.warn(String(...log));
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.error(String(...log));
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log));
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      }
    }
  }

  async enablingPlatformLogging(): Promise<boolean> {
    return this.platformLogging?.includes('debug') || this.platformLogging === 'standard';
  }
}