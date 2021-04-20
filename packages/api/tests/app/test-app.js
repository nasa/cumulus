const test = require('ava');

const { MissingRequiredEnvVar } = require('@cumulus/errors');

const { handler } = require('../../app');

test.beforeEach(() => {
  process.env.dynamoTableNamesParameterName = 'fake-param-name';
});

test.serial('handler throws error if environment variable for Dynamo tables parameter name is missing', async (t) => {
  delete process.env.dynamoTableNamesParameterName;
  await t.throwsAsync(
    handler(),
    { instanceOf: MissingRequiredEnvVar }
  );
});

test('handler adds Dynamo table names from parameter to environment variables', async (t) => {
  const dynamoTableNames = {
    DynamoTableName: 'prefix-dynamoTableName',
  };
  const ssmClient = {
    getParameter: () => ({
      promise: async () => ({
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
