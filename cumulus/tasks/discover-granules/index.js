'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const local = require('@cumulus/common/local-helpers');
const granule = require('@cumulus/ingest/granule');
const logger = require('@cumulus/ingest/log');

const log = logger.child({ file: 'discover-granules/index.js' });

function handler(_event, context, cb) {
  try {
    log.debug({ payload: _event });
    const event = Object.assign({}, _event);
    const queue = get(event, 'meta.useQueue', true);
    const provider = get(event, 'provider', null);

    if (!provider) {
      const err = new ProviderNotFound('Provider info not provided');
      log.error(err);
      return cb(err);
    }

    const Discover = granule.selector('discover', provider.protocol, queue);
    const discover = new Discover(event);

    log.debug('Staring granule discovery');
    return discover.discover().then((gs) => {
      const stats = {
        completed: gs.completed.length,
        failed: gs.failed.length
      };
      console.log(stats);

      stats.total = stats.completed + stats.failed;

      if (queue) {
        stats.running = gs.running.length;
        stats.total += stats.running;
      }
      else {
        log.debug(gs);
        Object.assign(event.payload, { granules: gs.new });
        stats.new = gs.new.length;
        stats.total += stats.new;
      }
      console.log(stats);

      Object.assign(event.payload, stats);
      log.info(`Discovered ${stats.total} granules`);

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }
      return cb(null, event);
    }).catch(e => {
      if (discover.connected) {
        discover.end();
      }
      log.error(e);
      cb(e);
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
}

module.exports.handler = handler;

local.justLocalRun(() => {
  const payload = require( // eslint-disable-line global-require
    '@cumulus/test-data/payloads/mur/discover.json'
  );
  payload.meta.useQueue = true;
  handler(payload, {}, (e) => log.info(e));
});
