'use strict';

const { handle } = require('../lib/response');


function instanceMetadata(event, cb) {

  return cb(null, {
    cmr: {
      provider: process.env.cmr_provider,
      environment: process.env.CMR_ENVIRONMENT || 'UAT'
    }
  });
}

function handler(event, context) {
  const checkAuth = true;
  return handle(event, context, checkAuth, (cb) => {
    return instanceMetadata(event, cb);
  });
}

module.exports = handler;
