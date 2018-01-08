/* eslint-disable no-param-reassign */
'use strict';

const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');
const { IncompleteError } = require('@cumulus/common/errors');
let log = require('@cumulus/ingest/log');

log = log.child({ file: 'pdr-status-check/index.js' });

/**
* Callback function provided by aws lambda. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
* @callback lambdaCallback
* @param {object} error
* @param {object} output - output object matching schemas/output.json
*/

/**
* Lambda function handler for discovering granules on s3 buckets.
* See schemas/input.json for detailed expected input.
*
* @param  {object} event lambda event object
* @param  {string} event.s3_path the path of an event stored on s3
* @param  {lambdaCallback} callback callback function
* @return {undefined}
*/
module.exports.handler = function handler(event, context, cb) {
  let counter;
  let limit;
  let isFinished;

  function handleError(e) {
    log.error(e);
    cb(e);
  }

  function checkStatus(eventToCheck) {
    const payload = eventToCheck.payload;
    const pdrName = payload.pdr.name;
    log = log.child({ pdrName });

    counter = get(eventToCheck, 'payload.counter', 0);
    limit = get(eventToCheck, 'payload.limit', 30);
    isFinished = get(eventToCheck, 'payload.isFinished', false);
    const runningExecutions = get(eventToCheck, 'payload.running', []);

    // if finished, exit
    if (isFinished) {
      log.info('pdr is already finished. Exiting...');
      return Promise.resolve(cb(null, eventToCheck));
    }

    // if this is tried too many times, exit
    if (counter >= limit) {
      const err = new IncompleteError(`PDR didn't complete after ${counter} checks`);
      handleError(err);
    }

    // update the status of each previously running execution
    function updateStatus(arn) {
      return StepFunction.getExecution(arn, true).then((r) => {
        const completed = get(eventToCheck, 'payload.completed', []);
        const failed = get(eventToCheck, 'payload.failed', []);
        const running = [];

        r.forEach((sf) => {
          if (sf.status === 'SUCCEEDED') {
            completed.push(sf.executionArn);
          }
          else if (sf.status === 'FAILED') {
            const output = get(sf, 'output', '{ "exception": "Workflow Failed" }');
            failed.push({
              arn: sf.executionArn,
              reason: JSON.parse(output).exception
            });
          }
          else if (sf.status === 'ABORTED') {
            const output = get(sf, 'output', '{ "exception": "Workflow Aborted" }');
            failed.push({
              arn: sf.executionArn,
              reason: JSON.parse(output).exception
            });
          }
          else {
            running.push(sf.executionArn);
          }
        });

        if (running.length === 0) {
          isFinished = true;
          eventToCheck.payload.isFinished = isFinished;
          eventToCheck.payload.running = running.length;
          eventToCheck.payload.failed = failed.length;
          eventToCheck.payload.completed = completed.length;
        }
        else {
          isFinished = false;
          eventToCheck.payload.isFinished = isFinished;
          log.info({
            running: running.length,
            completed: completed.length,
            failed: failed.length,
            counter,
            limit
          }, 'latest status');

          eventToCheck.payload.counter = counter + 1;
          eventToCheck.payload.limit = limit;
          eventToCheck.payload.running = running;
          eventToCheck.payload.completed = completed;
          eventToCheck.payload.failed = failed;
        }

        return Promise.resolve(cb(null, eventToCheck));
      });
    }

    return Promise.all(runningExecutions.map(updateStatus))
      .catch(handleError);
  }

  return checkStatus(event).catch(handleError);
};
