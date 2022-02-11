const test = require('ava');

const { MissingRequiredEnvVarError } = require('@cumulus/errors');
const { handler } = require('../../app');

test.serial('handler throws error if environment variable for Dynamo tables parameter name is missing', async (t) => {
  await t.throwsAsync(
    handler(),
    { instanceOf: MissingRequiredEnvVarError }
  );
});
