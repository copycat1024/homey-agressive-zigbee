'use strict'

const Homey = require('homey')

function log(...args) {
    Homey.app.log('From coordinate:', ...args)
}

class Coordinator {
    constructor() {
        this.queue = []
        this.register = {}
        this.count = 2
        log('Coordinator initialized.')
    }

    push(id, callback, prioritized = false) {
        if (prioritized) {
            // clear the current item in queue from this id
            if (this.register[id]) {
                const index = this.queue.findIndex(item => item.id === id)
                if (index > -1) {
                    this.queue.splice(index, 1)
                }
            }
            this.queue.unshift({ callback, id })
        } else {
            if (!this.register[id]) {
                this.register[id] = true
                this.queue.push({ callback, id })
            }
        }
        if (this.count > 0) {
            this.processQueue(this.count).catch(log)
        }
    }

    async processQueue(pid) {
        this.count--
        while (this.queue.length > 0) {
            let { id, callback } = this.queue.shift()
            if (id.endsWith('_set')) {
                log(`${id} start, pid ${pid}`)
            }
            await callback().catch(log)
            if (id.endsWith('_set')) {
                log(`${id} end, pid ${pid}`)
            }
            this.register[id] = false
        }
        this.count++
    }
}

module.exports = Coordinator