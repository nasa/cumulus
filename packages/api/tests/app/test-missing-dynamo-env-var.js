const test = require('ava');

const { MissingRequiredEnvVarError } = require('@cumulus/errors');

process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';

test.serial('index throws error if environment variable for Dynamo tables parameter name is missing', async (t) => {
  // eslint-disable-next-line global-require
  const { handler } = require('../../app');
  await t.throwsAsync(
    handler(),
    { instanceOf: MissingRequiredEnvVarError }
  );
});
