const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const { MissingRequiredEnvVar } = require('@cumulus/errors');


test.serial('index throws error if environment variable for Dynamo tables parameter name is missing', async (t) => {
  const { handler } = require('../../app');
  await t.throwsAsync(
    handler(),
    { instanceOf: MissingRequiredEnvVar }
  );
});