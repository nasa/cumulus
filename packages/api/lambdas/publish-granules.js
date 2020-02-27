'use strict';

const attr = require('dynamodb-data-types').AttributeValue;
const { publishSnsMessage } = require('@cumulus/aws-client/SNS');

/**
 * Publish SNS messages for granule reporting.
 *
 * @param {Object} event - A DynamoDB event
 * @returns {Promise}
 */
const handler = async (event) => {
  const topicArn = process.env.granule_sns_topic_arn;

  const promisedPublishEvents = event.Records.map(
    (record) => {
      const eventType = attr.unwrap(record.eventName);
      const message = { event: eventType };
      if (eventType === 'REMOVE') {
        message.deletedAt = Date.now();
      }
      message.record = attr.unwrap(record.dynamodb.NewImage);

      return publishSnsMessage(topicArn, message);
    }
  );

  await Promise.all(promisedPublishEvents);
};

module.exports = { handler };
