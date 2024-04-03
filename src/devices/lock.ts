/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * lock.ts: homebridge-august.
 */
import { API, CharacteristicValue, HAP, Logging, PlatformAccessory, Service } from 'homebridge';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators';
import { deviceBase } from './device.js';
import { AugustPlatform } from '../platform.js';
import { AugustPlatformConfig, device, devicesConfig } from '../settings.js';
import August from 'august-yale';
/*import August from '/Users/Shared/GitHub/donavanbecker/august-yale/dist/index.js';*/

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockMechanism extends deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: AugustPlatformConfig;
  protected readonly hap: HAP;
  // Services
  lockService?: Service;
  contactSensorService?: Service;
  batteryService!: Service;


  // CharacteristicValue
  LockTargetState!: CharacteristicValue;
  LockCurrentState!: CharacteristicValue;
  BatteryLevel!: CharacteristicValue;
  StatusLowBattery!: CharacteristicValue;
  ContactSensorState!: CharacteristicValue;

  // Lock Status
  retryCount?: any;
  state: any;
  locked!: boolean;
  unlocked!: boolean;
  open?: boolean;
  closed?: boolean;

  // Lock Details
  battery: any;
  doorState?: any;
  currentFirmwareVersion: any;

  // Config
  deviceLogging!: string;
  deviceRefreshRate!: number;
  hide_lock!: boolean;

  // Lock Updates
  lockUpdateInProgress: boolean;
  doLockUpdate: any;

  constructor(
    private readonly platform: AugustPlatform,
    private readonly accessory: PlatformAccessory,
    public device: device & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;
    this.deviceLogs(device);
    this.getDeviceRefreshRate(device);
    this.lock(device);
    this.deviceConfigOptions(device);
    this.cacheState();

    // default placeholders
    // this is subject we use to track when we need to POST changes to the August API
    this.doLockUpdate = new Subject();
    this.lockUpdateInProgress = false;

    // Initial Device Parse
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'August Home Inc.')
      .setCharacteristic(this.hap.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, accessory.context.serialnumber)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.currentFirmwareVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(accessory.context.currentFirmwareVersion);

    // Lock Mechanism Service
    if (this.hide_lock) {
      this.warnLog(`Lock: ${accessory.displayName} Removing Lock Mechanism Service`);
      this.lockService = this.accessory.getService(this.hap.Service.LockMechanism);
      accessory.removeService(this.lockService!);
    } else if (!this.lockService) {
      this.debugLog(`Lock: ${accessory.displayName} Add Lock Mechanism Service`);
      (this.lockService =
        this.accessory.getService(this.hap.Service.LockMechanism)
        || this.accessory.addService(this.hap.Service.LockMechanism)), accessory.displayName;
      // Service Name
      this.lockService.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);
      //Required Characteristics" see https://developers.homebridge.io/#/service/LockMechanism

      // Create handlers for required characteristics
      this.lockService.getCharacteristic(this.hap.Characteristic.LockTargetState).onSet(this.setLockTargetState.bind(this));
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Lock Mechanism Service Not Added`);
    }
    // Contact Sensor Service
    if (device.lock?.hide_contactsensor) {
      this.warnLog(`Lock: ${accessory.displayName} Removing Contact Sensor Service`);
      this.contactSensorService = this.accessory.getService(this.hap.Service.ContactSensor);
      accessory.removeService(this.contactSensorService!);
    } else if (!this.contactSensorService) {
      this.debugLog(`Lock: ${accessory.displayName} Add Contact Sensor Service`);
      (this.contactSensorService =
        this.accessory.getService(this.hap.Service.ContactSensor)
        || this.accessory.addService(this.hap.Service.ContactSensor)), `${accessory.displayName} Contact Sensor`;

      // Service Name
      this.contactSensorService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Contact Sensor`);
      //Required Characteristics" see https://developers.homebridge.io/#/service/ContactSensor
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Contact Sensor Service Not Added`);
    }

    // Battery Service
    (this.batteryService =
      this.accessory.getService(this.hap.Service.Battery)
      || this.accessory.addService(this.hap.Service.Battery)), `${accessory.displayName} Battery`;

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Subscribe to august changes
    this.subscribeAugust();

    // Start an update interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.lockUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });

    // Watch for Lock change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doLockUpdate
      .pipe(
        tap(() => {
          this.lockUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          if (!this.hide_lock) {
            await this.pushChanges();
          }
        } catch (e: any) {
          this.errorLog(`doLockUpdate pushChanges: ${e}`);
        }
        // Refresh the status from the API
        interval(this.deviceRefreshRate * 500)
          .pipe(skipWhile(() => this.lockUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
        this.lockUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the August api
   */
  async parseStatus(): Promise<void> {
    this.debugLog(`Lock: ${this.accessory.displayName} parseStatus`);

    // Lock Mechanism
    if (!this.hide_lock) {
      if (this.locked) {
        this.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
      } else if (this.unlocked) {
        this.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
      } else if (this.retryCount > 1) {
        this.LockCurrentState = this.hap.Characteristic.LockCurrentState.JAMMED;
      } else {
        this.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNKNOWN;
        this.refreshStatus();
      }
    }
    // Battery
    this.BatteryLevel = Number(this.battery);
    this.batteryService.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.BatteryLevel);
    if (this.BatteryLevel < 15) {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    this.debugLog(`Lock: ${this.accessory.displayName} BatteryLevel: ${this.BatteryLevel},` + ` StatusLowBattery: ${this.StatusLowBattery}`);
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.open) {
        this.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
      } else if (this.closed) {
        this.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
      } else if (this.doorState === 'open') {
        this.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
      } else if (this.doorState === 'closed') {
        this.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
      } else {
        this.errorLog(`Lock: ${this.accessory.displayName} doorState: ${this.doorState}, closed: ${this.closed}, open: ${this.open}`);
      }
    }
    // Update Firmware
    if (this.currentFirmwareVersion !== this.accessory.context.currentFirmwareVersion) {
      this.warnLog(`Lock: ${this.accessory.displayName} Firmware Version changed to Current Firmware Version: ${this.currentFirmwareVersion}`);
      this.accessory
        .getService(this.hap.Service.AccessoryInformation)!
        .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.currentFirmwareVersion)
        .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
        .updateValue(this.currentFirmwareVersion);
    }
  }

  /**
   * Asks the August Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      //await this.platform.augustCredentials();
      // Update Lock Details
      const lockDetails: any = await this.platform.augustConfig.details(this.device.lockId);
      if (lockDetails) {
        this.debugLog(`Lock: ${this.accessory.displayName} lockDetails (refreshStatus): ${JSON.stringify(lockDetails)}`);

        // Get Lock Status (use August-api helper function to resolve state)
        const lockStatus = lockDetails.LockStatus;
        this.platform.augustConfig.addSimpleProps(lockStatus);
        if (lockStatus.state && !this.hide_lock) {
          this.unlocked = lockStatus.state.unlocked;
          this.state = lockStatus.state;
          this.locked = lockStatus.state.locked;
        }

        // TODO: Handle lock jammed
        this.retryCount = 1;

        // Get Battery level
        this.battery = (Number(lockDetails.battery) * 100).toFixed();
        this.debugLog(`Lock: ${this.accessory.displayName} battery (lockDetails): ${this.battery}`);

        // Get Firmware
        this.currentFirmwareVersion = lockDetails.currentFirmwareVersion;
        this.debugLog(`Lock: ${this.accessory.displayName} currentFirmwareVersion (lockDetails): ${this.currentFirmwareVersion}`);

        // Get door state if available
        if (!this.device.lock?.hide_contactsensor) {
          this.doorState = lockDetails.LockStatus.doorState;
          this.open = lockStatus.state.open;
          this.closed = lockStatus.state.closed;
        }
      } else {
        this.debugErrorLog(`Lock: ${this.accessory.displayName} lockDetails (refreshStatus): ${JSON.stringify(lockDetails)}`);
      }
      // Update HomeKit
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.errorLog(`refreshStatus: ${e}`);
      this.errorLog(`Lock: ${this.accessory.displayName} failed lockStatus (refreshStatus), Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  /**
   * Pushes the requested changes to the August API
   */
  async pushChanges(): Promise<void> {
    try {
      await this.platform.augustCredentials();
      if (this.LockTargetState === this.hap.Characteristic.LockTargetState.UNSECURED) {
        this.debugWarnLog(`Lock: ${this.accessory.displayName} Sending request to August API: Unlock (${this.LockTargetState})`);
        const lockStatus = await this.platform.augustConfig.unlock(this.device.lockId);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-unlock) lockStatus: ${JSON.stringify(lockStatus)}`);
      } else if (this.LockTargetState === this.hap.Characteristic.LockTargetState.SECURED) {
        this.debugWarnLog(`Lock: ${this.accessory.displayName} Sending request to August API: Lock (${this.LockTargetState})`);
        const lockStatus = await this.platform.augustConfig.lock(this.device.lockId);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-lock) lockStatus: ${JSON.stringify(lockStatus)}`);
      } else {
        this.errorLog(`Lock: ${this.accessory.displayName} lockStatus (pushChanges) failed, this.LockTargetState: ${this.LockTargetState}`);
      }
    } catch (e: any) {
      this.errorLog(`pushChanges: ${e}`);
      this.errorLog(`Lock: ${this.accessory.displayName} failed pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    // Lock Mechanism
    if (!this.hide_lock) {
      if (this.LockTargetState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} LockTargetState: ${this.LockTargetState}`);
      } else {
        this.accessory.context.LockCurrentState = this.LockTargetState;
        this.lockService?.updateCharacteristic(this.hap.Characteristic.LockTargetState, this.LockTargetState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockTargetState: ${this.LockTargetState}`);
      }
      if (this.LockCurrentState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} LockCurrentState: ${this.LockCurrentState}`);
      } else {
        this.accessory.context.LockCurrentState = this.LockCurrentState;
        this.lockService?.updateCharacteristic(this.hap.Characteristic.LockCurrentState, this.LockCurrentState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockCurrentState: ${this.LockCurrentState}`);
      }
    }
    // Battery
    if (this.BatteryLevel === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} BatteryLevel: ${this.BatteryLevel}`);
    } else {
      this.accessory.context.BatteryLevel = this.BatteryLevel;
      this.batteryService.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.BatteryLevel);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic BatteryLevel: ${this.BatteryLevel}`);
    }
    if (this.StatusLowBattery === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} StatusLowBattery: ${this.StatusLowBattery}`);
    } else {
      this.accessory.context.StatusLowBattery = this.StatusLowBattery;
      this.batteryService.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.StatusLowBattery);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.StatusLowBattery}`);
    }
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.ContactSensorState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
      } else {
        this.accessory.context.ContactSensorState = this.ContactSensorState;
        this.contactSensorService?.updateCharacteristic(this.hap.Characteristic.ContactSensorState, this.ContactSensorState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic ContactSensorState: ${this.ContactSensorState}`);
      }
    }
  }

  async setLockTargetState(value: CharacteristicValue): Promise<void> {
    this.debugLog(`Lock: ${this.accessory.displayName} Set LockTargetState: ${value}`);
    this.LockTargetState = value;
    this.accessory.context.LockTargetState = this.LockTargetState;
    this.doLockUpdate.next();
    if (this.LockCurrentState === this.hap.Characteristic.LockCurrentState.UNSECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
    }
    if (this.LockCurrentState === this.hap.Characteristic.LockCurrentState.SECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Locked`);
    }
  }

  async subscribeAugust(): Promise<void> {
    await this.platform.augustCredentials();
    await August.subscribe(this.config.credentials!, this.device.lockId, (AugustEvent: any, timestamp: any) => {
      this.debugLog(`Lock: ${this.accessory.displayName} AugustEvent: ${JSON.stringify(AugustEvent)}, ${JSON.stringify(timestamp)}`);
      //LockCurrentState
      if (!this.hide_lock) {
        if (AugustEvent.state.unlocked) {
          this.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          this.LockTargetState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          if (this.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
          }
        } else if (AugustEvent.state.locked) {
          this.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
          this.LockTargetState = this.hap.Characteristic.LockCurrentState.SECURED;
          if (this.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Locked`);
          }
        } else {
          this.refreshStatus();
        }
      }
      // Contact Sensor
      if (!this.device.lock?.hide_contactsensor) {
        if (AugustEvent.state.open) {
          this.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
          this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
          if (this.ContactSensorState !== this.accessory.context.ContactSensorState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Opened`);
          }
        } else if (AugustEvent.state.closed) {
          this.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
          this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
          if (this.ContactSensorState !== this.accessory.context.ContactSensorState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Closed`);
          }
        } else {
          this.refreshStatus();
        }
      }
      // Update HomeKit
      this.updateHomeKitCharacteristics();
    });
  }


  async cacheState() {
    if (!this.hide_lock) {
      if (this.LockCurrentState === undefined) {
        this.LockCurrentState = this.accessory.context.LockCurrentState | this.hap.Characteristic.LockCurrentState.SECURED;
      }
      if (this.LockTargetState === undefined) {
        this.LockTargetState = this.accessory.context.LockTargetState | this.hap.Characteristic.LockTargetState.SECURED;
      }
    }
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.ContactSensorState === undefined) {
        this.ContactSensorState = this.accessory.context.ContactSensorState | this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      }
    }
    if (this.BatteryLevel === undefined) {
      this.BatteryLevel = this.accessory.context.BatteryLevel || 100;
    }
    if (this.StatusLowBattery === undefined) {
      if (Number(this.BatteryLevel) < 15) {
        this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      } else {
        this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      }
    }
  }

  async lock(device: device & devicesConfig): Promise<void> {
    if (device.lock) {
      if (device.lock?.hide_lock) {
        this.hide_lock = device.lock.hide_lock!;
      } else {
        this.hide_lock = false;
      }
    } else {
      this.hide_lock = false;
    }
  }

  async deviceConfigOptions(device: device & devicesConfig): Promise<void> {
    let config = {};
    if (device.lock) {
      config = device.lock || '';
    }
    if (device.logging !== undefined) {
      config['logging'] = device.logging;
    }
    if (device.refreshRate !== undefined) {
      config['refreshRate'] = device.refreshRate;
    }
    if (device.lock?.hide_lock !== undefined) {
      config['hide_lock'] = this.hide_lock;
    }
    if (Object.entries(config).length !== 0) {
      this.infoLog(`Lock: ${this.accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }

  async getDeviceRefreshRate(device: device & devicesConfig): Promise<void> {
    if (device.refreshRate) {
      if (device.refreshRate < 1800) {
        device.refreshRate = 1800;
        this.warnLog('Refresh Rate cannot be set to lower the 5 mins, as Lock detail (battery level, etc) are unlikely to change within that period');
      }
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.platform.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.platform.config.options!.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  async deviceLogs(device: device & devicesConfig): Promise<void> {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.info(String(...log));
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}
