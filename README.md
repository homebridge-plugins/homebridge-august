<span align="center">

<a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-august/latest/branding/Homebridge_x_August.svg?sanitize=true" width="350px"></a>

# Homebridge August

<a href="https://www.npmjs.com/package/homebridge-august"><img title="npm version" src="https://badgen.net/npm/v/homebridge-august?icon=npm&label" ></a>
<a href="https://www.npmjs.com/package/homebridge-august"><img title="npm downloads" src="https://badgen.net/npm/dt/homebridge-august?label=downloads" ></a>
<a href="https://discord.gg/8fpZA4S"><img title="discord-august" src="https://badgen.net/discord/online-members/8fpZA4S?icon=discord&label=discord" ></a>
<a href="https://paypal.me/donavanbecker"><img title="donate" src="https://badgen.net/badge/donate/paypal/yellow" ></a>

<p>The Homebridge <a href="https://august.com">August</a>
plugin allows you to access your <a href="https://august.com">August</a> & <a href="https://shopyalehome.com">Yale</a>  Lock(s) from HomeKit with
  <a href="https://homebridge.io">Homebridge</a>.
</p>

</span>

## Installation

1. Search for "August" on the plugin screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).
2. Click **Install**.

## Configuration

1. Input your August E-mail/Phone Number into the August Account Info.

2. August Validate code will be sent after restarting Homebridge.

3. Input your Validate Code into the August Account Info.

4. Finally Restart Homebridge.

## Enhanced Features (New in v3.1.0)

This plugin now supports additional August/Yale devices and API endpoints beyond just locks:

### Doorbell Support
- **Motion Detection**: Doorbell motion sensors appear as HomeKit motion sensors
- **Doorbell Press Detection**: Doorbell button presses trigger HomeKit doorbell notifications  
- **Battery Monitoring**: Doorbell battery levels and low battery warnings
- **Connectivity Status**: Online/offline status monitoring

### Enhanced API Features
- **Async Operations**: Faster lock/unlock operations using async API endpoints
- **Real-time Updates**: Websocket support for instant status updates
- **Activity History**: Access to device activity and event history
- **PIN Code Management**: Read PIN codes associated with locks
- **Device Capabilities**: Automatic detection of device-specific features
- **Yale Alarm Support**: Basic support for Yale alarm systems

### Configuration Options

```json
{
  "platform": "August",
  "name": "August",
  "credentials": {
    "augustId": "your@email.com",
    "password": "your-password",
    "countryCode": "US"
  },
  "options": {
    "enableDoorbells": true,
    "enableAlarms": false,
    "enableActivityTracking": true,
    "enableWebsocketUpdates": false,
    "enableAsyncOperations": true,
    "refreshRate": 300,
    "logging": "standard"
  }
}
```

### New Options Explained

- **enableDoorbells**: Enable/disable doorbell device discovery (default: true)
- **enableAlarms**: Enable Yale alarm system support (default: false)  
- **enableActivityTracking**: Track device activity history (default: true)
- **enableWebsocketUpdates**: Use real-time websocket updates (default: false)
- **enableAsyncOperations**: Use faster async lock operations (default: true)

## Supported August Devices

### Locks
- August Smart lock (AUG-SL04-C03-N04)
- August Smart Lock Pro 3rd Gen (AUG-SL03-C02-G03-C)
- August WiFi Smart Lock (Gen 4)
- Yale Assure Lock (AUG-MD01)
- Yale Assure Lock 2 (YDR410)
- Yale Assure Lock SL (YDR256)

### Doorbells (New)
- August Doorbell Cam (Gen 1)
- August Doorbell Cam Pro (Gen 2)
- August View Doorbell Camera
- Yale Smart Delivery Box

### Additional Devices (Yale-specific)
- Yale Smart Alarm Systems
- Yale Smart Keypads
- Yale Connect Bridge

## Thanks

Thank you to [hufftheweevil](https://github.com/hufftheweevil) for the [august-api](https://github.com/hufftheweevil/august-api) module.
