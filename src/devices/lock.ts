/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * lock.ts: homebridge-august.
 */
import August from 'august-yale';
import { deviceBase } from './device.js';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';

import type { AugustPlatform } from '../platform.js';
import type { device, lockDetails, devicesConfig, lockStatus } from '../settings.js';
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

  // Lock Mechanism
  lockDetails!: lockDetails;
  lockStatus!: lockStatus;

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
        this.debugLog('Removing Lock Mechanism Service');
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
        this.debugLog('Removing Conact Sensor Service');
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

    // Initial Device Refresh
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
            await this.statusCode(this.device, 'pushChanges', e);
            await this.errorLog(`doLockUpdate pushChanges: ${e}`);
          }
          this.lockUpdateInProgress = false;
        });
    }
  }

  /**
   * Parse the device status from the August api
   */
  async parseStatus(): Promise<void> {
    await this.debugLog('parseStatus');
    const retryCount = 1;
    if (this.lockStatus) {
      // Lock Mechanism
      this.platform.augustConfig.addSimpleProps(this.lockStatus);
      if (!this.device.lock?.hide_lock && this.LockMechanism?.Service) {
        this.LockMechanism.LockCurrentState = this.lockStatus.state.locked ? this.hap.Characteristic.LockCurrentState.SECURED
          : this.lockStatus.state.unlocked ? this.hap.Characteristic.LockCurrentState.UNSECURED
            : retryCount > 1 ? this.hap.Characteristic.LockCurrentState.JAMMED : this.hap.Characteristic.LockCurrentState.UNKNOWN;
        await this.debugLog(`LockCurrentState: ${this.LockMechanism.LockCurrentState}`);
      }
      // Contact Sensor
      if (!this.device.lock?.hide_contactsensor && this.ContactSensor?.Service) {
      // ContactSensorState
        this.ContactSensor.ContactSensorState = this.lockStatus.state.open ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.lockStatus.state.closed ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
            : this.lockStatus.doorState.includes('open') ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
              : this.lockStatus.doorState.includes('closed') ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
                : this.ContactSensor.ContactSensorState;
        await this.debugLog(`ContactSensorState: ${this.ContactSensor.ContactSensorState}`);
      }
    }
    if (this.lockDetails) {
    // BatteryLevel
      this.Battery.BatteryLevel = Number((this.lockDetails.battery * 100).toFixed());
      await this.debugLog(`BatteryLevel: ${this.Battery.BatteryLevel}`);
      // StatusLowBattery
      this.Battery.StatusLowBattery = this.Battery.BatteryLevel < 15
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      await this.debugLog(`StatusLowBattery: ${this.Battery.StatusLowBattery}`);
      // Firmware Version
      if (this.accessory.context.currentFirmwareVersion !== this.lockDetails.currentFirmwareVersion) {
        await this.warnLog(`Firmware Version changed to Current Firmware Version: ${this.lockDetails.currentFirmwareVersion}`);
        this.accessory
          .getService(this.hap.Service.AccessoryInformation)!
          .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.lockDetails.currentFirmwareVersion)
          .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.lockDetails.currentFirmwareVersion)
          .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
          .updateValue(this.lockDetails.currentFirmwareVersion);
        this.accessory.context.currentFirmwareVersion = this.lockDetails.currentFirmwareVersion;
      }
    }
  }

  /**
   * Asks the August Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    if (this.deviceRefreshRate !== 0) {
      try {
      // Update Lock Details
        const lockDetails: any = await this.platform.augustConfig.details(this.device.lockId);
        await this.debugSuccessLog(`(refreshStatus) lockDetails: ${JSON.stringify(lockDetails)}`);
        // Update HomeKit
        this.lockDetails = lockDetails;
        this.lockStatus = lockDetails.LockStatus;
        await this.parseStatus();
        await this.updateHomeKitCharacteristics();
      } catch (e: any) {
        await this.statusCode(this.device, '(refreshStatus) lockDetails', e);
        await this.errorLog(`pushChanges: ${e.message}`);
      }
    } else {
      await this.debugLog();
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
        await this.successLog(`Sending request to August API: ${(this.LockMechanism.LockTargetState === 1)
          ? 'Locked' : 'Unlocked'}`);
      } else {
        await this.errorLog(`lockTargetState: ${JSON.stringify(this.LockMechanism)}`);
      }
    } catch (e: any) {
      await this.statusCode(this.device, 'pushChanges', e);
      await this.debugLog(`pushChanges: ${e}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    // Lock Mechanism
    if (!this.device.lock?.hide_lock && this.LockMechanism?.Service) {
      // LockTargetState
      await this.updateCharacteristic(this.LockMechanism.Service, this.hap.Characteristic.LockTargetState,
        this.LockMechanism.LockTargetState, 'LockTargetState');
      // LockCurrentState
      await this.updateCharacteristic(this.LockMechanism.Service, this.hap.Characteristic.LockCurrentState,
        this.LockMechanism.LockCurrentState, 'LockCurrentState');
    }
    // Battery
    // BatteryLevel
    await this.updateCharacteristic(this.Battery.Service, this.hap.Characteristic.BatteryLevel,
      this.Battery.BatteryLevel, 'BatteryLevel');
    // StatusLowBattery
    await this.updateCharacteristic(this.Battery.Service, this.hap.Characteristic.StatusLowBattery,
      this.Battery.StatusLowBattery, 'StatusLowBattery');
    // Contact Sensor
    if (!this.device.lock?.hide_contactsensor && this.ContactSensor?.Service) {
      // ContactSensorState
      await this.updateCharacteristic(this.ContactSensor.Service, this.hap.Characteristic.ContactSensorState,
        this.ContactSensor.ContactSensorState, 'ContactSensorState');
    }
  }

  async setLockTargetState(value: CharacteristicValue): Promise<void> {
    if (this.LockMechanism) {
      if (this.LockMechanism.LockTargetState !== this.LockMechanism.LockCurrentState) {
        await this.debugLog(`Set LockTargetState: ${value}`);
      } else {
        await this.debugLog(`No changes, LockTargetState: ${this.LockMechanism.LockTargetState},`
          + ` LockCurrentState: ${this.LockMechanism.LockCurrentState}`);
      }

      this.accessory.context.LockTargetState = this.LockMechanism.LockTargetState = value;
      this.doLockUpdate.next();
    }
  }

  async subscribeAugust(): Promise<void> {
    await this.platform.augustCredentials();
    await August.subscribe(this.config.credentials!, this.device.lockId, async (AugustEvent: any, timestamp: any) => {
      await this.debugLog(`AugustEvent: ${JSON.stringify(AugustEvent)}, ${JSON.stringify(timestamp)}`);
      //LockCurrentState
      if (!this.device.lock?.hide_lock && this.LockMechanism?.Service) {
        this.LockMechanism.LockCurrentState = AugustEvent.state.unlocked ? this.hap.Characteristic.LockCurrentState.UNSECURED
          : AugustEvent.state.locked ? this.hap.Characteristic.LockCurrentState.SECURED
            : this.LockMechanism.LockCurrentState;
        this.LockMechanism.LockTargetState = AugustEvent.state.unlocked ? this.hap.Characteristic.LockTargetState.UNSECURED
          : AugustEvent.state.locked ? this.hap.Characteristic.LockTargetState.SECURED
            : this.LockMechanism.LockTargetState;
        if (this.LockMechanism.LockCurrentState !== this.accessory.context.LockCurrentState) {
          const status = AugustEvent.state.unlocked ? 'was Unlocked' : AugustEvent.state.locked ? 'was Locked' : 'is Unknown';
          await this.infoLog(status);
        }
        await this.debugLog(`LockCurrentState: ${this.LockMechanism?.LockCurrentState}, LockTargetState: ${this.LockMechanism?.LockTargetState}`);
      } else {
        await this.warnLog(`state: ${JSON.stringify(AugustEvent.state)}`);
      }
      // Contact Sensor
      if (!this.device.lock?.hide_contactsensor && this.ContactSensor?.Service) {
        this.ContactSensor.ContactSensorState = AugustEvent.state.open ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : AugustEvent.state.closed ? this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
            : this.ContactSensor.ContactSensorState;
        if (this.ContactSensor.ContactSensorState !== this.accessory.context.ContactSensorState) {
          const status = AugustEvent.state.open ? 'was Opened' : AugustEvent.state.closed ? 'was Closed' : 'is Unknown';
          await this.infoLog(status);
        }
      } else {
        await this.warnLog(`state: ${JSON.stringify(AugustEvent.state)}`);
      }
      // Update HomeKit
      this.lockStatus = AugustEvent;
      await this.parseStatus();
      await this.updateHomeKitCharacteristics();
    });
  }
}
