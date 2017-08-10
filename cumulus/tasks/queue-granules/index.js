'use strict';

const get = require('lodash.get');
const queueGranule = require('@cumulus/ingest/queue').queueGranule;

function handler(_event, context, cb) {
  // for each Granule, generate a new SF messages
  // send to the step function queue to be executed

  const event = Object.assign({}, _event);
  const granules = get(event, 'payload.granules', []);

  const queues = granules.map(g => queueGranule(event, g));

  Promise.all(queues).then(() => {
    event.payload.granules_queued = queues.length;
    return cb(null, event);
  }).catch(e => cb(e));
}

module.exports.handler = handler;
