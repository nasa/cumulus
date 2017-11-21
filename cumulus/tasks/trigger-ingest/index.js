'use strict';

const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const { uuid } = require('@cumulus/common/string');
const _ = require('lodash');
const concurrency = require('@cumulus/common/concurrency');

/**
 * Task which triggers ingest of discovered granules. Starts a state machine execution
 * for each object specified in the payload, merging its properties into those provided
 * to the input message
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
    const isSfnExecution = this.message.ingest_meta.message_source === 'sfn';

    if (!isSfnExecution) {
      log.warn('TriggerIngestTask only triggers AWS Step Functions. Running with inline triggers.');
    }

    const stateMachine = this.config.workflow;

    const bucket = this.message.resources.buckets.private;

    log.info(this.message.payload);
    const id = this.message.ingest_meta.id;

    let actualMessages;
    let returnValue;
    if (Array.isArray(this.message.payload)) {
      actualMessages = this.message.payload;
      returnValue = null;
    }
    else {
      actualMessages = this.message.payload.messages;
      returnValue = _.omit(this.message.payload, 'messages');
    }

    for (const e of actualMessages) {
      const key = (e.meta && e.meta.key) || this.config.key || 'Unknown';
      const name = aws.toSfnExecutionName(key.split('/', 3).concat(id), '__');
      log.info(`Starting ingest of ${name}`);
      const payload = { Bucket: bucket, Key: ['TriggerIngest', key, uuid()].join('/') };

      const fullMessageData = Object.assign({}, this.message, e);
      fullMessageData.meta = Object.assign({}, this.message.meta, e.meta);

      const originalIngestMeta = fullMessageData.ingest_meta;
      const newIngestMeta = { state_machine: stateMachine, execution_name: name };
      fullMessageData.ingest_meta = Object.assign({}, originalIngestMeta, newIngestMeta);

      const s3Params = Object.assign({},
                                     payload,
                                     { Body: JSON.stringify(fullMessageData.payload) });

      const sfnMessageData = Object.assign({}, fullMessageData);
      if (!isSfnExecution) {
        log.warn('inline-result: ', JSON.stringify(fullMessageData));
      }
      else if (s3Params.Body.length > 10000) {
        sfnMessageData.payload = payload;
        s3Promises.push(aws.promiseS3Upload(s3Params));
      }
      executions.push({
        stateMachineArn: stateMachine,
        input: JSON.stringify(sfnMessageData),
        name: name
      });
    }
    await Promise.all(s3Promises);

    if (isSfnExecution) await this.triggerStepFunctionExecutions(executions);

    return returnValue;
  }

  /**
   * Send a batch of execution parameters to SQS
   * @param {Array<Object>} startExecutionParams An array of param objects to be
   *   passed to AWS.StepFunctions.startExecution.
   * @return {Array<Promise>} An Array of Promises that will be resolved when
   *   all of the execution params have been sent to SQS.
   */
  sendExecutionParamsToSqs(startExecutionParams) {
    const messages = startExecutionParams.map((params) => ({
      Id: params.name,
      MessageBody: JSON.stringify(params)
    }));

    const sendBatchOfMessagesToSqs = (messageEntries) =>
      aws.sqs().sendMessageBatch({
        QueueUrl: this.config.sqsQueueUrl,
        Entries: messageEntries
      }).promise();

    const sendBatchOfMessagesToSqsButThrottled = concurrency.limit(10, sendBatchOfMessagesToSqs);
    return _.chunk(messages, 10).map(sendBatchOfMessagesToSqsButThrottled);
  }

  /**
   * Either trigger step function executions, or send the startExecution parameters
   * to an SQS queue based on the presence of this.config.sqsQueueUrl.
   * @param {Array<Object>} startExecutionParams An array of param objects to be
   *   passed to AWS.StepFunctions.startExecution.
   * @return {Promise} A promise that will be resolved when all of the executions
   *   have been started or all of params have been sent to SQS.
   */
  triggerStepFunctionExecutions(startExecutionParams) {
    let promises;
    if (this.config.sqsQueueUrl) {
      promises = this.sendExecutionParamsToSqs(startExecutionParams);
    }
    else {
      promises = startExecutionParams.map(aws.startPromisedSfnExecution);
    }

    return Promise.all(promises);
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

const local = require('@cumulus/common/local-helpers');
local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { message_source: 'stdin', task: 'TriggerIngest' } })
);
