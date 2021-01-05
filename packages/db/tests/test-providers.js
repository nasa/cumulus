/* eslint-disable unicorn/no-null */
const test = require('ava');

const {
  nullifyUndefinedProviderValues,
} = require('../dist/provider');

test('nullifyUndefinedProviderValues sets undefined provider values to "null"', async (t) => {
  const cumulusProviderObject = {
    name: 'fakeName',
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 'fakePort',
  };

  const expected = {
    name: 'fakeName',
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 'fakePort',
    username: null,
    password: null,
    global_connection_limit: null,
    private_key: null,
    cm_key_id: null,
    certificate_uri: null,
  };

  const actual = nullifyUndefinedProviderValues(cumulusProviderObject);
  t.deepEqual(actual, expected);
});

