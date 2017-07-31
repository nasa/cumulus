'use strict';

import get from 'lodash.get';
import { SQS } from '@cumulus/common/aws-helpers';

export function handler(event, context, cb) {
  // for each PDR, generate a new SF messages
  // send to the step function queue to be executed

  const pdrs = get(event, 'payload.pdrs', []);
  const messages = [];

  const queueMessages = pdrs.map((pdr) => {
    const message = Object.assign({}, event);
    message.payload = {};
    message.payload.pdrName = pdr;

    message.ingest_meta = {
      message_source: 'sfn',
      state_machine: message.resources.stateMachines.parsePdr,
      execution_name: `${message.collection.id}__PDR__${pdr}__${Date.now()}`
    };

    messages.push(message.ingest_meta);
    return SQS.sendMessage(message.resources.queues.sf, message);
  });

  Promise.all(queueMessages).then(() => {
    event.payload.messages = messages;
    return cb(null, event);
  }).catch(e => cb(e));
}
