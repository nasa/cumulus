'use strict';

const { lambda } = require('@cumulus/aws-client/services');

async function getEventSourceMapping(uuid) {
  return await lambda().getEventSourceMapping({ UUID: uuid }).promise();
}

module.exports = { getEventSourceMapping };
