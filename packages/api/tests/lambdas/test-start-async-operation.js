'use strict';

const test = require('ava');
const sinon = require('sinon');

const asyncOperations = require('@cumulus/async-operations');
const { randomId } = require('@cumulus/common/test-utils');
const { handler } = require('../../lambdas/start-async-operation');

test.beforeEach((t) => {
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation')
    .callsFake((event) => Promise.resolve({ id: event.asyncOperationId }));
});

test.afterEach.always((t) => {
  t.context.asyncOperationStartStub.restore();
});

test.serial('start-async-operation lambda takes an event and returns async operation record', async (t) => {
  const event = { asyncOperationId: randomId('asyncOperationId') };
  const response = await handler(event);
  t.is(response.id, event.asyncOperationId);
});

test.serial('start-async-operation lambda throws error if it fails to start async operation', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').throws(
    new Error('failed to start')
  );
  const event = { asyncOperationId: randomId('asyncOperationId') };
  await t.throwsAsync(handler(event));
});
