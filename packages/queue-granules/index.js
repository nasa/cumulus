'use strict';

import get from 'lodash.get';
import { SQS } from '@cumulus/common/aws-helpers';

export function handler(event, context, cb) {
  // for each Granule, generate a new SF messages
  // send to the step function queue to be executed

  const granules = get(event, 'payload.granules', []);
  const messages = [];

  const queueMessages = granules.map((granule) => {
    const message = Object.assign({}, event);
    message.payload = {
      input: {
        [granule.collectionName]: {
          granules: [
            {
              granuleId: granule.granuleId,
              files: granule.files
            }
          ]
        }
      },
      output: {}
    };


    message.ingest_meta = {
      message_source: 'sfn',
      state_machine: message.resources.stateMachines.processGranule,
      execution_name: `${granule.collectionName}__GRANULE__${granule.granuleId}__${Date.now()}`
    };

    messages.push(message.ingest_meta);
    return SQS.sendMessage(message.resources.queues.sf, message);
  });

  Promise.all(queueMessages).then(() => {
    event.payload.messages = messages;
    return cb(null, event);
  }).catch(e => cb(e));
}
