'use strict';

const test = require('ava');
const { handler } = require('..');

test('handler returns immediately on non-create event', async (t) => {
  const event = {
    Records: [{
      eventName: 'ObjectRemoved:Delete',
    }],
  };
  const output = await handler(event, {});
  t.deepEqual(output, [null]);
});

test('handler skips records created before a given date', async (t) => {
  const event = {
    Records: [
      {
        eventName: 'ObjectCreated:*',
        s3: {
          bucket: {
            name: "bucket-name",
          },
          object: {
            key: 'test-cumulus-prod/ems-distribution/s3-server-access-logs/2023-09-29-22-29-57-D1FC2703AD3288C8'
          }
        }
      },

    ],
  };
  const output = await handler(event, {});
  t.deepEqual(output, [null]);
});
