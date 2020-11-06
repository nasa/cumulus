const test = require('ava');

const { MissingRequiredEnvVar } = require('@cumulus/errors');
const { getRequiredEnvVar } = require('../env');

test('getRequiredEnvVar returns an environment value if defined', async (t) => {
  const result = getRequiredEnvVar('testVar', { testVar: 'testvalue' });
  t.is(result, 'testvalue');
});

test('getRequiredEnvVar throws error if not defined', async (t) => {
  t.throws(
    () => getRequiredEnvVar('testVar', {}),
    { instanceOf: MissingRequiredEnvVar }
  );
});
