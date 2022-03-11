const test = require('ava');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');

const { awsClient } = require('../client');

test.beforeEach(() => {
  // Have to delete this env var to bypass "test mode" logic which will
  // always use us-east-1 as the region
  delete process.env.NODE_ENV;
});

test.afterEach.always(() => {
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  process.env.NODE_ENV = 'test';
});

test.serial('client respects AWS_DEFAULT_REGION when creating service clients', async (t) => {
  process.env.AWS_DEFAULT_REGION = 'us-west-2';

  const s3client = awsClient(DynamoDB)();
  t.is(await s3client.config.region(), 'us-west-2');
});

test.serial('client defaults region to us-east-1 if AWS_DEFAULT_REGION env var is an empty string', async (t) => {
  process.env.AWS_DEFAULT_REGION = '';

  const s3client = awsClient(DynamoDB)();
  t.is(await s3client.config.region(), 'us-east-1');
});

test.serial('client respects AWS_REGION when creating service clients', async (t) => {
  process.env.AWS_REGION = 'us-west-2';

  const s3client = awsClient(DynamoDB)();
  t.is(await s3client.config.region(), 'us-west-2');
});

test.serial('client defaults region to us-east-1 if no env var is not set', async (t) => {
  const s3client = awsClient(DynamoDB)();
  t.is(await s3client.config.region(), 'us-east-1');
});

test.serial('client defaults region to us-east-1 if AWS_REGION env var is an empty string', async (t) => {
  process.env.AWS_REGION = '';

  const s3client = awsClient(DynamoDB)();
  t.is(await s3client.config.region(), 'us-east-1');
});
