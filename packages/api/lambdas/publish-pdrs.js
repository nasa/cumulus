'use strict';

const attr = require('dynamodb-data-types').AttributeValue;
const { publishSnsMessage } = require('@cumulus/aws-client/SNS');

/**
 * Publish SNS messages for PDR reporting.
 *
 * @param {Object} event - A DynamoDB event
 * @returns {Promise}
 */
const handler = async (event) => {
  const topicArn = process.env.pdr_sns_topic_arn;

  const promisedPublishEvents = event.Records.map(
    (record) => {
      const pdr = attr.unwrap(record.dynamodb.NewImage);
      return publishSnsMessage(topicArn, pdr);
    }
  );

  await Promise.all(promisedPublishEvents);
};

module.exports = { handler };
