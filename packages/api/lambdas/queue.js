'use strict';

const { queueWorkflowMessage } = require('@cumulus/ingest/queue');

/**
 * Handler for queue lambda task
 *
 * @param {*} event 
 * @param {*} context 
 * @param {*} cb - callback
 */
function handler(event, context, cb) {
  return queueWorkflowMessage(event)
   .then((r) => cb(null, r))
   .catch(cb);
}
module.exports = handler;
