'use strict';

const { s3 } = require('@cumulus/common/aws');

async function handler(event) {
  return s3().putObject({
    Bucket: event.cumulus_meta.system_bucket,
    Key: `${event.cumulus_meta.stack}/test-output/${event.cumulus_meta.execution_name}.output`
  }).promise();
}
exports.handler = handler;
