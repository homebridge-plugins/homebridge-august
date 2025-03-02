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
  options?: options
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
