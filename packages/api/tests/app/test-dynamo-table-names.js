const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const { MissingRequiredEnvVar } = require('@cumulus/errors');

const testBucket = randomString();
const dynamoKey = randomString();
const dynamoTableNames = {
  DynamoTableName: 'prefix-dynamoTableName',
};

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

  const ssmClient = {
    getParameter: () => ({
      promise: () => Promise.resolve({
        Parameter: {
          Value: JSON.stringify(dynamoTableNames),
        },
      }),
    }),
  };
  t.falsy(process.env.DynamoTableName);
  await handler(
    {},
    {
      ssmClient,
    }
  );
  t.is(process.env.DynamoTableName, dynamoTableNames.DynamoTableName);
});
