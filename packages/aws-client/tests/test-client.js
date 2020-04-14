const test = require('ava');
const AWS = require('aws-sdk');

const client = require('../client');

test.afterEach.always(() => process.env.NODE_ENV = 'test');

test.serial('client respects AWS_REGION when creating service clients', (t) => {
  // Have to delete this env var to bypass "test mode" logic which will
  // always use us-east-1 as the region
  delete process.env.NODE_ENV;

  process.env.AWS_REGION = 'us-west-2';

  const s3client = client(AWS.S3)();
  t.is(s3client.config.region, 'us-west-2');

  delete process.env.AWS_REGION;
});

test.serial('client defaults region to us-east-1 when creating service clients', (t) => {
  // Have to delete this env var to bypass "test mode" logic which will
  // always use us-east-1 as the region
  delete process.env.NODE_ENV;

  const s3client = client(AWS.S3)();
  t.is(s3client.config.region, 'us-east-1');
});
