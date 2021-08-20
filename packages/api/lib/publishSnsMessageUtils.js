'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishExecutionSnsMessage = async (record) => {
  const topicArn = envUtils.getRequiredEnvVar('execution_sns_topic_arn', process.env);
  logger.info(`About to publish SNS message ${JSON.stringify(record)} for execution to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, record);
};

module.exports = {
  publishExecutionSnsMessage,
};
