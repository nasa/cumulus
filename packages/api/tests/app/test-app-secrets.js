const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

let secretId;

test.before(async () => {
  process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';
  secretId = randomString(10);
  await awsServices.secretsManager().createSecret({
    Name: secretId,
    SecretString: 'secretString',
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
  const spy = sinon.spy(awsServices.secretsManager(), 'getSecretValue');
  // eslint-disable-next-line global-require
  const { handler } = require('../../app');

  try {
    // since secretsManager is now called within the handler and not during module load
    // there should be no calls to secretsManager until the handler itself is called
    t.is(spy.callCount, 0);
    process.env.dynamoTableNameString = JSON.stringify({});
    await handler({});
    // calling handler again to make sure the initPromise cache is working and
    // secretsManager itself is not called again
    await handler({});
  } catch (error) {
    t.not(error.name, 'InvalidSignatureException');
    t.false((error.message || '').includes('Signature expired'));
  } finally {
    // since the handler ran, there should be one call to secretsManager, even if it
    // ran multiple times, the initPromise cache should prevent multiple calls to secretsManager
    t.is(spy.callCount, 1);
    spy.restore();
  }
});
