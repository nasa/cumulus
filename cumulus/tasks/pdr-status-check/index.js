/* eslint-disable no-param-reassign */
'use strict';

const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');
const { IncompleteError } = require('@cumulus/common/errors');
let log = require('@cumulus/ingest/log');

log = log.child({ file: 'pdr-status-check/index.js' });

module.exports.handler = function handler(_event, context, cb) {
  let event;
  let counter;
  let limit;
  let isFinished;
  try {
    StepFunction.pullEvent(_event).then((ev) => {
      event = ev;
      const pdrName = get(event, 'payload.pdr.name');
      log = log.child({ pdrName });

      counter = get(event, 'payload.counter', 0);
      limit = get(event, 'payload.limit', 30);
      isFinished = get(event, 'payload.isFinished', false);
      const running = get(event, 'payload.running', []);

      // if finished, exit
      if (isFinished) {
        log.info('pdr is already finished. Exiting...');
        return cb(null, event);
      }

      // if this is tried too many times, exit
      if (counter > limit) {
        const err = new IncompleteError(`PDR didn't complete after ${counter} checks`);
        throw err;
      }

      return Promise.all(running.map(arn => StepFunction.getExecution(arn, true)));
    }).then((r) => {
      const completed = get(event, 'payload.completed', []);
      const failed = get(event, 'payload.failed', []);
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
        event.payload.isFinished = isFinished;
        event.payload.running = running.length;
        event.payload.failed = failed.length;
        event.payload.completed = completed.length;
      }
      else {
        isFinished = false;
        event.payload.isFinished = isFinished;
        log.info({
          running: running.length,
          completed: completed.length,
          failed: failed.length,
          counter,
          limit
        }, 'latest status');

        event.payload.counter = counter + 1;
        event.payload.limit = limit;
        event.payload.running = running;
        event.payload.completed = completed;
        event.payload.failed = failed;
      }

      return StepFunction.pushEvent(event);
    }).then(ev => {
      if (ev.s3_path) {
        ev.payload = { isFinished };
      }
      cb(null, ev);
    }).catch(e => { //eslint-disable-line newline-per-chained-call
      log.error(e);
      cb(e);
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
};

