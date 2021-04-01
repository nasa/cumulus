const test = require('ava');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test('handler calls startAsyncOperation', async (t) => {
  const asyncOperationStub = {
    startAsyncOperation: async () => 1,
  };
  t.is(await handler(asyncOperationStub), 1);
});
