'use strict'

const Homey = require('homey')
const { ZigBeeDevice } = require('homey-meshdriver')

class AgressiveZigBeeDevice extends ZigBeeDevice {
    onInit() {
        super.onInit()

        // use Ieee Address as id
        this.id = this._getIeeeAddress()
        this._coordinator = Homey.app.coordinator

        this._triggerFlag = {}
        this.value = {}
        this.race = {}
        this.last = {}
    }

    // get IEEE address to use as device id
    _getIeeeAddress() {
        return Object.getOwnPropertySymbols(this)
            .map(sym => this[sym])
            .filter(item =>
                typeof item === 'object' && 'zb_ieee_addr' in item
            )[0]['zb_ieee_addr']
            .substr(2)
    }

    // override default functions, now control by the coordinator
    async _registerCapabilityListenerHandler(capabilitySetObj, capabilityId, value, opts) {
        const id = `${this.id}_${capabilityId}_${capabilitySetObj.clusterId}`
        this.log(`Start queue-ing id ${id}`)
        const callback = async () => {
            this.race[id] = true
            this.log(`set ${capabilityId} -> ${value}`)
            if (typeof capabilitySetObj.parser !== 'function') return Promise.reject(new Error('parser_is_not_a_function'))

            let commandId = capabilitySetObj.commandId
            if (typeof capabilitySetObj.commandId === 'function') commandId = capabilitySetObj.commandId(value, opts)
            const parsedPayload = await capabilitySetObj.parser.call(this, value, opts)
            if (parsedPayload instanceof Error) return Promise.reject(parsedPayload)
            if (parsedPayload === null) return Promise.resolve()

            await this._setDeviceValue(commandId, parsedPayload, capabilitySetObj).catch(this.error)

            this.race[id] = false
        }
        this._coordinator.push(id + '_set', callback, true)
    }

    async _setDeviceValue(commandId, parsedPayload, capabilitySetObj) {
        return new Promise((resolve, reject) => {
            const cluster = capabilitySetObj.node.endpoints[capabilitySetObj.endpoint].clusters[capabilitySetObj.clusterId]
            let flag = true
            cluster.do(commandId, parsedPayload)
                .catch(err => {
                    if (flag) {
                        flag = false
                        reject(`Error: could not perform ${commandId} on ${capabilitySetObj.clusterId}`, err)
                    }
                })
                .then((...args) => {
                    if (flag) {
                        flag = false
                        resolve(args)
                    }
                })
            setTimeout(() => {
                if (flag) {
                    flag = false
                    reject('Request timeout')
                }
            }, 2000)
        })
    }

    // override default functions, now control by the coordinator
    _getCapabilityValue(capabilityId, clusterId) {
        const id = `${this.id}_${capabilityId}_${clusterId}`
        const callback = async () => {
            if (this.race[id]) return

            const capabilityGetObj = this._getCapabilityObj('get', capabilityId, clusterId)
            if (capabilityGetObj instanceof Error) return capabilityGetObj

            let parsedPayload = {}

            if (typeof capabilityGetObj.parser === 'function') {
                parsedPayload = await capabilityGetObj.parser.call(this)
                if (parsedPayload instanceof Error) return this.error(parsedPayload)
            }

            try {
                const cluster = capabilityGetObj.node.endpoints[capabilityGetObj.endpoint].clusters[capabilityGetObj.clusterId]
                let start = new Date()
                this.last[id] = start
                return cluster.read(capabilityGetObj.commandId)
                    .then(res => {
                        if (!this.race[id] && this.last[id] <= start)
                            this._onReport(capabilityId, capabilityGetObj.clusterId, res)
                    })
                    .catch(this.error)
            } catch (err) {
                return this.error(err)
            }
        }
        if (!this.race[id]) {
            this._coordinator.push(id + '_get', callback)
        }
    }

    _mergeSystemAndUserOpts(capabilityId, clusterId, userOpts) {
        let tempCapabilityId = capabilityId
        let index = tempCapabilityId.lastIndexOf('.')
        if (index !== -1) {
            tempCapabilityId = tempCapabilityId.slice(0, index)
        }
        let systemOpts = {}
        let requirePath = `../../node_modules/homey-meshdriver/lib/zigbee/system/capabilities/${tempCapabilityId}/${clusterId}.js`

        // Merge systemOpts & userOpts
        try {
            systemOpts = Homey.util.recursiveDeepCopy(require(requirePath))

            // Bind correct scope
            for (const i in systemOpts) {
                if (systemOpts.hasOwnProperty(i) && typeof systemOpts[i] === 'function') {
                    systemOpts[i] = systemOpts[i].bind(this)
                }
            }
        } catch (err) {
            if (err.code !== 'MODULE_NOT_FOUND' || err.message.indexOf(requirePath) < 0) {
                process.nextTick(() => {
                    throw err
                })
            }
        }

        // Insert default endpoint zero
        if (userOpts && !userOpts.hasOwnProperty('endpoint')) userOpts.endpoint = this.getClusterEndpoint(clusterId)
        else if (typeof userOpts === 'undefined') userOpts = { endpoint: this.getClusterEndpoint(clusterId) }

        let capability = Object.assign({}, systemOpts || {}, userOpts || {})

        capability.setParser = this._decorateParser(capability.setParser, capabilityId, 'set')
        capability.reportParser = this._decorateParser(capability.reportParser, capabilityId, 'report')

        this._capabilities[capabilityId][clusterId] = capability
    }

    _decorateParser(fn, capabilityId, source) {
        return (value, ...args) => {
            const result = fn(value, ...args)
            this._onUpdate(value, result, capabilityId, source)
            return result
        }
    }

    // update a value, prepare to trigger a flow
    _onUpdate(value, result, capabilityId, source) {
        let old_value = this.value[capabilityId]
        this.value[capabilityId] = value

        if (this._triggerFlag[capabilityId] === undefined)
            this._triggerFlag[capabilityId] = 0

        if (value !== old_value) {
            this.log('New state: ', capabilityId, '. Value: ', value)
            this._triggerFlag[capabilityId]++
            setTimeout(() => {
                this._triggerFlag[capabilityId]--
                if (this._triggerFlag[capabilityId] === 0) {
                    this.onTrigger(capabilityId, this.value[capabilityId], source)
                }
            }, 500)
        }
    }

    setState(capabilityId, clusterId, value) {
        // update to switch
        const capabilitySetObj = this._getCapabilityObj('set', capabilityId, clusterId)
        if (capabilitySetObj instanceof Error) {
            this.error(`capabilitySetObj ${capabilityId} ${clusterId} is error`, capabilitySetObj)
            return
        }
        this._registerCapabilityListenerHandler(capabilitySetObj, capabilityId, value, {})
            .catch(this.error)

        // update to app
        this.setCapabilityValue(capabilityId, value).catch(this.error)
    }
}

module.exports = AgressiveZigBeeDevice
