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
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      time: 'atime',
      detail: {
        status: 'SUCCEEDED',
        output: JSON.stringify({
          meta: { collection: { name: 'aName' } },
          payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
        }),
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
      },
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      ...message,
      collection: 'aName',
      granules: ['a', 'b'],
      execution: 'execArn',
      stateMachine: 'SMArn',
      status: 'SUCCEEDED',
      time: 'atime',
    }
  );
});

test('hoistCumulusMessageDetails returns unknown for details: collection, granules, execution, and stateMachine when not found', async (t) => {
  const messages = [
    {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'aName',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['a', 'b'],
        time: 'aTime',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'aName',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['a', 'b'],
        time: 'unknown',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ a: 'b' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ a: 'b' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'aName',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['unknown', 'b'],
        time: 'aTime',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'unknown',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['unknown'],
        time: 'aTime',
        status: 'unknown',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: ['abcd'] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: ['abcd'] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'aName',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['unknown'],
        time: 'aTime',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: {} },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: {} },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'unknown',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['a', 'b'],
        time: 'aTime',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collection: 'aName',
        execution: 'unknown',
        stateMachine: 'SMArn',
        granules: ['a', 'b'],
        time: 'aTime',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
          },
        }),
        error: 'anError',
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
          },
        }),
        error: 'anError',
        collection: 'aName',
        execution: 'execArn',
        stateMachine: 'unknown',
        granules: ['a', 'b'],
        time: 'aTime',
        status: 'SUCCEEDED',

      },
    }, {
      mangled: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
      },
      expected: {
        messageId: 'a',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          time: 'aTime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: { collection: { name: 'aName' } },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'unknown',
        collection: 'aName',
        execution: 'execArn',
        stateMachine: 'SMArn',
        granules: ['a', 'b'],
        time: 'aTime',
        status: 'SUCCEEDED',

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
