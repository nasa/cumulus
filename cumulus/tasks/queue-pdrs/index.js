'use strict';

import get from 'lodash.get';
import { queuePdr } from '@cumulus/ingest/queue';

function handler(_event, context, cb) {
  // for each PDR, generate a new SF messages
  // send to the step function queue to be executed

  const event = Object.assign({}, _event);
  const input = get(event, 'input');
  const pdrs = get(input, 'pdrs', []);

  const output = {};

  const queues = pdrs.map(pdr => queuePdr(event, pdr));

  Promise.all(queues).then(() => {
    output.pdrs_queued = queues.length;
    return cb(null, output);
  }).catch(e => cb(e));
}

module.exports.handler = handler;
