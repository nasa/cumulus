const test = require('ava');
const { MissingRequiredEnvVarError } = require('@cumulus/errors');

process.env.dynamoTableNamesParameterName = 'fake-param-name';

test('handler sets environment variables based on configured secretsManager secret', async (t) => {
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
      succeed: () => true,
    }
  ), { instanceOf: MissingRequiredEnvVarError });
});
