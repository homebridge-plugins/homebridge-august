/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * lock.ts: homebridge-august.
 */
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators';
import { deviceBase } from './device.js';
import August from 'august-yale';

import type { AugustPlatform } from '../platform.js';
import type { device, lockDetails, devicesConfig } from '../settings.js';
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockMechanism extends deviceBase {
  // Service
  private LockMechanism?: {
    Service?: Service;
    LockTargetState?: CharacteristicValue;
    LockCurrentState?: CharacteristicValue;
  };

  private ContactSensor?: {
    Service?: Service;
    ContactSensorState?: CharacteristicValue;
  };

  private Battery!: {
    Service?: Service;
    BatteryLevel: CharacteristicValue;
    StatusLowBattery: CharacteristicValue;
  };

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

  // Lock Updates
  lockUpdateInProgress: boolean;
  doLockUpdate: any;

  constructor(
    readonly platform: AugustPlatform,
    accessory: PlatformAccessory,
    device: device & devicesConfig,
  ) {
    super(platform, accessory, device);

    // this is subject we use to track when we need to POST changes to the August API
    this.doLockUpdate = new Subject();
    this.lockUpdateInProgress = false;

    // Initialize Motion Sensor property
    if (!device.lock?.hide_lock) {
      this.LockMechanism = {
        Service: accessory.getService(this.hap.Service.LockMechanism) || accessory.addService(this.hap.Service.LockMechanism) as Service,
        LockTargetState: this.hap.Characteristic.LockTargetState.SECURED,
        LockCurrentState: this.hap.Characteristic.LockCurrentState.SECURED,
      };
      // Service Name
      this.LockMechanism!.Service!.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);
      // Create handlers for required characteristics
      this.LockMechanism!.Service!.getCharacteristic(this.hap.Characteristic.LockTargetState).onSet(this.setLockTargetState.bind(this));
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Removing Lock Mechanism Service`);
      this.LockMechanism!.Service = accessory.getService(this.hap.Service.LockMechanism) as Service;
      accessory.removeService(this.LockMechanism!.Service);
    }


    // Contact Sensor
    if (!device.lock?.hide_contactsensor) {
      this.ContactSensor = {
        Service: accessory.getService(this.hap.Service.ContactSensor) || accessory.addService(this.hap.Service.ContactSensor) as Service,
        ContactSensorState: accessory.context.ContactSensorState || this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      };
      // Service Name
      this.ContactSensor!.Service!.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Contact Sensor`);
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Removing Contact Sensor Service`);
      this.ContactSensor!.Service = accessory.getService(this.hap.Service.ContactSensor) as Service;
      accessory.removeService(this.ContactSensor!.Service);
    }

    this.Battery = {
      Service: accessory.getService(this.hap.Service.Battery) || accessory.addService(this.hap.Service.Battery) as Service,
      BatteryLevel: this.accessory.context.BatteryLevel || 100,
      StatusLowBattery: this.cacheStatusLowBattery(),
    };
    // Service Name
    this.Battery!.Service!.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Battery`);

    // Initial Device Parse
    this.refreshStatus();

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
          if (!device.lock?.hide_lock) {
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
  async parseStatus(lockDetails: lockDetails): Promise<void> {
    this.debugLog(`Lock: ${this.accessory.displayName} parseStatus`);

    //const lockStatus = lockDetails.LockStatus;
    //this.platform.augustConfig.addSimpleProps(lockStatus);

    const retryCount = 1;
    // Lock Mechanism
    if (!this.device.lock?.hide_lock) {
      if (lockDetails.LockStatus.state.locked) {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
      } else if (lockDetails.LockStatus.state.unlocked) {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
      } else if (retryCount > 1) {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.JAMMED;
      } else {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNKNOWN;
        //await this.refreshStatus();
      }
    }
    // Battery
    this.Battery.BatteryLevel = Number((lockDetails.battery * 100).toFixed());
    this.Battery!.Service!.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.Battery.BatteryLevel);
    if (this.Battery.BatteryLevel < 15) {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    this.debugLog(`Lock: ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel},`
      + ` StatusLowBattery: ${this.Battery.StatusLowBattery}`);

    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (lockDetails.LockStatus.state.open) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (lockDetails.LockStatus.state.closed) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (lockDetails.LockStatus.doorState.includes('open')) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (lockDetails.LockStatus.doorState.includes('closed')) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else {
        this.errorLog(`Lock: ${this.accessory.displayName} doorState: ${this.doorState}, closed: ${lockDetails.LockStatus.state.closed},`
          + ` open: ${lockDetails.LockStatus.state.open}`);
      }
    }

    // Firmware Version
    if (lockDetails.currentFirmwareVersion !== this.accessory.context.currentFirmwareVersion) {
      this.warnLog(`Lock: ${this.accessory.displayName} Firmware Version changed to Current Firmware Version: ${this.currentFirmwareVersion}`);
      this.accessory
        .getService(this.hap.Service.AccessoryInformation)!
        .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.currentFirmwareVersion)
        .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
        .updateValue(this.currentFirmwareVersion);
      this.accessory.context.currentFirmwareVersion = this.currentFirmwareVersion;
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
      this.debugSuccessLog(`Lock: ${this.accessory.displayName} (refreshStatus) lockDetails: ${JSON.stringify(lockDetails)}`);
      // Update HomeKit
      await this.parseStatus(lockDetails);
      await this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.statusCode(this.device, e);
    }
  }

  /**
   * Pushes the requested changes to the August API
   */
  async pushChanges(): Promise<void> {
    try {
      await this.platform.augustCredentials();
      if (this.LockMechanism!.LockTargetState === this.hap.Characteristic.LockTargetState.UNSECURED) {
        this.successLog(`Lock: ${this.accessory.displayName} Sending request to August API: Unlock (${this.LockMechanism!.LockTargetState})`);
        const lockStatus = await this.platform.augustConfig.unlock(this.device.lockId);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-unlock) lockStatus: ${JSON.stringify(lockStatus)}`);
      } else if (this.LockMechanism!.LockTargetState === this.hap.Characteristic.LockTargetState.SECURED) {
        this.successLog(`Lock: ${this.accessory.displayName} Sending request to August API: Lock (${this.LockMechanism!.LockTargetState})`);
        const lockStatus = await this.platform.augustConfig.lock(this.device.lockId);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-lock) lockStatus: ${JSON.stringify(lockStatus)}`);
      } else {
        this.errorLog(`Lock: ${this.accessory.displayName} lockStatus (pushChanges) failed,`
          + ` this.LockTargetState: ${this.LockMechanism!.LockTargetState}`);
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
    if (!this.device.lock?.hide_lock) {
      if (this.LockMechanism!.LockTargetState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} LockTargetState: ${this.LockMechanism!.LockTargetState}`);
      } else {
        this.accessory.context.LockCurrentState = this.LockMechanism!.LockTargetState;
        this.LockMechanism!.Service!.updateCharacteristic(this.hap.Characteristic.LockTargetState, this.LockMechanism!.LockTargetState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockTargetState: ${this.LockMechanism!.LockTargetState}`);
      }
      if (this.LockMechanism!.LockCurrentState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} LockCurrentState: ${this.LockMechanism!.LockCurrentState}`);
      } else {
        this.accessory.context.LockCurrentState = this.LockMechanism!.LockCurrentState;
        this.LockMechanism!.Service!.updateCharacteristic(this.hap.Characteristic.LockCurrentState, this.LockMechanism!.LockCurrentState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockCurrentState: ${this.LockMechanism!.LockCurrentState}`);
      }
    }
    // Battery
    if (this.Battery.BatteryLevel === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel}`);
    } else {
      this.accessory.context.BatteryLevel = this.Battery.BatteryLevel;
      this.Battery!.Service!.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic BatteryLevel: ${this.Battery.BatteryLevel}`);
    }
    if (this.Battery.StatusLowBattery === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    } else {
      this.accessory.context.StatusLowBattery = this.Battery.StatusLowBattery;
      this.Battery!.Service!.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    }
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.ContactSensor?.ContactSensorState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else {
        this.accessory.context.ContactSensorState = this.ContactSensor?.ContactSensorState;
        this.ContactSensor!.Service!.updateCharacteristic(this.hap.Characteristic.ContactSensorState, this.ContactSensor?.ContactSensorState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic`
          + ` ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      }
    }
  }

  async setLockTargetState(value: CharacteristicValue): Promise<void> {
    this.debugLog(`Lock: ${this.accessory.displayName} Set LockTargetState: ${value}`);
    this.LockMechanism!.LockTargetState = value;
    this.accessory.context.LockTargetState = this.LockMechanism!.LockTargetState;
    this.doLockUpdate.next();
    if (this.LockMechanism!.LockCurrentState === this.hap.Characteristic.LockCurrentState.UNSECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
    }
    if (this.LockMechanism!.LockCurrentState === this.hap.Characteristic.LockCurrentState.SECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Locked`);
    }
  }

  async subscribeAugust(): Promise<void> {
    await this.platform.augustCredentials();
    await August.subscribe(this.config.credentials!, this.device.lockId, (AugustEvent: any, timestamp: any) => {
      this.debugLog(`Lock: ${this.accessory.displayName} AugustEvent: ${JSON.stringify(AugustEvent)}, ${JSON.stringify(timestamp)}`);
      //LockCurrentState
      if (!this.device.lock?.hide_lock) {
        if (AugustEvent.state.unlocked) {
          this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          this.LockMechanism!.LockTargetState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          if (this.LockMechanism!.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
          }
        } else if (AugustEvent.state.locked) {
          this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
          this.LockMechanism!.LockTargetState = this.hap.Characteristic.LockCurrentState.SECURED;
          if (this.LockMechanism!.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Locked`);
          }
        } else {
          this.refreshStatus();
        }
      }
      // Contact Sensor
      if (!this.device.lock?.hide_contactsensor) {
        if (AugustEvent.state.open) {
          this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
          this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
          if (this.ContactSensor?.ContactSensorState !== this.accessory.context.ContactSensorState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Opened`);
          }
        } else if (AugustEvent.state.closed) {
          this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
          this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
          if (this.ContactSensor?.ContactSensorState !== this.accessory.context.ContactSensorState) {
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

  cacheStatusLowBattery() {
    let StatusLowBattery: number = 0;
    if (this.Battery && this.Battery.BatteryLevel && Number(this.Battery.BatteryLevel) < 15) {
      StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    return StatusLowBattery;
  }
}
