'use strict';

const Task = require('gitc-common/task');

module.exports = class SyncWmsTask extends Task {
  run() {
    const meta = this.event.meta;
    const event = Object.assign(
      {},
      this.event,
      { payload: [
        { name: this.config.filename,
          url: this.config.getmap,
          version: meta.version }] });

    this.trigger('resource-urls-found', meta.key, event);
    return event;
  }

  static handler(...args) {
    return SyncWmsTask.handle(...args);
  }
};

if (process.argv[2] === 'stdin') {
  module.exports.handler({
    eventName: 'wms-map-found',
    eventSource: 'stdin',
    config: {
      filename: '{meta.key}.png',
      getmap: 'https://opendap.larc.nasa.gov/ncWMS-2.0/wms?REQUEST=GetMap&VERSION=1.3.0&STYLES={meta.wms.style}&CRS=CRS:84&WIDTH=640&HEIGHT=320&FORMAT=image/png&TRANSPARENT=true&LAYERS={meta.wms.layer}&BBOX=-180,-90,180,90&&time={meta.date.isoDateTime}'
    }
  }, {}, () => {});
}
