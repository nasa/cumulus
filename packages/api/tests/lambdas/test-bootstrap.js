const test = require('ava');
const sinon = require('sinon');

const { handler } = require('../../lambdas/bootstrap');

test('handler calls bootstrapFunction with expected values', async (t) => {
  const bootstrapFunctionStub = sinon.stub();
  const testContext = {
    bootstrapFunction: bootstrapFunctionStub,
  };

  const hostName = 'fakehost';

  const actual = await handler({
    testContext,
    removeAliasConflict: true,
    elasticsearchHostname: hostName,
  });

  t.deepEqual(actual, { Data: {}, Status: 'SUCCESS' });
  t.true(bootstrapFunctionStub.calledWith({
    host: hostName,
    removeAliasConflict: true,
  }));
});

test('handler throws with error/status on bootstrap function failure', async (t) => {
  const errorMessage = 'Fake Error';
  const bootstrapFunctionStub = () => {
    throw new Error(errorMessage);
  };
  const testContext = {
    bootstrapFunction: bootstrapFunctionStub,
  };

  const hostName = 'fakehost';

  await t.throwsAsync(handler({
    testContext,
    removeAliasConflict: true,
    elasticsearchHostname: hostName,
  }), { message: errorMessage });
});
