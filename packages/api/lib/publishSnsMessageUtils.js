'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishPdrSnsMessage = async (record) => {
  const topicArn = envUtils.getRequiredEnvVar('pdr_sns_topic_arn', process.env);
  logger.info(`About to publish SNS message ${JSON.stringify(record)} for pdr to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, record);
};

module.exports = {
  publishPdrSnsMessage,
};
