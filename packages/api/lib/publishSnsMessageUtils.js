'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const constructCollectionSnsMessage = (record, event) => {
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

const publishSnsMessageByDataType = async (record, dataType, event) => {
  const topicArn = envUtils.getRequiredEnvVar(`${dataType}_sns_topic_arn`, process.env);
  logger.info(`About to publish SNS message for ${dataType} to topic ARN ${topicArn}: ${JSON.stringify(record)} `);
  if (dataType === 'collection') {
    const messageToPublish = constructCollectionSnsMessage(record, event);
    return await publishSnsMessage(topicArn, messageToPublish);
  }
  if (dataType === 'pdr' || dataType === 'execution') {
    return await publishSnsMessage(topicArn, record);
  }
  return undefined;
};

module.exports = {
  publishSnsMessageByDataType,
};
