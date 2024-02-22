'use strict';

const uuidv4 = require('uuid/v4');
const test = require('ava');

const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  handler,
  hoistCumulusMessageDetails,
} = require('../../lambdas/write-db-dlq-records-to-s3.js');

test.before(async (t) => {
  t.context.bucket = randomString();
  await S3.createBucket(t.context.bucket);
  process.env.stackName = randomString();
  process.env.system_bucket = t.context.bucket;
});

test.after(async (t) => {
  delete process.env.system_bucket;
  delete process.env.stackName;
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test.serial('write-db-dlq-records-to-s3 puts one file on S3 per SQS message', async (t) => {
  const message1Name = randomString(12);
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message1Name },
    }),
  };
  const message2Name = randomString(12);
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message2Name },
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${message1Name}`,
  })).length, 1);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${message2Name}`,
  })).length, 1);
});

test.serial('write-db-dlq-records-to-s3 keeps all messages from identical execution', async (t) => {
  const messageName = randomString(12);
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: messageName },
    }),
  };
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: messageName },
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${messageName}`,
  })).length, 2);
});

test.serial('write-db-dlq-records-to-s3 throws error if stackName is not defined', async (t) => {
  delete process.env.stackName;
  await t.throwsAsync(
    handler({}),
    { message: 'Could not determine archive path as stackName env var is undefined.' }
  );
});

test.serial('write-db-dlq-records-to-s3 throws error if system bucket is not defined', async (t) => {
  delete process.env.system_bucket;
  await t.throwsAsync(
    handler({}),
    { message: 'System bucket env var is required.' }
  );
});

test('hoistCumulusMessageDetails returns input message intact', async (t) => {
  const message = {
    a: 'b',
  };
  t.like(await hoistCumulusMessageDetails(message), message);
});

test('hoistCumulusMessageDetails returns details: collection, granules, execution, and stateMachine as found moved to top layer', async (t) => {
  const message = {
    error: 'anError',
    detail: {
      status: 'SUCCEEDED',
      output: JSON.stringify({
        meta: { collection: { name: 'aName' } },
        payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
      }),
      executionArn: 'execArn',
      stateMachineArn: 'SMArn',
    },
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      ...message,
      collection: 'aName',
      granules: ['a', 'b'],
      execution: 'execArn',
      stateMachine: 'SMArn',
    }
  );
});

test('hoistCumulusMessageDetails returns unknown for details: collection, granules, execution, and stateMachine when not found', async (t) => {
  const messages = [
    {
      mangled: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      },
      expected: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
        collection: 'aName',
        granules: ['a', 'b'],
        execution: 'execArn',
        stateMachine: 'SMArn',
      },
    }, {
      mangled: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      },
      expected: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
        collection: 'unknown',
        granules: ['a', 'b'],
        execution: 'execArn',
        stateMachine: 'SMArn',
      },
    }, {
      mangled: {
        error: 'anError',
        detail: {
          status: 'RUNNING',
          input: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ a: 'b' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      },
      expected: {
        error: 'anError',
        detail: {
          status: 'RUNNING',
          input: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ a: 'b' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
        collection: 'aName',
        granules: ['unknown', 'b'],
        execution: 'execArn',
        stateMachine: 'SMArn',
      },
    }, {
      mangled: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      },
      expected: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
        collection: 'aName',
        granules: ['b'],
        execution: 'execArn',
        stateMachine: 'SMArn',
      },
    }, {
      mangled: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: 'a' },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      },
      expected: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: 'a' },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
        collection: 'aName',
        granules: 'unknown',
        execution: 'execArn',
        stateMachine: 'SMArn',
      },
    }, {
      mangled: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
        },
      },
      expected: {
        error: 'anError',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: { collection: { name: 'aName' } },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
        },
        collection: 'aName',
        granules: ['a', 'b'],
        execution: 'execArn',
        stateMachine: 'unknown',
      },
    },
  ];
  const results = await Promise.all(
    messages.map((message) => hoistCumulusMessageDetails(message.mangled))
  );
  results.forEach((result, index) => {
    t.deepEqual(result, messages[index].expected);
  });
});
