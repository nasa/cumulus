'use strict';

const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { ResourceNotFoundException } = require('@aws-sdk/client-kinesis');
const Kinesis = require('../Kinesis');
const { kinesis } = require('../services');

const testStreamName = cryptoRandomString({ length: 10 });

test.before(async () => {
  await kinesis().createStream({
    StreamName: testStreamName,
    ShardCount: 1,
  });
});

test('describeStream returns the stream description', async (t) => {
  const response = await Kinesis.describeStream({
    StreamName: testStreamName,
  });
  t.truthy(response.StreamDescription);
});

test('describeStream throws error for non-existent stream if retries are disabled', async (t) => {
  await t.throwsAsync(Kinesis.describeStream({
    StreamName: 'non-existent-stream',
  }));
});

test.serial('describeStream returns stream on retry', async (t) => {
  let retryCount = 0;
  const maxRetries = 3;

  const describeStreamStub = sinon.stub(kinesis(), 'describeStream').callsFake(() => {
    if (retryCount < maxRetries) {
      retryCount += 1;
      throw new ResourceNotFoundException({ message: 'not found', $metadata: {} });
    } else {
      return { StreamDescription: {} };
    }
  });

  try {
    const response = await Kinesis.describeStream(
      { StreamName: testStreamName },
      {
        minTimeout: 100, // only set to speed up testing
        maxTimeout: 100, // only set to speed up testing
        retries: maxRetries,
      }
    );
    t.truthy(response.StreamDescription);
  } finally {
    describeStreamStub.restore();
  }
});
