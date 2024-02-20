const test = require('ava');

const { secretsManager } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

process.env.dynamoTableNamesParameterName = 'fake-param-name';

test('handler throws error if secret containing environment variables cannot be parsed', async (t) => {
  process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';
  const secretId = randomString(10);
  await secretsManager().createSecret({
    Name: secretId,
    SecretString: '[}[}JSON cannot parse this',
  });
  process.env.api_config_secret_id = secretId;
  const dynamoTableNames = {
    DynamoTableName: 'prefix-dynamoTableName',
  };
  const ssmClient = {
    getParameter: () => ({
      promise: () => Promise.resolve({
        Parameter: {
          Value: JSON.stringify(dynamoTableNames),
        },
      }),
    }),
  };
  // eslint-disable-next-line global-require
  const { handler } = require('../../app');
  await t.throwsAsync(handler(
    {},
    {
      ssmClient,
    }
  ), { instanceOf: SyntaxError });
});
