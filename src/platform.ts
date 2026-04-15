/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: homebridge-august.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge'

import type { AugustPlatformConfig, credentials, device, devicesConfig, options } from './settings.js'

import { readFileSync, writeFileSync } from 'node:fs'
import { argv } from 'node:process'

import August from 'august-yale'

import { LockMechanism } from './devices/lock.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class AugustPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory[]
  public readonly api: API
  public readonly log: Logging
  public config!: AugustPlatformConfig

  platformConfig!: AugustPlatformConfig
  platformLogging!: options['logging']
  platformRefreshRate!: options['refreshRate']
  platformPushRate!: options['pushRate']
  platformUpdateRate!: options['updateRate']
  registeringDevice!: boolean
  debugMode!: boolean
  version!: string

  // August API
  augustConfig!: August

  // Session refresh: promise coalescing ensures concurrent 502s from
  // multiple locks share a single refresh instead of cascading.
  private sessionRefreshPromise?: Promise<void>

  // Track LockMechanism instances by lockId so they can be properly torn
  // down when the accessory is unregistered (releases PubNub subscriptions).
  private readonly lockMechanisms = new Map<string, LockMechanism>()

  // Cached normalized credentials for performance
  private normalizedCredentialsCache?: credentials

  constructor(
    log: Logging,
    config: AugustPlatformConfig,
    api: API,
  ) {
    // Initialize
    this.accessories = []
    this.api = api
    this.log = log

    // only load if configured
    if (!config) {
      return
    }

    // Plugin options into our config variables.
    this.config = {
      platform: 'August',
      name: config.name,
      credentials: config.credentials as credentials,
      options: config.options as object,
    }

    // Plugin Configuration
    this.getPlatformLogSettings()
    this.getPlatformRateSettings()
    this.getPlatformConfigSettings()
    this.getVersion()

    // Finish initializing the platform
    this.debugLog(`Finished initializing platform: ${config.name}`);

    // verify the config
    (async () => {
      try {
        this.verifyConfig()
        this.debugLog('Config OK')
      } catch (e: any) {
        await this.errorLog(`Verify Config, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/august-bug-report`)
      }
    })()

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      await this.debugLog('Executed didFinishLaunching callback')
      // run the method to discover / register your devices as accessories

      if (this.config.credentials?.isValidated === false || this.config.credentials?.isValidated === undefined) {
        await this.debugWarnLog(`Config Credentials: ${JSON.stringify(this.config.credentials)}`)
        try {
          await this.validated()
        } catch (e: any) {
          this.errorLog(`Validate: ${e.message ?? e}`)
        }
      } else {
        await this.debugWarnLog(`Config Credentials: ${JSON.stringify(this.config.credentials)}`)
        try {
          await this.discoverDevices()
        } catch (e: any) {
          await this.errorLog(`Validated, Discover Devices: ${e.message ?? e}`)
        }
      }
    })
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  async configureAccessory(accessory: PlatformAccessory): Promise<void> {
    await this.debugLog(`Loading accessory from cache: ${accessory.displayName}`)

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory)
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    if (!this.config.credentials) {
      throw new Error('Missing Credentials')
    } else {
      if (!this.config.credentials.augustId) {
        throw new Error('Missing August ID (E-mail/Phone Number)')
      }
      if (!this.config.credentials.password) {
        throw new Error('Missing August Password')
      }
    }
  }

  /**
   * This method looks to see if session is already Validate, if not then sends a validateCode and saves the installId.
   * After validateCode is saved to the config user must restart homebridge
   * this process then looks to see if session is already validated and if the validateCode in config;
   * if isValidated is false then it will validate iwth the validateCode and save isValidated as true in the config.json file
   * will also make the validateCode undefined
   */
  async validated() {
    if (!this.config.credentials?.installId) {
      this.config.credentials!.installId = this.api.hap.uuid.generate(`${this.config.credentials?.augustId}`)
    }
    await this.augustCredentials()
    if (!this.config.credentials?.isValidated && this.config.credentials?.validateCode) {
      const validateCode = this.config.credentials?.validateCode
      const normalizedCredentials = await this.normalizeCredentialsForApi(this.config.credentials!)
      const isValidated = await August.validate(normalizedCredentials, validateCode)
      // If validated successfully, set flag for future use, and you can now use the API
      this.config.credentials.isValidated = isValidated
      // Clear the cache since credentials have been updated
      this.clearNormalizedCredentialsCache()
      // load in the current config
      const { pluginConfig, currentConfig } = await this.pluginConfig()

      pluginConfig.credentials.isValidated = this.config.credentials?.isValidated
      if (this.config.credentials.isValidated) {
        pluginConfig.credentials.validateCode = undefined
      }

      await this.debugWarnLog(`isValidated: ${pluginConfig.credentials.isValidated}`)
      await this.debugWarnLog(`validateCode: ${pluginConfig.credentials.validateCode}`)

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4))
      if (!isValidated) {
        this.debugErrorLog('Validate Code is Invalid, Please Check Your Code and Restart Homebridge.')
      } else {
        try {
          await this.discoverDevices()
          await this.debugWarnLog(`isValidated: ${this.config.credentials?.isValidated}`)
        } catch (e: any) {
          await this.errorLog(`Validate, Discover Devices: ${e.message ?? e}`)
        }
      }
    } else {
      // load in the current config
      const { pluginConfig, currentConfig } = await this.pluginConfig()
      // set the refresh token
      pluginConfig.credentials.installId = this.config.credentials?.installId
      // Clear the cache since credentials have been updated
      this.clearNormalizedCredentialsCache()

      await this.debugWarnLog(`installId: ${pluginConfig.credentials.installId}`)
      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4))

      // A 6-digit code will be sent to your email or phone (depending on what you used for your augustId).
      // Need some way to get this code from the user.
      const normalizedCredentials = await this.normalizeCredentialsForApi(this.config.credentials!)
      August.authorize(normalizedCredentials)
      await this.warnLog('Input Your August email verification code into the validateCode config and restart Homebridge.')
    }
  }

  async augustCredentials() {
    if (!this.config.credentials) {
      throw new Error('Missing Credentials')
    } else if (this.augustConfig) {
      await this.debugLog('August API instance already initialized, skipping')
    } else {
      // Create normalized credentials for August API compatibility
      const normalizedCredentials = await this.normalizeCredentialsForApi(this.config.credentials)
      this.augustConfig = new August(normalizedCredentials)
      await this.debugLog(`August Credentials: ${JSON.stringify(this.augustConfig)}`)
    }
  }

  /**

   * Normalize credentials for August API compatibility
   * Handle country code variations that may cause 403 errors
   * Maps regional country codes to supported API endpoints
   */
  private async normalizeCredentialsForApi(credentials: credentials): Promise<credentials> {
    if (!credentials) {
      throw new Error('Credentials cannot be null or undefined')
    }

    const normalizedCredentials = { ...credentials }
    
    // Country code normalization mapping for API compatibility
    // Some regions don't have dedicated August API endpoints and need to use US servers
    const countryCodeMapping: Record<string, string> = {
      'CA': 'US', // Canada -> United States (North American region)
      'MX': 'US', // Mexico -> United States (North American region)
    }

    const originalCountryCode = credentials.countryCode?.toUpperCase()
    const normalizedCountryCode = originalCountryCode ? countryCodeMapping[originalCountryCode] : undefined

    // Check if user has disabled normalization via config
    const normalizationDisabled = this.config.options?.disableCountryCodeNormalization === true

    if (originalCountryCode && normalizedCountryCode && !normalizationDisabled) {
      await this.debugWarnLog(`Country code normalization: ${originalCountryCode} -> ${normalizedCountryCode} for API compatibility. ` +
        `To disable this behavior, set 'disableCountryCodeNormalization: true' in options.`)
      normalizedCredentials.countryCode = normalizedCountryCode
    } else if (originalCountryCode && normalizedCountryCode && normalizationDisabled) {
      await this.debugLog(`Country code normalization disabled by config. Using original country code: ${originalCountryCode}`)
    } else if (originalCountryCode && !normalizedCountryCode) {
      await this.debugLog(`Country code ${originalCountryCode} does not require normalization.`)
    }
    
    return normalizedCredentials
  }

  /**
   * Clear the normalized credentials cache
   * Should be called when credentials are updated
   */
  clearNormalizedCredentialsCache(): void {
    this.normalizedCredentialsCache = undefined
    this.debugLog('Cleared normalized credentials cache')
  }

  /**
   * Public method to get normalized credentials for use by device classes
   * Uses caching to avoid repeated normalization of the same credentials
   */
  async getNormalizedCredentials(): Promise<credentials> {
    if (!this.config.credentials) {
      throw new Error('Missing Credentials')
    }
    
    // Return cached credentials if available and credentials haven't changed
    if (this.normalizedCredentialsCache) {
      // Simple check to see if the original credentials have changed
      const currentCredsHash = JSON.stringify(this.config.credentials)
      const cachedCredsHash = JSON.stringify({ ...this.normalizedCredentialsCache, countryCode: this.config.credentials.countryCode })
      
      if (currentCredsHash === cachedCredsHash || 
          (this.normalizedCredentialsCache.augustId === this.config.credentials.augustId &&
           this.normalizedCredentialsCache.password === this.config.credentials.password &&
           this.normalizedCredentialsCache.installId === this.config.credentials.installId)) {
        await this.debugLog('Using cached normalized credentials')
        return this.normalizedCredentialsCache
      }
    }
    
    // Generate new normalized credentials and cache them
    this.normalizedCredentialsCache = await this.normalizeCredentialsForApi(this.config.credentials)
    await this.debugLog('Generated and cached new normalized credentials')
    return this.normalizedCredentialsCache
  }

  /**
   * Refresh the August session.
   *
   * Uses promise coalescing: if multiple locks hit 502 simultaneously,
   * they all await the same refresh promise instead of each triggering
   * their own. This prevents cascading refreshes where each lock destroys
   * the instance the previous lock just created.
   *
   * PubNub subscriptions are independent of the HTTP session (August.subscribe
   * uses its own internal August instance), so they are NOT torn down or
   * rebuilt during a session refresh. Only the HTTP client (augustConfig)
   * is recreated.
   */
  async refreshAugustSession(): Promise<void> {
    if (this.sessionRefreshPromise) {
      return this.sessionRefreshPromise
    }
    this.sessionRefreshPromise = this.executeSessionRefresh()
    try {
      await this.sessionRefreshPromise
    } finally {
      this.sessionRefreshPromise = undefined
    }
  }

  private async executeSessionRefresh(): Promise<void> {
    try {
      if (this.augustConfig) {
        await this.warnLog('Refreshing August session due to timeout error')
        this.augustConfig.end()
        this.augustConfig = undefined as any
      }
      await this.augustCredentials()
      await this.warnLog('August session refreshed successfully')
    } catch (e: any) {
      await this.errorLog(`Failed to refresh August session: ${e.message ?? e}`)
    }
  }

  async pluginConfig() {
    const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'))
    // check the platforms section is an array before we do array things on it
    if (!Array.isArray(currentConfig.platforms)) {
      throw new TypeError('Cannot find platforms array in config')
    }
    // find this plugins current config
    const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME)
    if (!pluginConfig) {
      throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`)
    }
    // check the .credentials is an object before doing object things with it
    // Note: typeof null === 'object' is true, so we need to explicitly check for null and undefined
    if (typeof pluginConfig.credentials !== 'object' || pluginConfig.credentials === null) {
      // Initialize credentials as an empty object if it doesn't exist or is null
      pluginConfig.credentials = {}
    }
    return { pluginConfig, currentConfig }
  }

  /**
   * This method is used to discover the your location and devices.
   */
  async discoverDevices() {
    // August Locks
    try {
      // Ensure the August API instance is initialized before processing
      // devices. augustCredentials() is idempotent — safe to call if
      // already initialized (e.g. from the validated() path).
      await this.augustCredentials()

      const normalizedCredentials = await this.normalizeCredentialsForApi(this.config.credentials!)
      const devices = await August.details(normalizedCredentials, '')
      
      let deviceLists: any[]
      if (devices.length > 1) {
        deviceLists = devices
        await this.infoLog(`Total August Locks Found: ${deviceLists.length}`)
      } else {
        deviceLists = [devices]
        await this.infoLog(`Total August Locks Found: ${deviceLists.length}`)
      }

      // Filter out excluded lock IDs before processing
      const excludeLockIds = this.config.options?.excludeLockIds ?? []
      if (excludeLockIds.length > 0) {
        const normalizedExcludeIds = excludeLockIds.map(id => id.toUpperCase().replace(/[^A-Z0-9]+/g, ''))
        const beforeCount = deviceLists.length
        deviceLists = deviceLists.filter((device: any) => {
          const normalizedLockId = (device.lockId ?? device.LockId ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '')
          return !normalizedExcludeIds.includes(normalizedLockId)
        })
        const excludedCount = beforeCount - deviceLists.length
        if (excludedCount > 0) {
          await this.infoLog(`Excluded ${excludedCount} lock(s) via excludeLockIds config.`)
        }
        // Unregister cached accessories for excluded lock IDs
        for (const excludedId of excludeLockIds) {
          const uuid = this.api.hap.uuid.generate(excludedId)
          const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)
          if (existingAccessory) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory])
            this.tearDownLockMechanism(excludedId)
            this.accessories = this.accessories.filter(accessory => accessory.UUID !== uuid)
            await this.warnLog(`Removing excluded accessory from cache: ${existingAccessory.displayName} (${excludedId})`)
          }
        }
      }

      if (!this.config.options?.devices) {
        await this.debugWarnLog(`August Platform Config Not Set: ${JSON.stringify(this.config.options?.devices)}`)
        const devices = deviceLists.map((v: any) => v)
        for (const device of devices) {
          if (device.configDeviceName) {
            device.deviceName = device.configDeviceName
          }
          await this.debugLog(`August Devices: ${JSON.stringify(device)}`)
          await this.Lock(device)
        }
      } else if (this.config.options.devices) {
        await this.debugWarnLog(`August Platform Config Set: ${JSON.stringify(this.config.options?.devices)}`)
        const deviceConfigs = this.config.options?.devices

        const mergeBylockId = (a1: { lockId: string }[], a2: any[]) =>
          a1.map((itm: { lockId: string }) => ({
            ...a2.find(
              (item: { lockId: string }) =>
                item.lockId.toUpperCase().replace(/[^A-Z0-9]+/g, '') === itm.lockId.toUpperCase().replace(/[^A-Z0-9]+/g, '') && item,
            ),
            ...itm,
          }))
        const devices = mergeBylockId(deviceLists, deviceConfigs)
        await this.debugLog(`August Lock(s): ${JSON.stringify(devices)}`)
        for (const device of devices) {
          if (device.configDeviceName) {
            device.deviceName = device.configDeviceName
          }
          await this.debugLog(`device: ${JSON.stringify(device)}`)
          await this.Lock(device)
        }
      } else {
        await this.errorLog('August ID & Password Supplied, Issue with Auth.')
      }
    } catch (error: any) {
      // Handle 401 authentication errors specifically
      const errorMessage = error.message || String(error)
      if (errorMessage.includes('401') || errorMessage.toLowerCase().includes('unauthorized')) {
        await this.warnLog('Authentication session has expired or is invalid. Attempting re-authentication...')
        
        // Reset validation status to force re-authentication
        this.config.credentials!.isValidated = false
        
        // Update the config file to reflect the change
        try {
          const { pluginConfig, currentConfig } = await this.pluginConfig()
          pluginConfig.credentials.isValidated = false
          writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4))
          await this.debugLog('Updated config file with isValidated: false to trigger re-authentication')
        } catch (configError: any) {
          await this.errorLog(`Failed to update config file: ${configError.message ?? configError}`)
        }
        
        // Attempt re-authentication
        try {
          await this.warnLog('Initiating re-authentication process. Please check for verification code if prompted.')
          await this.validated()
          return // validated() will call discoverDevices() again if successful
        } catch (authError: any) {
          throw new Error(`Re-authentication failed: ${authError.message ?? authError}. Please check your credentials and try restarting Homebridge.`)
        }
      } else {
        // Re-throw other errors with more context
        throw new Error(`Failed to discover devices: ${errorMessage}`)
      }
    }
  }

  protected async Lock(device: device & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(device.lockId)
    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        await this.infoLog(`Restoring existing accessory from cache: ${device.LockName}, Lock ID: ${device.lockId}`)

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device
        existingAccessory.displayName = device.configLockName
          ? await this.validateAndCleanDisplayName(device.configLockName, 'configLockName', device.configLockName)
          : await this.validateAndCleanDisplayName(device.LockName, 'LockName', device.LockName)
        existingAccessory.context.currentFirmwareVersion = device.currentFirmwareVersion
        existingAccessory.context.model = device.skuNumber
        existingAccessory.context.serialnumber = device.SerialNumber
        existingAccessory.context.lockId = device.lockId
        this.api.updatePlatformAccessories([existingAccessory])
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        this.lockMechanisms.set(device.lockId, new LockMechanism(this, existingAccessory, device))
        await this.debugLog(`Lock: ${device.LockName} (${device.lockId}) uuid: ${existingAccessory.UUID}`)
      } else {
        await this.unregisterPlatformAccessories(existingAccessory, device)
      }
    } else if (await this.registerDevice(device)) {
      // create a new accessory
      const accessory = new this.api.platformAccessory(device.configLockName ?? device.LockName, uuid)

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device
      accessory.displayName = device.configLockName
        ? await this.validateAndCleanDisplayName(device.configLockName, 'configLockName', device.configLockName)
        : await this.validateAndCleanDisplayName(device.LockName, 'LockName', device.LockName)
      accessory.context.currentFirmwareVersion = device.currentFirmwareVersion
      accessory.context.model = device.skuNumber
      accessory.context.serialnumber = device.SerialNumber
      accessory.context.lockId = device.lockId
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        await this.infoLog(`Adding new accessory: ${device.LockName}, Lock ID: ${device.lockId}`)
      }
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      this.lockMechanisms.set(device.lockId, new LockMechanism(this, accessory, device))
      await this.debugLog(`Lock: ${device.LockName} (${device.lockId}) uuid:  ${accessory.UUID}`)

      // link the accessory to your platform
      await this.externalOrPlatform(device, accessory)
      this.accessories.push(accessory)
    } else {
      await this.debugErrorLog(`Unable to Register: ${device.LockName}, Lock ID: ${device.lockId} Check Config to see if is being Hidden.`)
    }
  }

  async registerDevice(device: device & devicesConfig) {
    if (!device.hide_device && !device.homeKitEnabled) {
      this.registeringDevice = true
      await this.debugLog(`Device: ${device.LockName} Enabled`)
    } else if (device.homeKitEnabled && device.overrideHomeKitEnabled) {
      this.registeringDevice = true
      await this.debugWarnLog(`Device: ${device.LockName} HomeKit Enabled: ${device.homeKitEnabled}, `
        + `Override HomeKit Enabled: ${device.overrideHomeKitEnabled}`)
    } else if (device.homeKitEnabled && !device.overrideHomeKitEnabled) {
      this.registeringDevice = false
      await this.debugErrorLog(`Device: ${device.LockName} HomeKit Enabled: `
        + `${device.homeKitEnabled}, device will not be registered. To enable, set overrideHomeKitEnabled to true.`)
    } else {
      this.registeringDevice = false
      await this.debugLog(`Device: ${device.LockName} is Hidden.`)
    }
    return this.registeringDevice
  }

  public async externalOrPlatform(device: device & devicesConfig, accessory: PlatformAccessory) {
    if (device.external) {
      await this.infoLog(`${accessory.displayName} External Accessory Mode: ${device.external}`)
      await this.externalAccessory(accessory)
    } else {
      await this.debugLog(`${accessory.displayName} External Accessory Mode: ${device.external}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    }
  }

  public async externalAccessory(accessory: PlatformAccessory) {
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory])
  }

  public async unregisterPlatformAccessories(existingAccessory: PlatformAccessory, device: device & devicesConfig) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory])
    this.tearDownLockMechanism(device.lockId)
    await this.warnLog(`Removing existing accessory from cache: ${device.LockName}`)
  }

  /**
   * Tear down the LockMechanism for a given lockId, releasing its PubNub
   * subscription. Called when an accessory is unregistered (either via
   * explicit removal or excludeLockIds config).
   */
  private tearDownLockMechanism(lockId: string): void {
    const lockMechanism = this.lockMechanisms.get(lockId)
    if (lockMechanism) {
      lockMechanism.tearDownPubNubSubscription()
      this.lockMechanisms.delete(lockId)
    }
  }

  async getPlatformLogSettings() {
    this.debugMode = argv.includes('-D') ?? argv.includes('--debug')
    this.platformLogging = (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard'
      || this.config.options?.logging === 'none')
      ? this.config.options.logging
      : this.debugMode ? 'debugMode' : 'standard'
    const logging = this.config.options?.logging ? 'Platform Config' : this.debugMode ? 'debugMode' : 'Default'
    await this.debugLog(`Using ${logging} Logging: ${this.platformLogging}`)
  }

  async getPlatformRateSettings() {
    // RefreshRate
    this.platformRefreshRate = this.config.options?.refreshRate ? this.config.options.refreshRate : undefined
    const refreshRate = this.config.options?.refreshRate ? 'Using Platform Config refreshRate' : 'Platform Config refreshRate Not Set'
    await this.debugLog(`${refreshRate}: ${this.platformRefreshRate}`)
    // UpdateRate
    this.platformUpdateRate = this.config.options?.updateRate ? this.config.options.updateRate : undefined
    const updateRate = this.config.options?.updateRate ? 'Using Platform Config updateRate' : 'Platform Config updateRate Not Set'
    await this.debugLog(`${updateRate}: ${this.platformUpdateRate}`)
    // PushRate
    this.platformPushRate = this.config.options?.pushRate ? this.config.options.pushRate : undefined
    const pushRate = this.config.options?.pushRate ? 'Using Platform Config pushRate' : 'Platform Config pushRate Not Set'
    await this.debugLog(`${pushRate}: ${this.platformPushRate}`)
  }

  async getPlatformConfigSettings() {
    if (this.config.options) {
      const platformConfig: AugustPlatformConfig = {
        platform: 'August',
      }
      platformConfig.logging = this.config.options.logging ? this.config.options.logging : undefined
      platformConfig.refreshRate = this.config.options.refreshRate ? this.config.options.refreshRate : undefined
      platformConfig.updateRate = this.config.options.updateRate ? this.config.options.updateRate : undefined
      platformConfig.pushRate = this.config.options.pushRate ? this.config.options.pushRate : undefined
      if (Object.entries(platformConfig).length !== 0) {
        await this.debugLog(`Platform Config: ${JSON.stringify(platformConfig)}`)
      }
      this.platformConfig = platformConfig
    }
  }

  /**
   * Asynchronously retrieves the version of the plugin from the package.json file.
   *
   * This method reads the package.json file located in the parent directory,
   * parses its content to extract the version, and logs the version using the debug logger.
   * The extracted version is then assigned to the `version` property of the class.
   *
   * @returns {Promise<void>} A promise that resolves when the version has been retrieved and logged.
   */
  async getVersion(): Promise<void> {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    this.debugLog(`Plugin Version: ${version}`)
    this.version = version
  }

  /**
   * Validate and clean a string value for a Name Characteristic.
   * @param displayName - The display name of the accessory.
   * @param name - The name of the characteristic.
   * @param value - The value to be validated and cleaned.
   * @returns The cleaned string value.
   */
  async validateAndCleanDisplayName(displayName: string, name: string, value: string): Promise<string> {
    if (this.config.options?.allowInvalidCharacters) {
      return value
    } else {
      const validPattern = /^[\p{L}\p{N}][\p{L}\p{N} ']*[\p{L}\p{N}]$/u
      const invalidCharsPattern = /[^\p{L}\p{N} ']/gu
      const invalidStartEndPattern = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

      if (typeof value === 'string' && !validPattern.test(value)) {
        this.warnLog(`WARNING: The accessory '${displayName}' has an invalid '${name}' characteristic ('${value}'). Please use only alphanumeric, space, and apostrophe characters. Ensure it starts and ends with an alphabetic or numeric character, and avoid emojis. This may prevent the accessory from being added in the Home App or cause unresponsiveness.`)

        // Remove invalid characters
        if (invalidCharsPattern.test(value)) {
          const before = value
          this.warnLog(`Removing invalid characters from '${name}' characteristic, if you feel this is incorrect,  please enable \'allowInvalidCharacter\' in the config to allow all characters`)
          value = value.replace(invalidCharsPattern, '')
          this.warnLog(`${name} Before: '${before}' After: '${value}'`)
        }

        // Ensure it starts and ends with an alphanumeric character
        if (invalidStartEndPattern.test(value)) {
          const before = value
          this.warnLog(`Removing invalid starting or ending characters from '${name}' characteristic, if you feel this is incorrect, please enable \'allowInvalidCharacter\' in the config to allow all characters`)
          value = value.replace(invalidStartEndPattern, '')
          this.warnLog(`${name} Before: '${before}' After: '${value}'`)
        }
      }

      return value
    }
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.info(String(...log))
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.success(String(...log))
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.success('[DEBUG]', String(...log))
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.warn(String(...log))
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.warn('[DEBUG]', String(...log))
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.error(String(...log))
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.error('[DEBUG]', String(...log))
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log))
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log))
      }
    }
  }

  async loggingIsDebug(): Promise<boolean> {
    return this.platformLogging === 'debugMode' || this.platformLogging === 'debug'
  }

  async enablingPlatformLogging(): Promise<boolean> {
    return this.platformLogging === 'debugMode' || this.platformLogging === 'debug' || this.platformLogging === 'standard'
  }
}
