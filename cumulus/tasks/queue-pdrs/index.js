'use strict';

import { queuePdr } from '@cumulus/ingest/queue';
import log from '@cumulus/ingest/log';

/**
* Callback function provided by aws lambda. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
* @callback lambdaCallback
* @param {object} error
* @param {object} output - output object matching schemas/output.json
* @param {integer} output.pdrs_queued
*/

/**
* For each PDR, generate a new SF messages send to the step function queue to be executed
* @param  {object} event lambda event object
* @param  {object} event.input
* @param  {array} event.input.pdrs
* @param  {object} context Lambda context object. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
* @param  {lambdaCallback} callback callback function
* @return {undefined}
**/
function handler(event, context, cb) {
  const pdrs = event.input.pdrs || [];
  const queuedPdrs = pdrs.map(pdr => queuePdr(event, pdr));

  return Promise.all(queuedPdrs).then(() => {
    cb(null, { pdrs_queued: queuedPdrs.length });
  }).catch(e => {
    log.error(e);
    return cb(e);
  });
}

module.exports.handler = handler;
