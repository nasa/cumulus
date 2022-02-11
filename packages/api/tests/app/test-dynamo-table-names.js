const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const testBucket = randomString();
const dynamoKey = randomString();
const dynamoTableNames = {
  DynamoTableName: 'prefix-dynamoTableName',
};
process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';

test.before(async () => {
  await S3.createBucket(testBucket);
  process.env.dynamoTableNamesParameterKey = dynamoKey;
  process.env.system_bucket = testBucket;
});

test.after.always(async () => {
  await S3.recursivelyDeleteS3Bucket(testBucket);
});

test('index adds Dynamo table names from parameter to environment variables', async (t) => {
  await S3.putJsonS3Object(testBucket, dynamoKey, dynamoTableNames);
  // eslint-disable-next-line global-require
  const { handler } = require('../../app');
  t.falsy(process.env.DynamoTableName);
  await handler({});
  t.is(process.env.DynamoTableName, dynamoTableNames.DynamoTableName);
});
