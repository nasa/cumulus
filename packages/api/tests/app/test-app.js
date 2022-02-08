const test = require('ava');

const { MissingRequiredEnvVarError } = require('@cumulus/errors');
const { handler } = require('../../app');

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
