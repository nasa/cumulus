'use strict';

const Task = require('gitc-common/task');
const aws = require('gitc-common/aws');
const log = require('gitc-common/log');

module.exports = class TriggerIngestTask extends Task {
  async run() {
    const s3Promises = [];
    const executions = [];
    const executionPromises = [];
    const stateMachine = this.event.resources &&
                         this.event.resources.stateMachines &&
                         this.event.resources.stateMachines.ingest;

    log.info('MY EVENT', JSON.stringify(this.event, null, 2));

    if (!stateMachine) {
      log.info('BUMMER');
      return null;
    }

    const bucket = this.event.resources.buckets.private;

    for (const e of this.event.payload) {
      const date = (e.transaction && e.transaction.startDate) || (new Date().toISOString());
      const noSpecialDate = date.split('.')[0].replace(/[:T]/g, '_');
      const key = (e.transaction && e.transaction.key) || 'Unknown';
      const name = `${key.replace(/\W+/g, '-')}-${noSpecialDate}`;
      log.info(`Starting ingest of ${name}`);
      const payload = { Bucket: bucket, Key: [key, noSpecialDate].join('/') };
      const eventData = Object.assign({}, e, { payload: payload });
      const s3Params = Object.assign({}, payload, { Body: JSON.stringify(e.payload) });

      log.info('WILL TRIGGER', name, JSON.stringify(eventData, 0, 2));

      s3Promises.push(aws.promiseS3Upload(s3Params));
      executions.push({
        stateMachineArn: stateMachine,
        input: JSON.stringify(eventData),
        name: name
      });
    }
    await Promise.all(s3Promises);
    for (const execution of executions) {
      executionPromises.push(aws.sfn().startExecution(execution).promise());
    }
    await Promise.all(executionPromises);
    return null;
  }

  static handler(...args) {
    return TriggerIngestTask.handle(...args);
  }
};
