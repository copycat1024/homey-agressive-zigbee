# homey-agressive-zigbee
Zigbee device driver for Homey allowing more agressive polling

## Usage:

Step 1: Adding the library into your project  
Step 2: Add a coordinator to your app
```javascript
// in app.js
const { Coordinator } = require('homey-agressive-zigbee')

class MyApp extends Homey.App {
  onInit() {
    ...
		this.coordinator = new Coordinator()
    ...
  }
  ...
}
```
Step 3: Create device by inheriting from ZigBeeDevice
```javascript
// in device.js
const { ZigBeeDevice } = require('homey-agressive-zigbee')

class MyDevice extends ZigBeeDevice {
  ...
}

```
Step 4: Implement the device driver the same way you did with the homey-meshdriver package, exept that you can also implement onTrigger to catch changes in the capabilities
```javascript
// in device.js
const { ZigBeeDevice } = require('homey-agressive-zigbee')

class MyDevice extends ZigBeeDevice {
  ...
  onTrigger(capabilityId, value) {
    // your code here
  }
}
```
