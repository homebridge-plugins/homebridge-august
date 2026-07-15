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

### Setup

- Installation
  - Search for "August" on the plugin screen of the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x) and click **Install**.
- Configuration
  1. Enter your August account e-mail or phone number in the plugin settings and restart Homebridge.
  2. August will send you a verification code - enter this code in the plugin settings.
  3. Restart Homebridge once more and your locks will appear.

### Supported Devices

- August Smart Lock (AUG-SL04-C03-N04)
- August Smart Lock Pro 3rd Gen (AUG-SL03-C02-G03-C)
- August WiFi Smart Lock (Gen 4)
- Yale Assure Lock (AUG-MD01)
- Yale Assure Lock 2 (YDR410)
- Yale Assure Lock SL (YDR256)

### Help/About

- [Support Request](https://github.com/homebridge-plugins/homebridge-august/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-august/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- To [@donavanbecker](https://github.com/donavanbecker): the original creator and maintainer of this plugin.
- To [@hufftheweevil](https://github.com/hufftheweevil): the author of the [august-api](https://github.com/hufftheweevil/august-api) module this plugin builds on.
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with August or Yale and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
