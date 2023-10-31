'use strict';

const snsUtils = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const constructCollectionSnsMessage = (record, eventType) => {
  switch (eventType) {
  case 'Create':
  case 'Update':
    return { event: eventType, record };
  case 'Delete': return {
    event: eventType,
    record: {
      name: record.name,
      version: record.version,
    },
    deletedAt: Date.now(),
  };
  default: throw new Error(`Invalid eventType: ${eventType}`);
  }
};

const constructGranuleSnsMessage = (record, eventType) => {
  switch (eventType) {
  case 'Create':
  case 'Update':
    return { event: eventType, record };
  case 'Delete': return {
    event: eventType,
    record,
    deletedAt: Date.now(),
  };
  default: throw new Error(`Invalid eventType: ${eventType}`);
  }
};

const publishSnsMessageByDataType = async (record, dataType, eventType) => {
  const topicArn = envUtils.getRequiredEnvVar(`${dataType}_sns_topic_arn`, process.env);
  let messageTypeInfo = dataType;
  messageTypeInfo += eventType ? ` with event type ${eventType}` : '';
  logger.info(`About to publish SNS message for ${messageTypeInfo} to topic ARN ${topicArn}: ${JSON.stringify(record)}`);
  if (dataType === 'collection') {
    const messageToPublish = constructCollectionSnsMessage(record, eventType);
    await snsUtils.publishSnsMessage(topicArn, messageToPublish);
  }
  if (dataType === 'granule') {
    const messageToPublish = constructGranuleSnsMessage(record, eventType);
    await snsUtils.publishSnsMessage(topicArn, messageToPublish);
  }
  if (dataType === 'pdr' || dataType === 'execution') {
    await snsUtils.publishSnsMessage(topicArn, record);
  }
  return undefined;
};

const publishCollectionUpdateSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'collection', 'Update');
};

const publishCollectionDeleteSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'collection', 'Delete');
};

const publishCollectionCreateSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'collection', 'Create');
};

const publishGranuleUpdateSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'granule', 'Update');
};

const publishGranuleDeleteSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'granule', 'Delete');
};

const publishGranuleCreateSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'granule', 'Create');
};

const publishExecutionSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'execution');
};

const publishPdrSnsMessage = async (record) => {
  await publishSnsMessageByDataType(record, 'pdr');
};

const publishGranuleSnsMessageByEventType = async (record, eventType) => {
  await publishSnsMessageByDataType(record, 'granule', eventType);
};

module.exports = {
  publishSnsMessageByDataType,
  publishCollectionCreateSnsMessage,
  publishCollectionDeleteSnsMessage,
  publishCollectionUpdateSnsMessage,
  publishGranuleCreateSnsMessage,
  publishGranuleDeleteSnsMessage,
  publishGranuleUpdateSnsMessage,
  publishPdrSnsMessage,
  publishExecutionSnsMessage,
  publishGranuleSnsMessageByEventType,
};
