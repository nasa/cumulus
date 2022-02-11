const test = require('ava');

const { secretsManager } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

test.beforeEach(() => {
  process.env.dynamoTableNamesParameterName = 'fake-param-name';
});

test('handler sets environment variables based on configured secretsManager secret', async (t) => {
  process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';
  const secretId = randomString(10);
  await secretsManager().createSecret({
    Name: secretId,
    SecretString: JSON.stringify({
      randomTestVal: 'randomTestVal',
      dynamoTableNameString: JSON.stringify({}),
    }),
  }).promise();
  process.env.api_config_secret_id = secretId;

  // eslint-disable-next-line global-require
  const { handler } = require('../../app');
  await handler({});
  t.is(process.env.randomTestVal, 'randomTestVal');
});
