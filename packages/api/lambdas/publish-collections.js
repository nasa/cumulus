'use strict';

const attr = require('dynamodb-data-types').AttributeValue;
const { publishSnsMessage } = require('@cumulus/aws-client/SNS');

const publishTo = (arn) => (message) => publishSnsMessage(arn, message);
const createSnsMessage = (record) => {
  const { name, version } = attr.unwrap(record.dynamodb.OldImage);
  const newImage = attr.unwrap(record.dynamodb.NewImage);

  switch (record.eventName) {
  case 'INSERT': return { event: 'Create', record: newImage };
  case 'MODIFY': return { event: 'Update', record: newImage };
  case 'REMOVE': return {
    event: 'Delete',
    record: { name, version },
    deletedAt: Date.now(),
  };
  default: return {};
  }
};

/**
 * Publish SNS messages for collection reporting.
 *
 * @param {Object} event - A DynamoDB event
 * @returns {Promise<Array>} Promise of array of SNS publication results
 */
const handler = (event) =>
  Promise.all(
    event.Records
      .map(createSnsMessage)
      .map(publishTo(process.env.collection_sns_topic_arn))
  );

module.exports = { handler };
