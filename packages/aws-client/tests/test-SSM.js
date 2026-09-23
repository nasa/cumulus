const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { ssm } = require('../services');
const SSM = require('../SSM');

const randomString = () => cryptoRandomString({ length: 10 });

test('getParameterValue() returns the value of an SSM parameter', async (t) => {
  const Name = randomString();
  await ssm().putParameter({ Name, Type: 'String', Value: 'some-value' });

  t.is(await SSM.getParameterValue(Name), 'some-value');
});

test('getParameterValue() returns the raw comma-separated value of a StringList parameter', async (t) => {
  const Name = randomString();
  await ssm().putParameter({ Name, Type: 'StringList', Value: 'one,two' });

  t.is(await SSM.getParameterValue(Name), 'one,two');
});

test('getParameterValue() throws ParameterNotFound if the parameter does not exist', async (t) => {
  await t.throwsAsync(
    SSM.getParameterValue(randomString()),
    { name: 'ParameterNotFound' }
  );
});
