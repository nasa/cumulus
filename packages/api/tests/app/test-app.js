const test = require('ava');

const { MissingRequiredEnvVarError } = require('@cumulus/errors');
const { secretsManager } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

test.before(async (t) => {
  const secretId = randomString(10);
  await secretsManager().createSecret({
    Name: secretId,
    SecretString: JSON.stringify({
      randomTestVal: 'randomTestVal',
    }),
  }).promise();
  process.env.api_config_secret_id = secretId;
  // eslint-disable-next-line global-require
  const { handler } = require('../../app');
  t.context.handler = handler;
});

test.beforeEach(() => {
  process.env.dynamoTableNamesParameterName = 'fake-param-name';
});

test.serial('handler throws error if environment variable for Dynamo tables parameter name is missing', async (t) => {
  delete process.env.dynamoTableNamesParameterName;
  await t.throwsAsync(
    t.context.handler(),
    { instanceOf: MissingRequiredEnvVarError }
  );
});

test.serial('handler adds Dynamo table names from parameter to environment variables', async (t) => {
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
  t.falsy(process.env.DynamoTableName);
  await t.context.handler(
    {},
    {
      ssmClient,
    }
  );
  t.is(process.env.DynamoTableName, dynamoTableNames.DynamoTableName);
});
