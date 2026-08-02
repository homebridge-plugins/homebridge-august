<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-august"><img alt="homebridge-august" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-august/latest/branding/Homebridge_x_August.png" width="600px"></a>
</p>
<span align="center">

## homebridge-august

Homebridge plugin to integrate August and Yale locks into HomeKit

[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-august/latest?label=latest)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-august)
[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-august/beta?label=beta)](https://github.com/homebridge/homebridge/wiki/How-to-Install-Alternate-Plugin-Versions)<br>
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)<br>
[![npm](https://img.shields.io/npm/dt/@homebridge-plugins/homebridge-august)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-august)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.gg/bHjKNkN)

</span>

### Plugin Information

- This plugin allows you to view and control your [August](https://august.com) and [Yale](https://shopyalehome.com) locks within HomeKit. The plugin:
  - requires your August account credentials to work
  - connects to the August cloud to discover and control your locks

> [!IMPORTANT]
> **Yale Home accounts (common outside North America) can no longer sign in through this plugin.** Yale has switched off password-based login on its servers (verified July 2026) and now requires an OAuth sign-in that is only available to officially registered partners. If you have a Yale Home account: check whether your lock supports **native HomeKit** (many Yale Home locks do — look for a HomeKit option in the Yale Home app), or use Home Assistant's official Yale integration with its HomeKit Bridge.

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v22` or `v24` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v2` - refer to link for more information and installation instructions.

### Setup

- [Installation](https://github.com/homebridge-plugins/homebridge-august/wiki/Installation)
- [Configuration](https://github.com/homebridge-plugins/homebridge-august/wiki/Configuration)
- [Beta Version](https://github.com/homebridge-plugins/homebridge-august/wiki/Beta-Version)
- [Node Version](https://github.com/homebridge-plugins/homebridge-august/wiki/Node-Version)

### Supported Devices

- August Smart Lock (AUG-SL04-C03-N04)
- August Smart Lock Pro 3rd Gen (AUG-SL03-C02-G03-C)
- August WiFi Smart Lock (Gen 4)
- Yale Assure Lock (AUG-MD01)
- Yale Assure Lock 2 (YDR410)
- Yale Assure Lock SL (YDR256)

### Help/About

- [Common Errors](https://github.com/homebridge-plugins/homebridge-august/wiki/Common-Errors)
- [Support Request](https://github.com/homebridge-plugins/homebridge-august/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-august/blob/latest/CHANGELOG.md)

### Credits

- To [@donavanbecker](https://github.com/donavanbecker): the original creator and maintainer of this plugin.
- To [@hufftheweevil](https://github.com/hufftheweevil): the author of the [august-api](https://github.com/hufftheweevil/august-api) module this plugin builds on.
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with August or Yale and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
