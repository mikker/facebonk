const PearRuntimeUpdater = require('pear-runtime-updater')
const ReadyResource = require('ready-resource')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const path = require('path')

module.exports = class PearRuntimeHost extends ReadyResource {
  constructor(opts = {}) {
    super()

    if ((!opts.store && opts.swarm) || (opts.store && !opts.swarm)) {
      throw new Error('must pass store if passing swarm and vice versa')
    }

    if (!opts.dir) throw new Error('dir required')

    this.dir = opts.dir
    this.opts = opts
    this.store =
      opts.store || new Corestore(path.join(this.dir, 'pear-runtime', 'corestore'))
    this.swarm = opts.swarm || null
    this.bootstrap = opts.bootstrap
    this.storage = opts.storage || path.join(this.dir, 'app-storage')
    this.updater = new PearRuntimeUpdater({
      ...opts,
      store: this.store,
    })

    this.ready().catch(noop)
  }

  async _open() {
    await this.updater.ready()

    if (this.swarm === null) {
      const keyPair = await this.store.createKeyPair('pear-runtime')
      this.swarm = new Hyperswarm({ keyPair, bootstrap: this.bootstrap })
      this.swarm.on('connection', (connection) => this.store.replicate(connection))
      this.swarm.join(this.updater.drive.core.discoveryKey, {
        client: true,
        server: false,
      })
    }
  }

  async _close() {
    if (!this.opts.swarm && this.swarm) await this.swarm.destroy()
    await this.updater.close()
    if (!this.opts.store) await this.store.close()
  }
}

function noop() {}
