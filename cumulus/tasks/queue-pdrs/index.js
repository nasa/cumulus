'use strict';

import get from 'lodash.get';
import { SQS, S3 } from '@cumulus/common/aws-helpers';

export function handler(event, context, cb) {
  // for each PDR, generate a new SF messages
  // send to the step function queue to be executed

  const pdrs = get(event, 'payload.pdrs', []);
  const queueUrl = get(event, 'resources.queues.startSF');
  const templates = get(event, 'resources.templates');
  const next = get(event, 'ingest_meta.config.next', 'ParsePdr');
  const messages = [];

  // get message template
  const parsed = S3.parseS3Uri(templates[next]);
  S3.get(parsed.Bucket, parsed.Key).then((data) => {
    const message = JSON.parse(data.Body);
    message.provider = event.provider;
    message.collection = event.collection;
    message.meta = event.meta;

    const queueMessages = pdrs.map((pdr) => {
      message.payload = pdr;

      message.ingest_meta.execution_name = `${pdr.pdrName}__PDR__${Date.now()}`;
      messages.push(message.ingest_meta);
      return SQS.sendMessage(queueUrl, message);
    });

    Promise.all(queueMessages).then(() => {
      event.payload.messages = messages;
      return cb(null, event);
    }).catch(e => cb(e));
  }).catch(e => cb(e));
}
