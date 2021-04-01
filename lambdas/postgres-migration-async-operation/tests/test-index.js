const test = require('ava');
const sinon = require('sinon');
const asyncOperations = require('@cumulus/async-operations');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test('handler calls startAsyncOperation', async (t) => {
  const stub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(1);
  t.teardown(() => {
    stub.restore();
  });
  t.is(await handler(), 1);
});
