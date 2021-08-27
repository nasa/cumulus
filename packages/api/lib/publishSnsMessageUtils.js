'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');

const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishCollectionSnsMessage = async (record, event) => {
  let messageToPublish;
  const topicArn = envUtils.getRequiredEnvVar('collection_sns_topic_arn', process.env);

  if (event === 'Delete') {
    const deleteRecord = { name: record.name, version: record.version };
    messageToPublish = { event, record: deleteRecord, deletedAt: Date.now() };
  } else if (event === 'Create' || event === 'Update') {
    messageToPublish = { event, record };
  }
  logger.info(`About to publish SNS message ${JSON.stringify(record)} for collection to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, messageToPublish);
};

module.exports = {
  publishCollectionSnsMessage,
};