'use strict';

const get = require('lodash.get');
const aws = require('@cumulus/ingest/aws');

function handler(_event, context, cb) {
  // for each Granule, generate a new SF messages
  // send to the step function queue to be executed

  const event = Object.assign({}, _event);
  const templates = get(event, 'resources.templates');
  const queueUrl = get(event, 'resources.queues.startSF');
  const granules = get(event, 'payload.granules', []);
  const next = get(event, 'ingest_meta.config.next', 'IngestGranule');
  const messages = [];

  // get message template
  const parsed = aws.S3.parseS3Uri(templates[next]);
  aws.S3.get(parsed.Bucket, parsed.Key).then((data) => {
    const message = JSON.parse(data.Body);
    message.provider = event.provider;
    message.collection = event.collection;
    message.meta = event.meta;
    message.meta.pdrName = message.payload.pdrName;

    const queueMessages = granules.map((granule) => {
      message.payload = {
        granules: [{
          granuleId: granule.granuleId,
          collection: granule.collectionName,
          files: granule.files
        }]
      };

      const name = `${granule.collectionName}__GRANULE__${granule.granuleId}__${Date.now()}`;
      message.ingest_meta.execution_name = name;
      message.meta.collections = {
        [granule.collectionName]: event.meta.collections[granule.collectionName]
      };

      messages.push(message.ingest_meta);
      return aws.SQS.sendMessage(queueUrl, message);
    });

    Promise.all(queueMessages).then(() => {
      event.payload.messages = messages;
      return cb(null, event);
    }).catch(e => cb(e));
  }).catch(e => cb(e));
}

module.exports.handler = handler;
