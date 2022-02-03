/* eslint-disable global-require */
const test = require('ava');

const { MissingRequiredEnvVar } = require('@cumulus/errors');
const { secretsManager } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

let handler;

test.beforeEach(() => {
  process.env.dynamoTableNamesParameterName = 'fake-param-name';
  delete require.cache[require.resolve('../../app')];
});

test.serial('handler throws error if environment variable for Dynamo tables parameter name is missing', async (t) => {
  ({ handler } = require('../../app'));
  delete process.env.dynamoTableNamesParameterName;
  await t.throwsAsync(
    handler(),
    { instanceOf: MissingRequiredEnvVar }
  );
});

test.serial('handler adds Dynamo table names from parameter to environment variables', async (t) => {
  ({ handler } = require('../../app'));
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
  await handler(
    {},
    {
      ssmClient,
      succeed: () => true,
    }
  );
  t.is(process.env.DynamoTableName, dynamoTableNames.DynamoTableName);
});

test.serial('handler sets environment variables based on configured secretsManager secret', async (t) => {
  const secretId = randomString(10);
  const returnVal = await secretsManager().createSecret({
    Name: secretId,
    SecretString: JSON.stringify({
      randomTestVal: 'randomTestVal',
    }),
  }).promise();
  console.log(returnVal);
  process.env.api_config_secret_id = secretId;
  ({ handler } = require('../../app'));

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
  await handler(
    {},
    {
      ssmClient,
      succeed: () => true,
    }
  );
  t.is(process.env.randomTestVal, 'randomTestVal');
});
