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
      time: '2024-03-11T18:58:27Z',
    }),
  };
  const message2Name = randomString(12);
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message2Name },
      time: '2024-03-12T18:58:27Z',
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024/3/11/18/${message1Name}`,
  })).length, 1);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024/3/12/18/${message2Name}`,
  })).length, 1);
});

test.serial('write-db-dlq-records-to-s3 keeps all messages from identical execution', async (t) => {
  const messageName = randomString(12);
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: messageName },
      time: '2024-03-11T18:58:27Z',
    }),
  };
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: messageName },
      time: '2024-03-11T18:58:27Z',
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024/3/11/18/${messageName}`,
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

test('hoistCumulusMessageDetails returns details: collectionId, providerId, granules, time, error, status, executionArn, and stateMachineArn as found moved to top layer', async (t) => {
  const message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      time: 'atime',
      detail: {
        status: 'SUCCEEDED',
        output: JSON.stringify({
          meta: {
            collection: { name: 'aName', version: '12' },
            provider: {
              id: 'abcd',
              protocol: 'cheesy',
              host: 'excellent',
            },
          },
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
      collectionId: 'aName___12',
      providerId: 'abcd',
      granules: ['a', 'b'],
      executionArn: 'execArn',
      stateMachineArn: 'SMArn',
      status: 'SUCCEEDED',
      time: 'atime',
    }
  );
});

test('hoistCumulusMessageDetails returns unknown for details: collectionId, providerId, granules, time, error, status, executionArn, and stateMachineArn when not found', async (t) => {
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
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
            output: JSON.stringify({
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: null,
        providerId: null,
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
        granules: null,
        time: 'aTime',
        status: null,
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
              meta: {
                collection: { name: 'aName' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: null,
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
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
              meta: {
                collection: { name: 'aName', version: '12' },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: null,
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: null,
        stateMachineArn: 'SMArn',
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: null,
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: null,
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { a: 'b' }] },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { a: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
        granules: ['a', null],
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { ss: [{ granuleId: 'a' }, { granuleId: 'b' }] },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { ss: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
        granules: null,
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
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
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
        error: 'anError',
        collectionId: 'aName___12',
        providerId: 'abcd',
        executionArn: 'execArn',
        stateMachineArn: 'SMArn',
        granules: ['a', 'b'],
        time: null,
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

test('hoistCumulusMessageDetails handles up to 3 degrees of sqsMessage nestedness', async (t) => {
  let message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      time: 'atime',
      detail: {
        status: 'SUCCEEDED',
        output: JSON.stringify({
          meta: {
            collection: { name: 'aName', version: '12' },
            provider: {
              id: 'abcd',
              protocol: 'cheesy',
              host: 'excellent',
            },
          },
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
      providerId: 'abcd',
      collectionId: 'aName___12',
      granules: ['a', 'b'],
      executionArn: 'execArn',
      stateMachineArn: 'SMArn',
      status: 'SUCCEEDED',
      time: 'atime',
    }
  );
  message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      body: JSON.stringify({
        time: 'atime',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: {
              collection: { name: 'aName', version: '12' },
              provider: {
                id: 'abcd',
                protocol: 'cheesy',
                host: 'excellent',
              },
            },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      }),
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      ...message,
      providerId: 'abcd',
      collectionId: 'aName___12',
      granules: ['a', 'b'],
      executionArn: 'execArn',
      stateMachineArn: 'SMArn',
      status: 'SUCCEEDED',
      time: 'atime',
    }
  );
  message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      body: JSON.stringify({
        Body: JSON.stringify({
          time: 'atime',
          detail: {
            status: 'SUCCEEDED',
            output: JSON.stringify({
              meta: {
                collection: { name: 'aName', version: '12' },
                provider: {
                  id: 'abcd',
                  protocol: 'cheesy',
                  host: 'excellent',
                },
              },
              payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
            }),
            executionArn: 'execArn',
            stateMachineArn: 'SMArn',
          },
        }),
      }),
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      ...message,
      providerId: 'abcd',
      collectionId: 'aName___12',
      granules: ['a', 'b'],
      executionArn: 'execArn',
      stateMachineArn: 'SMArn',
      status: 'SUCCEEDED',
      time: 'atime',
    }
  );
});

test('hoistCumulusMessageDetails captures outermost error as "error"', async (t) => {
  const message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      body: JSON.stringify({
        time: 'atime',
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify({
            meta: {
              collection: { name: 'aName', version: '12' },
              provider: {
                id: 'abcd',
                protocol: 'cheesy',
                host: 'excellent',
              },
            },
            payload: { granules: [{ granuleId: 'a' }, { granuleId: 'b' }] },
          }),
          executionArn: 'execArn',
          stateMachineArn: 'SMArn',
        },
      }),
      error: 'aDifferentError',
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      ...message,
      providerId: 'abcd',
      collectionId: 'aName___12',
      granules: ['a', 'b'],
      executionArn: 'execArn',
      stateMachineArn: 'SMArn',
      status: 'SUCCEEDED',
      time: 'atime',
    }
  );
});
