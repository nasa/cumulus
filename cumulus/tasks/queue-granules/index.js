'use strict';

const queueGranule = require('@cumulus/ingest/queue').queueGranule;
const log = require('@cumulus/ingest/log');

/**
* Callback function provided by aws lambda. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
* @callback lambdaCallback
* @param {object} error
* @param {object} output - output object matching schemas/output.json
* @param {integer} output.granules_queued
*/

/**
* For each Granule, generate a new SF messages send to the step function queue to be executed
* @param  {object} event lambda event object
* @param  {object} event.input
* @param  {array} event.input.granules
* @param  {object} context Lambda context object. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
* @param  {lambdaCallback} callback callback function
* @return {undefined}
**/
function handler(event, context, cb) {
  const granules = event.input.granules || [];
  const queuedGranules = granules.map(g => queueGranule(event, g));

  return Promise.all(queuedGranules).then(() => {
    cb(null, { granules_queued: queuedGranules.length });
  }).catch((e) => {
    log.error(e);
    cb(e);
  });
}

module.exports.handler = handler;
