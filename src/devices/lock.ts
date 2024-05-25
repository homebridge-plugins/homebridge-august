/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * lock.ts: homebridge-august.
 */
import August from 'august-yale';
import { deviceBase } from './device.js';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';

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
    Name: CharacteristicValue;
    Service: Service;
    LockTargetState: CharacteristicValue;
    LockCurrentState: CharacteristicValue;
  };

  private Battery: {
    Name: CharacteristicValue;
    Service: Service;
    BatteryLevel: CharacteristicValue;
    StatusLowBattery: CharacteristicValue;
    ChargingState: CharacteristicValue;
  };

  private ContactSensor?: {
    Name: CharacteristicValue;
    Service: Service;
    ContactSensorState: CharacteristicValue;
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

    // Initialize Lock Mechanism Service
    if (device.lock?.hide_lock) {
      if (this.LockMechanism?.Service) {
        this.debugLog(`${device.Type}: ${accessory.displayName} Removing Lock Mechanism Service`);
        this.LockMechanism.Service = accessory.getService(this.hap.Service.LockMechanism) as Service;
        accessory.removeService(this.LockMechanism.Service);
        accessory.context.LockMechanism = {};
      }
    } else {
      accessory.context.LockMechanism = accessory.context.LockMechanism ?? {};
      this.LockMechanism = {
        Name: accessory.context.LockMechanism.Name ?? device.LockName ?? accessory.displayName,
        Service: accessory.getService(this.hap.Service.LockMechanism) ?? accessory.addService(this.hap.Service.LockMechanism) as Service,
        LockTargetState: accessory.context.LockTargetState ?? this.hap.Characteristic.LockTargetState.SECURED,
        LockCurrentState: accessory.context.LockCurrentState ?? this.hap.Characteristic.LockCurrentState.SECURED,
      };
      accessory.context.LockMechanism = this.LockMechanism as object;
      // Initialize Lock Mechanism Characteristics
      this.LockMechanism.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.LockMechanism.Name)
        .getCharacteristic(this.hap.Characteristic.LockTargetState)
        .onGet(() => {
          return this.LockMechanism!.LockTargetState;
        })
        .onSet(this.setLockTargetState.bind(this));
    }
    // Initialize Contact Sensor Service
    if (device.lock?.hide_contactsensor) {
      if (this.ContactSensor?.Service) {
        this.debugLog(`${device.Type} ${accessory.displayName} Removing Conact Sensor Service`);
        this.ContactSensor.Service = accessory.getService(this.hap.Service.ContactSensor) as Service;
        accessory.removeService(this.ContactSensor.Service);
        accessory.context.ContactSensor = {};
      }
    } else {
      accessory.context.ContactSensor = accessory.context.ContactSensor ?? {};
      this.ContactSensor = {
        Name: accessory.context.ContactSensor.Name ?? `${accessory.displayName} Contact Sensor`,
        Service: accessory.getService(this.hap.Service.ContactSensor) ?? accessory.addService(this.hap.Service.ContactSensor) as Service,
        ContactSensorState: accessory.context.ContactSensorState ?? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      };
      accessory.context.ContactSensor = this.ContactSensor as object;
      // Initialize Conact Sensor Characteristics
      this.ContactSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.ContactSensor.Name)
        .getCharacteristic(this.hap.Characteristic.ContactSensorState)
        .onGet(() => {
          return this.ContactSensor!.ContactSensorState;
        });
    }

    if (!accessory.context.Battery) {
      accessory.context.Battery = {};
    }
    // Initialize Battery Service
    accessory.context.Battery = accessory.context.Battery ?? {};
    this.Battery = {
      Name: accessory.context.Battery.Name ?? `${accessory.displayName} Battery`,
      Service: accessory.getService(this.hap.Service.Battery) ?? accessory.addService(this.hap.Service.Battery) as Service,
      BatteryLevel: accessory.context.BatteryLevel ?? 100,
      StatusLowBattery: accessory.context.StatusLowBattery ?? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      ChargingState: accessory.context.ChargingState ?? this.hap.Characteristic.ChargingState.NOT_CHARGING,
    };
    accessory.context.Battery = this.Battery as object;
    // Initialize Battery Characteristics
    this.Battery.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Battery.Name)
      .setCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGEABLE)
      .getCharacteristic(this.hap.Characteristic.BatteryLevel)
      .onGet(() => {
        return this.Battery.BatteryLevel;
      });

    this.Battery.Service
      .getCharacteristic(this.hap.Characteristic.StatusLowBattery)
      .onGet(() => {
        return this.Battery.StatusLowBattery;
      });

    // Initial Device Parse
    if (this.deviceRefreshRate !== 0) {
      this.refreshStatus();
    }

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Subscribe to august changes
    this.subscribeAugust();

    // Start an update interval
    if (this.deviceRefreshRate !== 0) {
      interval(this.deviceRefreshRate * 1000)
        .pipe(skipWhile(() => this.lockUpdateInProgress))
        .subscribe(async () => {
          await this.refreshStatus();
        });
    }

    // Watch for Lock change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    if (!device.lock?.hide_lock) {
      this.doLockUpdate
        .pipe(
          tap(() => {
            this.lockUpdateInProgress = true;
          }),
          debounceTime(this.devicePushRate * 1000),
        )
        .subscribe(async () => {
          try {
            await this.pushChanges();
          } catch (e: any) {
            this.errorLog(`doLockUpdate pushChanges: ${e}`);
            if (this.deviceRefreshRate !== 0) {
              await this.refreshStatus();
            }
          }
          this.lockUpdateInProgress = false;
        });
    }
  }

  /**
   * Parse the device status from the August api
   */
  async parseStatus(lockDetails: lockDetails): Promise<void> {
    this.debugLog(`${this.device.Type} ${this.accessory.displayName} parseStatus`);

    // Battery
    this.Battery.BatteryLevel = Number((lockDetails.battery * 100).toFixed());
    this.Battery!.Service!.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.Battery.BatteryLevel);
    if (this.Battery.BatteryLevel < 15) {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    this.debugLog(`${this.device.Type} ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel},`
      + ` StatusLowBattery: ${this.Battery.StatusLowBattery}`);

    // Firmware Version
    if (this.accessory.context.currentFirmwareVersion !== lockDetails.currentFirmwareVersion) {
      this.warnLog(`${this.device.Type} ${this.accessory.displayName} Firmware Version changed to `
        + `Current Firmware Version: ${lockDetails.currentFirmwareVersion}`);
      this.accessory
        .getService(this.hap.Service.AccessoryInformation)!
        .setCharacteristic(this.hap.Characteristic.HardwareRevision, lockDetails.currentFirmwareVersion)
        .setCharacteristic(this.hap.Characteristic.FirmwareRevision, lockDetails.currentFirmwareVersion)
        .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
        .updateValue(lockDetails.currentFirmwareVersion);
      this.accessory.context.currentFirmwareVersion = lockDetails.currentFirmwareVersion;
    }

    // Lock Status
    const retryCount = 1;
    const LockStatus = lockDetails.LockStatus;
    this.platform.augustConfig.addSimpleProps(LockStatus);

    // Lock Mechanism
    if (!this.device.lock?.hide_lock) {
      if (LockStatus.state.locked) {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
      } else if (LockStatus.state.unlocked) {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
      } else if (retryCount > 1) {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.JAMMED;
        //this.pushChanges();
      } else {
        this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNKNOWN;
        if (this.deviceRefreshRate !== 0) {
          await this.refreshStatus();
        }
      }
    }

    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (LockStatus.state.open) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (LockStatus.state.closed) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (LockStatus.doorState.includes('open')) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else if (LockStatus.doorState.includes('closed')) {
        this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else {
        this.errorLog(`${this.device.Type} ${this.accessory.displayName} doorState: ${this.doorState}, closed: ${LockStatus.state.closed},`
          + ` open: ${LockStatus.state.open}`);
      }
    }
  }

  /**
   * Asks the August Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      // Update Lock Details
      const lockDetails: any = await this.platform.augustConfig.details(this.device.lockId);
      this.debugSuccessLog(`${this.device.Type} ${this.accessory.displayName} (refreshStatus) lockDetails: ${JSON.stringify(lockDetails)}`);
      // Update HomeKit
      await this.parseStatus(lockDetails);
      await this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.statusCode(this.accessory, this.device, e);
    }
  }

  /**
   * Pushes the requested changes to the August API
   */
  async pushChanges(): Promise<void> {
    try {
      //await this.platform.augustCredentials();
      if (this.LockMechanism) {
        if (this.LockMechanism.LockTargetState === this.hap.Characteristic.LockTargetState.UNSECURED) {
          await this.platform.augustConfig.unlock(this.device.lockId);
        } else {
          await this.platform.augustConfig.lock(this.device.lockId);
        }
        this.successLog(`${this.device.Type} ${this.accessory.displayName} Sending request to August API: ${(this.LockMechanism.LockTargetState === 1)
          ? 'Locked' : 'Unlocked'}`);
        if (this.deviceRefreshRate !== 0) {
          await this.refreshStatus();
        }
      } else {
        this.errorLog(`${this.device.Type} ${this.accessory.displayName} lockTargetState: ${JSON.stringify(this.LockMechanism)}`);
      }
    } catch (e: any) {
      this.statusCode(this.accessory, this.device, e);
      this.debugLog(`pushChanges: ${e}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    // Lock Mechanism
    if (!this.device.lock?.hide_lock) {
      if (this.LockMechanism?.LockTargetState === undefined) {
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} LockTargetState: ${this.LockMechanism?.LockTargetState}`);
      } else {
        this.accessory.context.LockCurrentState = this.LockMechanism.LockTargetState;
        this.LockMechanism.Service.updateCharacteristic(this.hap.Characteristic.LockTargetState, this.LockMechanism!.LockTargetState);
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} updateCharacteristic`
          + ` LockTargetState: ${this.LockMechanism.LockTargetState}`);
      }
      if (this.LockMechanism?.LockCurrentState === undefined) {
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} LockCurrentState: ${this.LockMechanism?.LockCurrentState}`);
      } else {
        this.accessory.context.LockCurrentState = this.LockMechanism!.LockCurrentState;
        this.LockMechanism.Service.updateCharacteristic(this.hap.Characteristic.LockCurrentState, this.LockMechanism.LockCurrentState);
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} updateCharacteristic`
          + ` LockCurrentState: ${this.LockMechanism.LockCurrentState}`);
      }
    }
    // Battery
    if (this.Battery.BatteryLevel === undefined) {
      this.debugLog(`${this.device.Type} ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel}`);
    } else {
      this.accessory.context.BatteryLevel = this.Battery.BatteryLevel;
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel);
      this.debugLog(`${this.device.Type} ${this.accessory.displayName} updateCharacteristic BatteryLevel: ${this.Battery.BatteryLevel}`);
    }
    if (this.Battery.StatusLowBattery === undefined) {
      this.debugLog(`${this.device.Type} ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    } else {
      this.accessory.context.StatusLowBattery = this.Battery.StatusLowBattery;
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery);
      this.debugLog(`${this.device.Type} ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.Battery.StatusLowBattery}`);
    }
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor) {
      if (this.ContactSensor?.ContactSensorState === undefined) {
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      } else {
        this.accessory.context.ContactSensorState = this.ContactSensor?.ContactSensorState;
        this.ContactSensor.Service.updateCharacteristic(this.hap.Characteristic.ContactSensorState, this.ContactSensor.ContactSensorState);
        this.debugLog(`${this.device.Type} ${this.accessory.displayName} updateCharacteristic`
          + ` ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
      }
    }
  }

  async setLockTargetState(value: CharacteristicValue): Promise<void> {
    if (this.LockMechanism) {
      this.debugLog(`${this.device.Type} ${this.accessory.displayName} Set LockTargetState: ${value}`);
      this.accessory.context.LockMechanism.LockTargetState = this.LockMechanism.LockTargetState = value;
      this.doLockUpdate.next();
    }
  }

  async subscribeAugust(): Promise<void> {
    await this.platform.augustCredentials();
    await August.subscribe(this.config.credentials!, this.device.lockId, async (AugustEvent: any, timestamp: any) => {
      this.debugLog(`${this.device.Type} ${this.accessory.displayName} AugustEvent: ${JSON.stringify(AugustEvent)}, ${JSON.stringify(timestamp)}`);
      //LockCurrentState
      if (!this.device.lock?.hide_lock) {
        if (AugustEvent.state.unlocked) {
          this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          this.LockMechanism!.LockTargetState = this.hap.Characteristic.LockCurrentState.UNSECURED;
          if (this.LockMechanism!.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`${this.device.Type} ${this.accessory.displayName} was Unlocked`);
          }
        } else if (AugustEvent.state.locked) {
          this.LockMechanism!.LockCurrentState = this.hap.Characteristic.LockCurrentState.SECURED;
          this.LockMechanism!.LockTargetState = this.hap.Characteristic.LockCurrentState.SECURED;
          if (this.LockMechanism!.LockCurrentState !== this.accessory.context.LockCurrentState) {
            this.infoLog(`${this.device.Type} ${this.accessory.displayName} was Locked`);
          }
        } else {
          if (this.deviceRefreshRate !== 0) {
            await this.refreshStatus();
          }
        }
      }
      // Contact Sensor
      if (!this.device.lock?.hide_contactsensor) {
        if (AugustEvent.state.open) {
          this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
          this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
          if (this.ContactSensor?.ContactSensorState !== this.accessory.context.ContactSensorState) {
            this.infoLog(`${this.device.Type} ${this.accessory.displayName} was Opened`);
          }
        } else if (AugustEvent.state.closed) {
          this.ContactSensor!.ContactSensorState = this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
          this.debugLog(`${this.device.Type} ${this.accessory.displayName} ContactSensorState: ${this.ContactSensor?.ContactSensorState}`);
          if (this.ContactSensor?.ContactSensorState !== this.accessory.context.ContactSensorState) {
            this.infoLog(`${this.device.Type} ${this.accessory.displayName} was Closed`);
          }
        } else {
          if (this.deviceRefreshRate !== 0) {
            await this.refreshStatus();
          }
        }
      }
      // Update HomeKit
      this.updateHomeKitCharacteristics();
    });
  }
}
