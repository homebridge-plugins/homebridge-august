/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * setting.ts: homebridge-august.
 */
import type { PlatformConfig } from 'homebridge'
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'August'

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-august'

// Config
export interface AugustPlatformConfig extends PlatformConfig {
  credentials?: credentials
  options?: enhancedOptions
}

export interface credentials {
  apiKey?: string
  pnSubKey?: string
  installId: string
  augustId: string // Phone must be formatted +[countrycode][number]
  password: string
  countryCode: string
  validateCode?: string
  isValidated?: boolean
}

export interface options {
  devices?: devicesConfig[]
  allowInvalidCharacters?: boolean
  refreshRate?: number
  updateRate?: number
  pushRate?: number
  logging?: string
  disableCountryCodeNormalization?: boolean
}

export interface device {
  LockName: string
  Type: number
  Created: string
  Updated: string
  LockId: string
  HouseID: string
  HouseName: string
  Calibrated: boolean
  timeZone: string
  battery: number
  batteryInfo: BatteryInfo
  doorStateOpenTimeout: number
  hostLockInfo: HostLockInfo
  supportsEntryCodes: boolean
  remoteOperateSecret: string
  skuNumber: string
  macAddress: string
  SerialNumber: string
  LockStatus: LockStatus
  currentFirmwareVersion: string
  homeKitEnabled: boolean
  zWaveEnabled: boolean
  isGalileo: boolean
  Bridge: Bridge
  parametersToSet: Record<any, undefined>
  users: Record<any, undefined>
  pubsubChannel: string
  ruleHash: any
  cameras: any[]
  lockId: string
}

export interface BatteryInfo {
  level: number
  warningState: string
  infoUpdatedDate: string
  lastChangeDate: string
  lastChangeVoltage: number
}

export interface HostLockInfo {
  serialNumber: string
  manufacturer: string
  productID: number
  productTypeID: number
}

export interface LockStatus {
  status: string
  dateTime: string
  isLockStatusChanged: boolean
  valid: boolean
  doorState: string
}

export interface Bridge {
  _id: string
  mfgBridgeID: string
  deviceModel: string
  firmwareVersion: string
  operative: boolean
  status: Status
  locks: Lock[]
  hyperBridge: boolean
}

export interface Status {
  current: string
  lastOffline: string
  updated: string
  lastOnline: string
}

export interface Lock {
  _id: string
  LockID: string
  macAddress: string
}

export interface devicesConfig extends device {
  configLockName?: string
  lockId: string
  lock?: lock
  overrideHomeKitEnabled: boolean
  hide_device?: boolean
  external?: boolean
  logging?: string
  refreshRate?: number
  updateRate?: number
  pushRate?: number
  firmware?: string
}

export interface lock {
  hide_lock?: boolean
  hide_contactsensor?: boolean
}

export interface lockDetails {
  lockName: string
  battery: number
  LockStatus: lockStatus
  currentFirmwareVersion: string
}

export interface lockStatus {
  lockId: string
  status: string
  doorState: string
  state: state
}

export interface state {
  unlocked: boolean
  locked: boolean
  locking: boolean
  unlocking: boolean
  open: boolean
  closed: boolean
}

export interface lockEvent {
  remoteEvent?: boolean
  status: string
  info?: info
  callingUserID?: string
  doorState: string
  state: stateEvent
  lockID: string
  lockId: string
}

export interface stateEvent {
  locked: boolean
  unlocked: boolean
  locking: boolean
  unlocking: boolean
  open?: boolean
  closed?: boolean
}

export interface info {
  action: string
  startTime: Date
  context: {
    transactionID: string
    startDate: Date
    retryCount: number
  }
  lockType: string
  serialNumber: string
  rssi: number
  wlanRSSI: number
  wlanSNR: number
  duration: number
  lockID: string
  bridgeID: string
}

// New interfaces for enhanced API support

export interface doorbell {
  deviceId: string
  deviceName: string
  houseId: string
  houseName: string
  macAddress: string
  created: string
  updated: string
  firmwareVersion: string
  batteryLevel?: number
  isOnline: boolean
  imageUrl?: string
  hasCapability?: {
    motion: boolean
    image: boolean
    twoWayTalk: boolean
    nightVision: boolean
  }
}

export interface doorbellDetail extends doorbell {
  settings?: {
    motionSensitivity: number
    nightVision: boolean
    chimeEnabled: boolean
  }
  status?: {
    lastActivity: string
    lastMotion: string
    lastDing: string
  }
}

export interface house {
  houseId: string
  houseName: string
  timeZone: string
  locks: string[]
  doorbells: string[]
  users: string[]
  created: string
  updated: string
}

export interface activity {
  activityId: string
  deviceId: string
  deviceType: 'lock' | 'doorbell' | 'alarm'
  action: string
  dateTime: string
  callingUser?: {
    userId: string
    firstName: string
    lastName: string
  }
  info?: any
}

export interface pin {
  pinId: string
  lockId: string
  firstName: string
  lastName: string
  accessType: 'permanent' | 'recurring' | 'temporary'
  state: 'active' | 'inactive'
  pin: string
  created: string
  updated: string
  accessTimes?: {
    startDate?: string
    endDate?: string
    recurringSchedule?: any
  }
}

export interface alarm {
  alarmId: string
  deviceName: string
  houseId: string
  state: 'armed' | 'disarmed' | 'partial'
  created: string
  updated: string
  areaIds?: string[]
}

export interface alarmDevice {
  deviceId: string
  deviceName: string
  deviceType: string
  alarmId: string
  state: string
  batteryLevel?: number
  isOnline: boolean
}

export interface deviceCapabilities {
  serialNumber: string
  capabilities: {
    lock?: boolean
    unlock?: boolean
    unlatch?: boolean
    doorSense?: boolean
    keypadControl?: boolean
    autoLock?: boolean
    guestAccess?: boolean
  }
  supportedFeatures?: string[]
}

export interface websocketSubscription {
  subscriberId: string
  scopes: string[]
  created: string
  expires?: string
}

// Enhanced device configuration interfaces

export interface doorbellConfig extends doorbell {
  hide_device?: boolean
  hide_motion_sensor?: boolean
  hide_image_sensor?: boolean
  hide_ding_sensor?: boolean
  external?: boolean
  logging?: string
  refreshRate?: number
  updateRate?: number
  pushRate?: number
}

export interface alarmConfig extends alarm {
  hide_device?: boolean
  hide_alarm_state?: boolean
  external?: boolean
  logging?: string
  refreshRate?: number
}

export interface enhancedOptions extends options {
  enableDoorbells?: boolean
  enableAlarms?: boolean
  enableActivityTracking?: boolean
  enableWebsocketUpdates?: boolean
  enableAsyncOperations?: boolean
  doorbellMotionSensitivity?: number
  activityHistoryLimit?: number
}
