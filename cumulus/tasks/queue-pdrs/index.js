'use strict';

import get from 'lodash.get';
import { queuePdr } from '@cumulus/ingest/queue';

function handler(_event, context, cb) {
  // for each PDR, generate a new SF messages
  // send to the step function queue to be executed

  const event = _event;
  const pdrs = get(event, 'payload.pdrs', []);

  const queues = pdrs.map(pdr => queuePdr(event, pdr));

  Promise.all(queues).then(() => {
    event.payload.pdrs_queued = queues.length;
    return cb(null, event);
  }).catch(e => cb(e));
}

module.exports.handler = handler;
