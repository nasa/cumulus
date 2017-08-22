'use strict';

const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');

module.exports.handler = function handler(_event, context, cb) {
  let event;
  StepFunction.pullEvent(_event).then((ev) => {
    event = ev;
    const isFinished = get(event, 'payload.isFinished', false);
    const running = get(event, 'payload.running', []);

    if (isFinished) {
      return cb(null, event);
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
      event.payload.isFinished = true;
    }
    else {
      event.payload.isFinished = false;
    }

    event.payload.running = running;
    event.payload.completed = completed;
    event.payload.failed = failed;
    return StepFunction.pushEvent(event);
  }).then(ev => cb(null, ev))
    .catch(e => cb(e));
};
