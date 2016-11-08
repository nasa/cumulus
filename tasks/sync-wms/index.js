'use strict';

const Task = require('gitc-common/task');

module.exports = class SyncWmsTask extends Task {
  run() {
    const transaction = this.event.transaction;
    this.trigger('resource-urls-found', transaction.key, {
      transaction: transaction,
      config: this.event.config,
      urls: [{ name: this.config.filename, url: this.config.getmap, version: transaction.version }]
    });
    return this.config.getmap;
  }

  static handler(...args) {
    return SyncWmsTask.handle(...args);
  }
};

if (process.argv[2] === 'stdin') {
  module.exports.handler({ eventName: 'wms-map-found', eventSource: 'stdin' }, {}, () => {});
}
