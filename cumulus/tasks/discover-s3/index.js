/* eslint-disable no-param-reassign */
'use strict';

const path = require('path');
const get = require('lodash.get');
const { S3 } = require('@cumulus/ingest/aws');

function handler(event, context, cb) {
  const config = get(event, 'config');
  const bucketType = get(config, 'bucket_type');
  const buckets = get(config, 'buckets');
  const bucket = get(buckets, bucketType);
  let fileType = get(config, 'file_type');

  const collection = get(config, 'collection.meta');
  const prefix = get(config, 'file_prefix');

  function createOutput(list) {
    const output = {};

    // filter files if filetype is provided
    if (fileType) {
      if (fileType.indexOf('.') === -1) {
        fileType = '.' + fileType;
      }

      list = list.Contents.filter(f => path.extname(f.Key) === fileType);
    }

    // get granuleIds of each file and construct the payload
    output.granules = [];

    list.forEach(f => {
      const test = new RegExp(collection.granuleIdExtraction);
      const match = f.Key.match(test);

      if (match) {
        output.granules.push({
          granuleId: match[1],
          files: [{
            filename: `s3://${bucket}/${f.Key}`
          }]
        });
      }
    });

    cb(null, output);
  }

  S3.list(bucket, prefix)
    .then(createOutput)
    .catch(cb);
}

module.exports.handler = handler;
