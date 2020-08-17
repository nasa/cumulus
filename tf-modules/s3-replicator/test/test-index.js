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
