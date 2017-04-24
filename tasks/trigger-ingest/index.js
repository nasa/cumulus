'use strict';

const Task = require('gitc-common/task');
const aws = require('gitc-common/aws');
const log = require('gitc-common/log');

/**
 * Task which triggers ingest of discovered granules. Starts a state machine execution
 * for each object specified in the payload, merging its properties into those provided
 * to the input event
 *
 * Input payload: Array of objects { meta: {...}, payload: ... } which need ingest
 * Output payload: none
 */
module.exports = class TriggerIngestTask extends Task {
  /**
   * Main task entrypoint
   * @return null
   */
  async run() {
    const s3Promises = [];
    const executions = [];
    const executionPromises = [];
    const isSfnExecution = this.event.ingest_meta.event_source === 'sfn';

    if (!isSfnExecution) {
      log.warn('TriggerIngestTask only triggers AWS Step Functions. Running with inline triggers.');
    }

    const stateMachine = this.config.workflow;

    const bucket = this.event.resources.buckets.private;

    log.info(this.event.payload);
    const id = this.event.ingest_meta.id;

    for (const e of this.event.payload) {
      const key = (e.meta && e.meta.key) || 'Unknown';
      const name = `${key.replace(/\W+/g, '-')}-${id}`;
      log.info(`Starting ingest of ${name}`);
      const payload = { Bucket: bucket, Key: ['TriggerIngest', key].join('/') };

      const fullEventData = Object.assign({}, this.event, e);
      fullEventData.meta = Object.assign({}, this.event.meta, e.meta);

      const originalIngestMeta = fullEventData.ingest_meta;
      const newIngestMeta = { state_machine: stateMachine, execution_name: name };
      fullEventData.ingest_meta = Object.assign({}, originalIngestMeta, newIngestMeta);

      const s3Params = Object.assign({}, payload, { Body: JSON.stringify(fullEventData.payload) });

      const sfnEventData = Object.assign({}, fullEventData, { payload: payload });
      if (!isSfnExecution) {
        log.warn('inline-result: ', JSON.stringify(fullEventData));
      }
      else {
        s3Promises.push(aws.promiseS3Upload(s3Params));
      }
      executions.push({
        stateMachineArn: stateMachine,
        input: JSON.stringify(sfnEventData),
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

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return TriggerIngestTask.handle(...args);
  }
};

const local = require('gitc-common/local-helpers');
local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { event_source: 'stdin', task: 'TriggerIngest' } })
);
