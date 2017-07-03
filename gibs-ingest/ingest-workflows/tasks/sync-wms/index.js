'use strict';

const Task = require('ingest-common/task');

/**
 * Transforms input WMS endpoint information (GetMap URL and filename) to output
 * suitable for ingest via http url sync
 *
 * Input payload: None
 * Output payload: An array containing a single {name, url, version} object suitable
 *                 for http url sync
 */
module.exports = class SyncWmsTask extends Task {
  /**
   * Main task entrypoint
   * @return A payload suitable for syncing via http url sync
   */
  run() {
    const meta = this.message.meta;
    const message = Object.assign(
      {},
      this.message,
      { payload: [
        { name: this.config.filename,
          url: this.config.getmap,
          version: meta.version }] });

    return message;
  }

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return SyncWmsTask.handle(...args);
  }
};

if (process.argv[2] === 'stdin') {
  module.exports.handler({
    messageName: 'wms-map-found',
    messageSource: 'stdin',
    config: {
      filename: '{meta.key}.png',
      getmap: 'https://opendap.larc.nasa.gov/ncWMS-2.0/wms?REQUEST=GetMap&VERSION=1.3.0&STYLES={meta.wms.style}&CRS=CRS:84&WIDTH=640&HEIGHT=320&FORMAT=image/png&TRANSPARENT=true&LAYERS={meta.wms.layer}&BBOX=-180,-90,180,90&&time={meta.date.isoDateTime}'
    }
  }, {}, () => {});
}
