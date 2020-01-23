'use strict';

const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');
const Lambda = require('@cumulus/aws-client/Lambda');
const SQSUtils = require('@cumulus/aws-client/SQS');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { deprecate } = require('@cumulus/common/util');

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} executionArn - execution ARN
 * @returns {string} return aws console url for the execution
 */
function getExecutionUrl(executionArn) {
  deprecate('@cumulus/ingest/aws/getExecutionUrl', '1.17.0', '@cumulus/aws-client/StepFunctions.getExecutionUrl');
  return StepFunctions.getExecutionUrl(executionArn);
}

function invoke(name, payload, type = 'Event') {
  deprecate('@cumulus/ingest/aws/invoke', '1.17.0', '@cumulus/aws-client/Lambda.invoke');
  return Lambda.invoke(name, payload, type);
}

class Events {
  static putEvent(name, schedule, state, description = null, role = null) {
    deprecate('@cumulus/ingest/aws/Events.putEvent', '1.17.0', '@cumulus/aws-client/CloudwatchEvents.putEvent');
    return CloudwatchEvents.putEvent(name, schedule, state, description, role);
  }

  static deleteEvent(name) {
    deprecate('@cumulus/ingest/aws/Events.deleteEvent', '1.17.0', '@cumulus/aws-client/CloudwatchEvents.deleteEvent');
    return CloudwatchEvents.deleteEvent(name);
  }

  static deleteTarget(id, rule) {
    deprecate('@cumulus/ingest/aws/Events.deleteTarget', '1.17.0', '@cumulus/aws-client/CloudwatchEvents.deleteTarget');
    return CloudwatchEvents.deleteTarget(id, rule);
  }

  static putTarget(rule, id, arn, input) {
    deprecate('@cumulus/ingest/aws/Events.putTarget', '1.17.0', '@cumulus/aws-client/CloudwatchEvents.putTarget');
    return CloudwatchEvents.putTarget(rule, id, arn, input);
  }
}

class SQS {
  static getUrl(name) {
    deprecate('@cumulus/ingest/aws/SQS.getUrl', '1.17.0', '@cumulus/aws-client/SQS.getQueueUrlByName');
    return SQSUtils.getQueueUrlByName(name);
  }

  static deleteQueue(queueUrl) {
    deprecate('@cumulus/ingest/aws/SQS.deleteQueue', '1.17.0', '@cumulus/aws-client/SQS.deleteQueue');
    return SQSUtils.deleteQueue(queueUrl);
  }

  static receiveMessage(queueUrl, numOfMessages = 1, timeout = 30) {
    deprecate('@cumulus/ingest/aws/SQS.receiveMessage', '1.17.0', '@cumulus/aws-client/SQS.receiveSQSMessages');
    return SQSUtils.sendSQSMessage(queueUrl, {
      numOfMessages,
      visibilityTimeout: timeout
    });
  }

  static sendMessage(queueUrl, message) {
    deprecate('@cumulus/ingest/aws/SQS.sendMessage', '1.17.0', '@cumulus/aws-client/SQS.sendSQSMessage');
    return SQSUtils.sendSQSMessage(queueUrl, message);
  }

  static deleteMessage(queueUrl, receiptHandle) {
    deprecate('@cumulus/ingest/aws/SQS.deleteMessage', '1.17.0', '@cumulus/aws-client/SQS.deleteSQSMessage');
    return SQSUtils.deleteSQSMessage(queueUrl, receiptHandle);
  }

  static attributes(name) {
    deprecate('@cumulus/ingest/aws/SQS.attributes', '1.17.0', '@cumulus/aws-client/SQS.getQueueAttributes');
    return SQSUtils.getQueueAttributes(name);
  }
}

class StepFunction {
  static async getExecutionStatus(executionArn) {
    deprecate('@cumulus/ingest/aws/StepFunction.getExecutionStatus', '1.17.0', '@cumulus/aws-client/StepFunction.getExecutionStatus');
    return StepFunctions.getExecutionStatus(executionArn);
  }
}

module.exports = {
  SQS,
  invoke,
  Events,
  StepFunction,
  getExecutionUrl
};
