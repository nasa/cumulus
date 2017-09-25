/* eslint-disable no-param-reassign */
'use strict';

const moment = require('moment');
const path = require('path');
const get = require('lodash.get');
const { S3 } = require('@cumulus/ingest/aws');

async function discover(event) {
  const bucket = get(event, 'resources.buckets.private');
  const collection = get(event, 'collection.meta');
  const now = moment().utc().format('YYYYMMDD');
  const prefix = `GW1AM2_${now}`;

  let list = await S3.list(bucket, prefix);

  // grab all .h5 files from today
  list = list.Contents.filter(f => path.extname(f.Key) === '.h5');

  // get granuleIds of each file and construct the payload

  const hash = {};

  list.forEach(f => {
    const test = new RegExp(collection.granuleIdExtraction);
    const match = f.Key.match(test);

    if (match) {
      hash[match[1]] = {
        granuleId: match[1],
        files: [{
          filename: `s3://${bucket}/${f.Key}`
        }]
      };
    }
  });

  event.payload = {
    granules: Object.keys(hash).map(k => hash[k])
  };

  return event;
}

function handler(event, context, cb) {
  discover(event).then(payload => cb(null, payload)).catch(e => cb(e));
}

module.exports.handler = handler;

