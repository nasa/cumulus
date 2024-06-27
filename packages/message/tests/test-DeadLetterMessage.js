'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const moment = require('moment');
const {
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
  isDLQRecordLike,
  getDLAKey,
} = require('../DeadLetterMessage');

test('unwrapDeadLetterCumulusMessage unwraps an SQS message', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    eventSource: 'aws:sqs',
    body: JSON.stringify(cumulusMessage),
  };
  t.deepEqual(await unwrapDeadLetterCumulusMessage(testMessage), cumulusMessage);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS States message', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    source: 'aws.states',
    detail: {
      stopDate: Date.now(),
      output: JSON.stringify(cumulusMessage),
      status: 'SUCCEEDED',
    },
  };
  const actual = await unwrapDeadLetterCumulusMessage(testMessage);
  const expected = {
    ...cumulusMessage,
    meta: { status: 'completed' },
  };
  expected.cumulus_meta.workflow_stop_time = testMessage.detail.stopDate;
  t.deepEqual(actual, expected);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS States message with only input', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    source: 'aws.states',
    detail: {
      stopDate: Date.now(),
      input: JSON.stringify(cumulusMessage),
      status: 'RUNNING',
    },
  };

  const actual = await unwrapDeadLetterCumulusMessage(testMessage);
  const expected = {
    ...cumulusMessage,
    meta: { status: 'running' },
  };
  expected.cumulus_meta.workflow_stop_time = testMessage.detail.stopDate;
  t.deepEqual(actual, expected);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS states message within an SQS record', async (t) => {
  const stopDate = Date.now();
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };

  const testStatesMessage = {
    source: 'aws.states',
    detail: {
      stopDate,
      output: JSON.stringify(cumulusMessage),
      status: 'SUCCEEDED',
    },
  };
  const testSqsMessage = {
    sourceEvent: 'aws:sqs',
    body: JSON.stringify(testStatesMessage),
  };

  const actual = await unwrapDeadLetterCumulusMessage(testSqsMessage);
  const expected = {
    ...cumulusMessage,
    meta: { status: 'completed' },
  };
  expected.cumulus_meta.workflow_stop_time = stopDate;
  t.deepEqual(actual, expected);
});

test('unwrapDeadLetterCumulusMessage returns wrapped message on error', async (t) => {
  const invalidMessage = {
    Body: 'Not a json object',
  };
  t.deepEqual(await unwrapDeadLetterCumulusMessage(invalidMessage), invalidMessage);
});

test('unwrapDeadLetterCumulusMessage returns an non-unwrappable message', async (t) => {
  const testMessage = {
    eventSource: 'aws:something-strange',
    contents: JSON.stringify({
      key: 'value',
    }),
  };
  t.deepEqual(await unwrapDeadLetterCumulusMessage(testMessage), testMessage);
});

test('isDLQRecordLike correctly filters for DLQ record shaped objects', (t) => {
  t.false(isDLQRecordLike('aaa')); // must be an object
  t.false(isDLQRecordLike({ a: 'b' })); // object must contain a body
  t.false(isDLQRecordLike({ body: '{a: "b"}' })); // object must contain an error attribute
  t.true(isDLQRecordLike({ body: '{a: "b"}', error: 'a' }));
  t.true(isDLQRecordLike({ Body: '{a: "b"}', error: 'a' }));
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

test('hoistCumulusMessageDetails returns null for details: collectionId, providerId, granules, time, error, status, executionArn, and stateMachineArn when not found', async (t) => {
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

test('hoistCumulusMessageDetails de-nests up to 3 degrees of sqsMessage nestedness with mixed "body" vs "Body', async (t) => {
  const innerBody = {
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
  };
  let message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify(innerBody),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      messageId: 'a',
      eventSource: 'aws:sqs',
      body: JSON.stringify(innerBody),
      error: 'anError',
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
      body: JSON.stringify(innerBody),
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      messageId: 'a',
      eventSource: 'aws:sqs',
      body: JSON.stringify(innerBody),
      error: 'anError',
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
        Body: JSON.stringify(innerBody),
      }),
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      messageId: 'a',
      eventSource: 'aws:sqs',
      body: JSON.stringify(innerBody),
      error: 'anError',
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
  const innerBody = {
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
  };
  const message = {
    messageId: 'a',
    eventSource: 'aws:sqs',
    body: JSON.stringify({
      body: JSON.stringify(innerBody),
      error: 'aDifferentError',
    }),
    error: 'anError',
  };
  t.deepEqual(
    await hoistCumulusMessageDetails(message),
    {
      messageId: 'a',
      eventSource: 'aws:sqs',
      body: JSON.stringify(innerBody),
      error: 'anError',
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

test('getDLAKey gets an appropriate DLA key, handling missing executionArn and time', (t) => {
  t.true(getDLAKey(
    'super-DAAC',
    {
      time: '2024-03-21T15:09:54Z',
      executionArn: 'execution',
    }
  ).startsWith('super-DAAC/dead-letter-archive/sqs/2024-03-21/execution-'));
  t.true(getDLAKey(
    'super-DAAC',
    {
      executionArn: 'execution',
    }
  ).startsWith(`super-DAAC/dead-letter-archive/sqs/${moment.utc().format('YYYY-MM-DD')}/execution-`));
  t.true(getDLAKey(
    'super-DAAC',
    {
      time: '2024-03-21T15:09:54Z',
    }
  ).startsWith('super-DAAC/dead-letter-archive/sqs/2024-03-21/unknown-'));
  t.true(getDLAKey(
    'super-DAAC',
    {
    }
  ).startsWith(`super-DAAC/dead-letter-archive/sqs/${moment.utc().format('YYYY-MM-DD')}/unknown-`));
});

test('getDLAKey keeps records unique even when identifiers are non-unique or missing', (t) => {
  t.not(getDLAKey('super-DAAC', {}), getDLAKey('super-DAAC', {}));
  t.not(
    getDLAKey('super-DAAC', {
      time: '2024-03-21T15:09:54Z',
    }),
    getDLAKey('super-DAAC', {
      time: '2024-03-21T15:09:54Z',
    })
  );
  t.not(
    getDLAKey('super-DAAC', {
      execution: 'a',
    }),
    getDLAKey('super-DAAC', {
      execution: 'a',
    })
  );
  t.not(
    getDLAKey('super-DAAC', {
      time: '2024-03-21T15:09:54Z',
      execution: 'a',
    }),
    getDLAKey('super-DAAC', {
      time: '2024-03-21T15:09:54Z',
      execution: 'a',
    })
  );
});
