const test = require('ava');
const { randomId } = require('@cumulus/common/test-utils');
const { ssm } = require('../services');
const SSM = require('../SSM');

test('getParameterValue() returns the value of an SSM parameter', async (t) => {
  const Name = randomId('parameter');
  await ssm().putParameter({ Name, Type: 'String', Value: 'some-value' });

  t.is(await SSM.getParameterValue(Name), 'some-value');
});

test('getParameterValue() returns the raw comma-separated value of a StringList parameter', async (t) => {
  const Name = randomId('parameter');
  await ssm().putParameter({ Name, Type: 'StringList', Value: 'one,two' });

  t.is(await SSM.getParameterValue(Name), 'one,two');
});

test('getParameterValue() throws ParameterNotFound if the parameter does not exist', async (t) => {
  await t.throwsAsync(
    SSM.getParameterValue(randomId('nonexistent-parameter')),
    { name: 'ParameterNotFound' }
  );
});
