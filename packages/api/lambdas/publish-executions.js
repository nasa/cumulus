'use strict';

const attr = require('dynamodb-data-types').AttributeValue;
const { publishSnsMessage } = require('@cumulus/aws-client/SNS');

const handler = async (event) => {
  const topicArn = process.env.execution_sns_topic_arn;

  const promisedPublishEvents = event.Records.map(
    (record) => {
      const execution = attr.unwrap(record.dynamodb.NewImage);
      return publishSnsMessage(topicArn, execution);
    }
  );

  await Promise.all(promisedPublishEvents);
};

module.exports = { handler };
