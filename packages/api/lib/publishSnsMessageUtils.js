'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishPdrSnsMessage = async (record) => {
  logger.info(`About to publish SNS message for pdr to topic ARN ${process.env.pdr_sns_topic_arn}: ${JSON.stringify(record)} `);
  const topicArn = envUtils.getRequiredEnvVar('pdr_sns_topic_arn', process.env);
  await publishSnsMessage(topicArn, record);
};

const publishExecutionSnsMessage = async (record) => {
  logger.info(`About to publish SNS message for execution to topic ARN ${process.env.execution_sns_topic_arn}: ${JSON.stringify(record)} `);
  const topicArn = envUtils.getRequiredEnvVar('execution_sns_topic_arn', process.env);
  await publishSnsMessage(topicArn, record);
};

const constructSnsMessage = (record, event) => {
  switch (event) {
  case 'Create':
  case 'Update':
    return { event, record };
  case 'Delete': return {
    event,
    record: {
      name: record.name,
      version: record.version,
    },
    deletedAt: Date.now(),
  };
  default: return {};
  }
};

const publishCollectionSnsMessage = async (record, event) => {
  const topicArn = envUtils.getRequiredEnvVar('collection_sns_topic_arn', process.env);
  const messageToPublish = constructSnsMessage(record, event);

  logger.info(`About to publish SNS message for collection to topic ARN ${topicArn}:  ${JSON.stringify(messageToPublish)}`);
  await publishSnsMessage(topicArn, messageToPublish);
};

module.exports = {
  publishCollectionSnsMessage,
  publishExecutionSnsMessage,
  publishPdrSnsMessage,
};
