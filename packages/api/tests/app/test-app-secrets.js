const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

let secretId;
const secretString = JSON.stringify({ testKey: 'testVal' });

test.before(async () => {
  process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';
  secretId = randomString(10);
  await awsServices.secretsManager().createSecret({
    Name: secretId,
    SecretString: secretString,
  });
  process.env.api_config_secret_id = secretId;
});

test.after.always(async () => {
  delete process.env.INIT_ENV_VARS_FUNCTION_TEST;
  await awsServices.secretsManager().deleteSecret({
    SecretId: secretId,
    ForceDeleteWithoutRecovery: true,
  });
});

test.serial('secretsManager is not called at module load time and called once for multiple invocations', async (t) => {
  const stub = sinon.stub(awsServices, 'secretsManager');
  const fakeClient = {
    getSecretValue: sinon.stub().resolves({
      SecretString: secretString,
    }),
  };
  stub.returns(fakeClient);

  // eslint-disable-next-line global-require
  const { handler } = require('../../app');

  // since secretsManager is now called within the handler and not during module load
  // which is done on line 38 above, there should be no calls to secretsManager until
  // the handler itself is called
  t.is(fakeClient.getSecretValue.callCount, 0);
  process.env.dynamoTableNameString = '{}';
  await handler({});

  // calling handler again to make sure the initPromise cache is working and
  // secretsManager itself is not called again
  await handler({});
  await handler({});

  // since the handler ran, there should be one call to secretsManager, even if it
  // ran multiple times, the initPromise cache should prevent multiple calls to secretsManager
  t.is(fakeClient.getSecretValue.callCount, 1);
  t.teardown(() => stub.restore());
});
