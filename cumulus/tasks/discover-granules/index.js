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
    const config = get(event, 'config');
    const input = get(event, 'input');

    const queue = get(config, 'useQueue', true);
    const provider = get(config, 'provider', null);

    if (!provider) {
      const err = new ProviderNotFound('Provider info not provided');
      log.error(err);
      return cb(err);
    }

    const Discover = granule.selector('discover', provider.protocol, queue);
    const discover = new Discover(event);
    const output = {};

    log.debug('Staring granule discovery');
    return discover.discover().then((gs) => {
      if (queue) {
        output.granules_found = gs.length;
        log.debug(`Discovered ${gs.length} granules`);
      }
      else {
        log.debug(gs);
        output.granules = gs;
      }

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }
      return cb(null, output);
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
  const filepath = process.argv[3] ? process.argv[3] : './tests/fixtures/mur.json';
  const payload = require(filepath); // eslint-disable-line global-require

  payload.config.useQueue = false;
  handler(payload, {}, (e) => log.info(e));
});
