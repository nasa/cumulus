const test = require('ava');

const {
  encryptValueWithKMS,
  translateApiProviderToPostgresProvider,
  translatePostgresProviderToApiProvider,
} = require('../../dist/translate/providers');

test.beforeEach(() => {
  process.env.provider_kms_key_id = 'fakeKeyId';
});

test('translatePostgresProviderToApiProvider translates the expected API record', (t) => {
  const allowedRedirects = ['host-1', 'host-2'];
  const postgresProviderObject = {
    certificate_uri: 'fakeUri',
    cm_key_id: 'fakecmId',
    created_at: new Date(1234),
    global_connection_limit: 1,
    max_download_time: 100,
    host: 'fakeHost',
    name: 'testId',
    password: 'fakeEncryptedPasswordString',
    port: 1234,
    private_key: 'fakeKey',
    protocol: 'fakeProtocol',
    updated_at: new Date(5678),
    username: 'fakeEncryptedUsernameString',
    allowed_redirects: allowedRedirects,
  };

  const expected = {
    certificateUri: 'fakeUri',
    cmKeyId: 'fakecmId',
    createdAt: 1234,
    encrypted: true,
    globalConnectionLimit: 1,
    maxDownloadTime: 100,
    host: 'fakeHost',
    id: 'testId',
    password: 'fakeEncryptedPasswordString',
    port: 1234,
    privateKey: 'fakeKey',
    protocol: 'fakeProtocol',
    updatedAt: 5678,
    username: 'fakeEncryptedUsernameString',
    allowedRedirects,
  };

  const result = translatePostgresProviderToApiProvider(postgresProviderObject);
  t.deepEqual(result, expected);
});

test('translatePostgresProviderToApiProvider does not return encrypted key if username and password are not present', (t) => {
  const postgresProviderObject = {
    certificate_uri: 'fakeUri',
    cm_key_id: 'fakecmId',
    created_at: new Date(1234),
    global_connection_limit: 1,
    host: 'fakeHost',
    name: 'testId',
    port: 1234,
    private_key: 'fakeKey',
    protocol: 'fakeProtocol',
    updated_at: new Date(5678),
  };

  const expected = {
    id: 'testId',
    globalConnectionLimit: 1,
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 1234,
    createdAt: 1234,
    updatedAt: 5678,
    privateKey: 'fakeKey',
    cmKeyId: 'fakecmId',
    certificateUri: 'fakeUri',
  };

  const result = translatePostgresProviderToApiProvider(postgresProviderObject);
  t.deepEqual(result, expected);
});

test('translateApiProviderToPostgresProvider translates a Cumulus Provider object to a Postgres Provider object', async (t) => {
  const fakeEncryptFunction = (str) => Promise.resolve(`encrypted[${str}]`);
  const allowedRedirects = ['host-1', 'host-2'];
  const cumulusProviderObject = {
    id: 'testId',
    globalConnectionLimit: 1,
    maxDownloadTime: 100,
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 1234,
    username: 'fakeUsername',
    password: 'fakePassword',
    encrypted: true,
    createdAt: 1234,
    updatedAt: 5678,
    privateKey: 'fakeKey',
    cmKeyId: 'fakecmId',
    certificateUri: 'fakeUri',
    allowedRedirects,
  };

  const expected = {
    certificate_uri: 'fakeUri',
    cm_key_id: 'fakecmId',
    created_at: new Date(1234),
    global_connection_limit: 1,
    max_download_time: 100,
    host: 'fakeHost',
    name: 'testId',
    password: 'encrypted[fakePassword]',
    port: 1234,
    private_key: 'fakeKey',
    protocol: 'fakeProtocol',
    updated_at: new Date(5678),
    username: 'encrypted[fakeUsername]',
    allowed_redirects: allowedRedirects,
  };
  const result = await translateApiProviderToPostgresProvider(
    cumulusProviderObject,
    fakeEncryptFunction
  );
  t.deepEqual(result, expected);
});

test.serial('encryptValueWithKMS throws if provder_kms_key_id does not exist', async (t) => {
  await t.throwsAsync(() => encryptValueWithKMS('somevalue'));
});

test.serial('encryptValueWithKMS encrypts the key', async (t) => {
  const actual = await encryptValueWithKMS('somevalue', () => 'encrypted');
  t.is(actual, 'encrypted');
});
