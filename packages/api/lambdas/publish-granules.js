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
      const message = {};
      const newImage = attr.unwrap(record.dynamodb.NewImage);
      const oldImage = attr.unwrap(record.dynamodb.OldImage);
      switch (record.eventName) {
        case 'INSERT': {
          message.event = 'Create';
          message.record = newImage;
          break;
        }
        case 'MODIFY': {
          message.event = 'Update';
          message.record = newImage;
          break;
        }
        case 'REMOVE': {
          message.event = 'Delete';
          message.record = oldImage;
          message.record.deletedAt = Date.now();
          break;
        }
      }
      return publishSnsMessage(topicArn, message);
    }
  );

  await Promise.all(promisedPublishEvents);
};

module.exports = { handler };
