'use strict';

const Task = require('gitc-common/task');
const aws = require('gitc-common/aws');
const log = require('gitc-common/log');

module.exports = class TriggerIngestTask extends Task {
  async run() {
    const s3Promises = [];
    const executions = [];
    const executionPromises = [];
    const isSfnExecution = this.event.ingest_meta.event_source === 'sfn';

    if (!isSfnExecution) {
      log.warn('TriggerIngestTask only triggers AWS Step Functions. Running with inline triggers.');
    }

    const stateMachinePrefix = this.event.resources &&
                               this.event.resources.state_machine_prefix;
    if (!stateMachinePrefix) {
      return null;
    }

    const stateMachine = stateMachinePrefix + this.config.workflow;

    const bucket = this.event.resources.buckets.private;

    log.info(this.event.payload);
    const date = this.event.ingest_meta.start_date;
    const noSpecialDate = date.split('.')[0].replace(/[:T]/g, '_');

    for (const e of this.event.payload) {
      const key = (e.meta && e.meta.key) || 'Unknown';
      const name = `${key.replace(/\W+/g, '-')}-${noSpecialDate}`;
      log.info(`Starting ingest of ${name}`);
      const payload = { Bucket: bucket, Key: [key, noSpecialDate].join('/') };

      const fullEventData = Object.assign({}, this.event, e);
      fullEventData.meta = Object.assign({}, this.event.meta, e.meta);

      const eventData = Object.assign({}, fullEventData, { payload: payload });
      eventData.ingest_params = Object.assign({},
                                              eventData.ingest_params,
                                              { sfn_name: name });

      const s3Params = Object.assign({}, payload, { Body: JSON.stringify(eventData.payload) });

      if (!isSfnExecution) {
        log.warn('inline-result: ', JSON.stringify(fullEventData));
      }
      else {
        s3Promises.push(aws.promiseS3Upload(s3Params));
      }
      executions.push({
        stateMachineArn: stateMachine,
        input: JSON.stringify(eventData),
        name: name
      });
    }
    await Promise.all(s3Promises);

    if (isSfnExecution) {
      for (const execution of executions) {
        executionPromises.push(aws.sfn().startExecution(execution).promise());
      }
    }
    await Promise.all(executionPromises);
    return null;
  }

  static handler(...args) {
    return TriggerIngestTask.handle(...args);
  }
};

const local = require('gitc-common/local-helpers');
local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { event_source: 'stdin', task: 'TriggerIngest' } })
);
