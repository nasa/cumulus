'use strict';

const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');

/**
 * Task which triggers processing of discovered PDRs. Starts a state machine execution
 * for each object specified in the payload, merging its properties into those provided
 * to the input message
 *
 * Input payload: Array of objects { meta: {...}, payload: ... } which need processing
 * Output payload: none
 */
module.exports = class TriggerProcessPdrs extends Task {
  /**
   * Main task entry point
   * @return null
   */
  async run() {
    const s3Promises = [];
    const executions = [];
    const executionPromises = [];
    const isSfnExecution = this.message.ingest_meta.message_source === 'sfn';

    if (!isSfnExecution) {
      log.warn('TriggerProcessPdrTask only triggers AWS Step Functions. Running with inline triggers.');
    }

    const stateMachine = this.config.workflow;

    const bucket = this.message.resources.buckets.private;

    log.info(this.message.payload);
    const id = this.message.ingest_meta.id;

    for (const e of this.message.payload) {
      const key = (e.meta && e.meta.key) || 'Unknown';
      const name = aws.toSfnExecutionName(key.split('/', 3).concat(id), '__');
      // log.info(`Starting processing of ${name}`);
      // const payload = { Bucket: bucket, Key: ['TriggerProcessPdrs', key].join('/') };
      const payload = e;

      const fullMessageData = Object.assign({}, this.message);
      fullMessageData.meta = Object.assign({}, this.message.meta, e.meta);

      const originalIngestMeta = fullMessageData.ingest_meta;
      const newIngestMeta = { state_machine: stateMachine, execution_name: name };
      fullMessageData.ingest_meta = Object.assign({}, originalIngestMeta, newIngestMeta);

      // const s3Params = Object.assign({},
      //                                payload,
      //                                { Body: JSON.stringify(fullMessageData.payload) });

      const sfnMessageData = Object.assign({}, fullMessageData, { payload: payload });
      // if (!isSfnExecution) {
      //   log.warn('inline-result: ', JSON.stringify(fullMessageData));
      // }
      // else {
      //   s3Promises.push(aws.promiseS3Upload(s3Params));
      // }
      executions.push({
        stateMachineArn: stateMachine,
        input: JSON.stringify(sfnMessageData),
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
    return TriggerProcessPdrs.handle(...args);
  }
};

const local = require('@cumulus/common/local-helpers');
local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { message_source: 'stdin', task: 'TriggerProcessPdrs' } })
);
