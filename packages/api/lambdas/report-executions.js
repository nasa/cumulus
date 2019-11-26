'use strict';

const attr = require('dynamodb-data-types').AttributeValue;
const { publishSnsMessage } = require('@cumulus/common/aws');

const handler = async (event) => {
  const records = event.Records.map(attr.unwrap);

  return Promise.all(
    records.map((record) => publishSnsMessage(
      process.env.execution_sns_topic_arn,
      record
    ))
  );
};

module.exports = { handler };
