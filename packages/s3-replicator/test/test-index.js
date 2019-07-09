const test = require('ava');

const { handler } = require('../index');

test('handler returns immediately on non-create event', async (t) => {
  const event = {
    Records: [{
      eventName: "ObjectRemoved:Delete"
    }]
  }
  const output = await handler(event, {});
  t.is(output, null);
});
