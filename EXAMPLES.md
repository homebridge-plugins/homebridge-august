# Configuration Examples

This document provides example configurations for the Homebridge August plugin with enhanced features.

## Basic Lock-Only Configuration

```json
{
  "platforms": [
    {
      "platform": "August",
      "name": "August",
      "credentials": {
        "augustId": "your@email.com",
        "password": "your-password",
        "countryCode": "US"
      }
    }
  ]
}
```

## Full Configuration with All Features

```json
{
  "platforms": [
    {
      "platform": "August",
      "name": "August",
      "credentials": {
        "augustId": "your@email.com",
        "password": "your-password",
        "countryCode": "US",
        "installId": "auto-generated-uuid"
      },
      "options": {
        "enableDoorbells": true,
        "enableAlarms": false,
        "enableActivityTracking": true,
        "enableWebsocketUpdates": false,
        "enableAsyncOperations": true,
        "doorbellMotionSensitivity": 5,
        "activityHistoryLimit": 50,
        "refreshRate": 300,
        "updateRate": 5,
        "pushRate": 1,
        "logging": "standard",
        "devices": [
          {
            "lockId": "your-lock-id-1",
            "configLockName": "Front Door",
            "hide_device": false,
            "lock": {
              "hide_lock": false,
              "hide_contactsensor": false
            },
            "external": false,
            "logging": "debug",
            "refreshRate": 180
          }
        ]
      }
    }
  ]
}
```

## Doorbell-Focused Configuration

```json
{
  "platforms": [
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
        "enableActivityTracking": true,
        "doorbellMotionSensitivity": 7,
        "refreshRate": 120,
        "logging": "standard"
      }
    }
  ]
}
```

## Yale-Specific Configuration

For Yale devices with alarm support:

```json
{
  "platforms": [
    {
      "platform": "August",
      "name": "August Yale",
      "credentials": {
        "augustId": "your@email.com",
        "password": "your-password",
        "countryCode": "US"
      },
      "options": {
        "enableDoorbells": true,
        "enableAlarms": true,
        "enableActivityTracking": true,
        "enableWebsocketUpdates": false,
        "refreshRate": 300,
        "logging": "debug"
      }
    }
  ]
}
```

## Performance-Optimized Configuration

For faster operations and real-time updates:

```json
{
  "platforms": [
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
        "enableWebsocketUpdates": true,
        "enableAsyncOperations": true,
        "refreshRate": 60,
        "updateRate": 2,
        "pushRate": 0.5,
        "logging": "standard"
      }
    }
  ]
}
```

## Minimal Configuration for Testing

```json
{
  "platforms": [
    {
      "platform": "August",
      "name": "August Test",
      "credentials": {
        "augustId": "your@email.com",
        "password": "your-password",
        "countryCode": "US"
      },
      "options": {
        "enableDoorbells": false,
        "enableAlarms": false,
        "enableActivityTracking": false,
        "logging": "debug"
      }
    }
  ]
}
```

## Configuration Options Reference

### Credentials
- **augustId**: Your August account email or phone number (required)
- **password**: Your August account password (required)
- **countryCode**: Two-letter country code (default: "US")
- **installId**: Unique installation ID (auto-generated if not provided)
- **validateCode**: Validation code received via email/SMS (temporary)
- **isValidated**: Whether the account has been validated (managed automatically)

### Enhanced Options
- **enableDoorbells**: Enable doorbell device discovery (default: true)
- **enableAlarms**: Enable Yale alarm system support (default: false)
- **enableActivityTracking**: Track device activity history (default: true)
- **enableWebsocketUpdates**: Use real-time websocket updates (default: false)
- **enableAsyncOperations**: Use faster async lock operations (default: true)
- **doorbellMotionSensitivity**: Motion detection sensitivity 1-10 (default: 5)
- **activityHistoryLimit**: Number of activity events to track (default: 50)

### Standard Options
- **refreshRate**: How often to refresh device status in seconds (default: 300)
- **updateRate**: How often to update characteristics in seconds (default: 5)
- **pushRate**: How often to push updates in seconds (default: 1)
- **logging**: Log level - "debug", "standard", or "none" (default: "standard")

### Device-Specific Configuration
Each device in the `devices` array can have:
- **lockId**: The device's lock ID (required)
- **configLockName**: Custom name for the device
- **hide_device**: Hide the entire device (default: false)
- **external**: Publish as external accessory (default: false)
- **refreshRate**: Device-specific refresh rate override
- **logging**: Device-specific logging level override

For locks:
- **lock.hide_lock**: Hide the lock service (default: false)
- **lock.hide_contactsensor**: Hide the door sensor (default: false)

For doorbells (future feature):
- **hide_motion_sensor**: Hide the motion sensor service (default: false)
- **hide_image_sensor**: Hide the camera service (default: false)
- **hide_ding_sensor**: Hide the doorbell press sensor (default: false)

## Troubleshooting

### Authentication Issues
1. Make sure your `augustId` and `password` are correct
2. Check that you received and entered the validation code correctly
3. Try setting `"logging": "debug"` to see detailed authentication logs
4. Restart Homebridge after updating credentials

### Performance Issues
1. Increase `refreshRate` to reduce API calls
2. Disable features you don't need (`enableDoorbells`, `enableAlarms`, etc.)
3. Enable `enableAsyncOperations` for faster lock operations
4. Consider using `enableWebsocketUpdates` for real-time updates

### Device Discovery Issues
1. Ensure devices are properly set up in the August/Yale app first
2. Check that your account has access to all devices
3. Try removing and re-adding the platform configuration
4. Check logs for specific error messages

### Country Code Issues
Some regions may need specific country codes:
- United States: "US"
- Canada: "CA" (normalized to "US" internally)
- Mexico: "MX" (normalized to "US" internally)
- Europe: Contact support for regional availability