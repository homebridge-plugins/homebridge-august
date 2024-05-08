/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * lock.ts: homebridge-august.
 */
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators';
import { deviceBase } from './device.js';
import { AugustPlatform } from '../platform.js';
import { device, devicesConfig } from '../settings.js';
import August from 'august-yale';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockMechanism extends deviceBase {
  // Service
  private Lock?: {
    Service?: Service;
    LockTargetState?: CharacteristicValue;
    LockCurrentState?: CharacteristicValue;
  };

  private ContactSensor?: {
    Service?: Service;
    ContactSensorState?: CharacteristicValue;
  };

  private Battery!: {
    Service: Service;
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
    this.lock(device);
    this.cacheState();

    // default placeholders
    // this is subject we use to track when we need to POST changes to the August API
    this.doLockUpdate = new Subject();
    this.lockUpdateInProgress = false;

    // Initial Device Parse
    this.refreshStatus();


    // Lock Mechanism Service
    if (this.hide_lock) {
      this.warnLog(`Lock: ${accessory.displayName} Removing Lock Mechanism Service`);
      this.Lock!.Service = this.accessory.getService(this.hap.Service.LockMechanism);
      accessory.removeService(this.Lock!.Service!);
    } else if (!this.Lock!.Service) {
      this.debugLog(`Lock: ${accessory.displayName} Add Lock Mechanism Service`);
      (this.Lock!.Service =
        this.accessory.getService(this.hap.Service.LockMechanism)
        || this.accessory.addService(this.hap.Service.LockMechanism)), accessory.displayName;
      // Service Name
      this.Lock!.Service.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);
      //Required Characteristics" see https://developers.homebridge.io/#/service/LockMechanism

      // Create handlers for required characteristics
      this.Lock!.Service.getCharacteristic(this.hap.Characteristic.LockTargetState).onSet(this.setLockTargetState.bind(this));
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Lock Mechanism Service Not Added`);
    }
    // Contact Sensor Service
    if (device.lock?.hide_contactsensor) {
      this.warnLog(`Lock: ${accessory.displayName} Removing Contact Sensor Service`);
      this.ContactSensor!.Service = this.accessory.getService(this.hap.Service.ContactSensor);
      accessory.removeService(this.ContactSensor!.Service!);
    } else if (!this.ContactSensor!.Service) {
      this.debugLog(`Lock: ${accessory.displayName} Add Contact Sensor Service`);
      (this.ContactSensor!.Service =
        this.accessory.getService(this.hap.Service.ContactSensor)
        || this.accessory.addService(this.hap.Service.ContactSensor)), `${accessory.displayName} Contact Sensor`;

      // Service Name
      this.ContactSensor!.Service.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Contact Sensor`);
      //Required Characteristics" see https://developers.homebridge.io/#/service/ContactSensor
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Contact Sensor Service Not Added`);
    }

    // Battery Service
    (this.Battery.Service =
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
        this.Lock!.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
      } else if (this.unlocked) {
        this.Lock!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
      } else if (this.retryCount > 1) {
        this.Lock!.LockCurrentState = this.hap.Characteristic.LockCurrentState.JAMMED;
      } else {
        this.Lock!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNKNOWN;
        this.refreshStatus();
      }
    }
    // Battery
    this.Battery.BatteryLevel = Number(this.battery);
    this.Battery.Service.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.Battery.BatteryLevel);
    if (this.Battery.BatteryLevel < 15) {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    this.debugLog(`Lock: ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel},`
      + ` StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.open) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (this.closed) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (this.doorState === 'open') {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (this.doorState === 'closed') {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`Lock: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
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
      if (this.Lock!.LockTargetState === this.hap.Characteristic.LockTargetState.UNSECURED) {
        this.debugWarnLog(`Lock: ${this.accessory.displayName} Sending request to August API: Unlock (${this.Lock!.LockTargetState})`);
        const lockStatus = await this.platform.augustConfig.unlock(this.device.lockId);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-unlock) lockStatus: ${JSON.stringify(lockStatus)}`);
      } else if (this.Lock!.LockTargetState === this.hap.Characteristic.LockTargetState.SECURED) {
        this.debugWarnLog(`Lock: ${this.accessory.displayName} Sending request to August API: Lock (${this.Lock!.LockTargetState})`);
        const lockStatus = await this.platform.augustConfig.lock(this.device.lockId);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-lock) lockStatus: ${JSON.stringify(lockStatus)}`);
      } else {
        this.errorLog(`Lock: ${this.accessory.displayName} lockStatus (pushChanges) failed,`
          + ` this.LockTargetState: ${this.Lock!.LockTargetState}`);
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
      if (this.Lock!.LockTargetState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} LockTargetState: ${this.Lock!.LockTargetState}`);
      } else {
        this.accessory.context.LockCurrentState = this.Lock!.LockTargetState;
        this.Lock!.Service!.updateCharacteristic(this.hap.Characteristic.LockTargetState, this.Lock!.LockTargetState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockTargetState: ${this.Lock!.LockTargetState}`);
      }
      if (this.Lock!.LockCurrentState === undefined) {
        this.debugLog(`Lock: ${this.accessory.displayName} LockCurrentState: ${this.Lock!.LockCurrentState}`);
      } else {
        this.accessory.context.LockCurrentState = this.Lock!.LockCurrentState;
        this.Lock!.Service!.updateCharacteristic(this.hap.Characteristic.LockCurrentState, this.Lock!.LockCurrentState);
        this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockCurrentState: ${this.Lock!.LockCurrentState}`);
      }
    }
    // Battery
    if (this.Battery.BatteryLevel === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel}`);
    } else {
      this.accessory.context.BatteryLevel = this.Battery.BatteryLevel;
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic BatteryLevel: ${this.Battery.BatteryLevel}`);
    }
    if (this.Battery.StatusLowBattery === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    } else {
      this.accessory.context.StatusLowBattery = this.Battery.StatusLowBattery;
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery);
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
    this.Lock!.LockTargetState = value;
    this.accessory.context.LockTargetState = this.Lock!.LockTargetState;
    this.doLockUpdate.next();
    if (this.Lock!.LockCurrentState === this.hap.Characteristic.LockCurrentState.UNSECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
    }
    if (this.Lock!.LockCurrentState === this.hap.Characteristic.LockCurrentState.SECURED) {
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
          this.Lock!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          this.Lock!.LockTargetState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          if (this.Lock!.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
          }
        } else if (AugustEvent.state.locked) {
          this.Lock!.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
          this.Lock!.LockTargetState = this.hap.Characteristic.LockCurrentState.SECURED;
          if (this.Lock!.LockCurrentState !== this.accessory.context.LockCurrentState) {
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


  async cacheState() {
    if (!this.hide_lock) {
      if (this.Lock === undefined) {
        this.Lock = {
          LockCurrentState: this.accessory.context.LockCurrentState || this.hap.Characteristic.LockCurrentState.SECURED,
          LockTargetState: this.accessory.context.LockTargetState || this.hap.Characteristic.LockTargetState.SECURED,
        };
      } else {
        if (this.Lock.LockCurrentState === undefined) {
          this.Lock.LockCurrentState = this.accessory.context.LockCurrentState || this.hap.Characteristic.LockCurrentState.SECURED;
        }
        if (this.Lock.LockTargetState === undefined) {
          this.Lock.LockTargetState = this.accessory.context.LockTargetState || this.hap.Characteristic.LockTargetState.SECURED;
        }
      }
    }
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.ContactSensor === undefined) {
        this.ContactSensor = {
          ContactSensorState: this.accessory.context.ContactSensorState || this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
        };
      } else {
        if (this.ContactSensor?.ContactSensorState === undefined) {
          this.ContactSensor!.ContactSensorState = this.accessory.context.ContactSensorState
            || this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        }
      }
    }
    if (this.Battery.BatteryLevel === undefined) {
      this.Battery.BatteryLevel = this.accessory.context.BatteryLevel || 100;
    }
    if (this.Battery.StatusLowBattery === undefined) {
      if (Number(this.Battery.BatteryLevel) < 15) {
        this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      } else {
        this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      }
    }
  }
}
