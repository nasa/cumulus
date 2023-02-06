'use strict';

const test = require('ava');
const nock = require('nock');
const some = require('lodash/some');

const awsServices = require('@cumulus/aws-client/services');
const { CMRInternalError } = require('@cumulus/errors');

const { CMR } = require('../CMR');

test.before(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/(localhost|127.0.0.1)/);
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test.serial('CMR.searchCollection handles paging correctly.', async (t) => {
  const headers = { 'cmr-hits': 6 };
  const body1 = '{"feed":{"updated":"sometime","id":"someurl","title":"fake Cmr Results","entry":[{"cmrEntry1":"data1"}, {"cmrEntry2":"data2"}]}}';
  const body2 = '{"feed":{"updated":"anothertime","id":"another url","title":"more Results","entry":[{"cmrEntry3":"data3"}, {"cmrEntry4":"data4"}]}}';
  const body3 = '{"feed":{"updated":"more time","id":"yet another","title":"morer Results","entry":[{"cmrEntry5":"data5"}, {"cmrEntry6":"data6"}]}}';
  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/collections.json')
    .query((q) => q.page_num === '1')
    .reply(200, body1, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/collections.json')
    .query((q) => q.page_num === '2')
    .reply(200, body2, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/collections.json')
    .query((q) => q.page_num === '3')
    .reply(200, body3, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .post('/legacy-services/rest/tokens')
    .reply(200, { token: 'ABCDE' });

  const expected = [
    { cmrEntry1: 'data1' },
    { cmrEntry2: 'data2' },
    { cmrEntry3: 'data3' },
    { cmrEntry4: 'data4' },
    { cmrEntry5: 'data5' },
    { cmrEntry6: 'data6' },
  ];
  process.env.CMR_ENVIRONMENT = 'UAT';

  const cmrSearch = new CMR({
    provider: 'CUMULUS',
    clientId: 'clientId',
    username: 'username',
    password: 'password',
    token: 'abcde',
  });
  const results = await cmrSearch.searchCollections();

  t.is(expected.length, results.length);

  delete process.env.CMR_ENVIRONMENT;

  expected.forEach((expectedItem) => t.true(some(results, expectedItem)));
});

test('getWriteHeaders returns correct Content-type for UMMG metadata', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'clientID',
    username: 'username',
    password: 'password',
  });
  const ummgVersion = '1.5';
  const headers = cmrInstance.getWriteHeaders({ ummgVersion });
  t.is(headers['Content-type'], 'application/vnd.nasa.cmr.umm+json;version=1.5');
  t.is(headers.Accept, 'application/json');
});

test('getWriteHeaders returns correct Content-type for xml metadata by default', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'clientID',
    username: 'username',
    password: 'password',
  });
  const headers = cmrInstance.getWriteHeaders();
  t.is(headers['Content-type'], 'application/echo10+xml');
  t.is(headers['Client-Id'], 'clientID');
  t.is(headers.Accept, undefined);
});

test('getWriteHeaders returns Cmr-Revision-Id when provided', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'clientID',
    username: 'username',
    password: 'password',
  });
  const cmrRevisionId = '100';
  const headers = cmrInstance.getWriteHeaders({ cmrRevisionId });
  t.is(headers['Cmr-Revision-Id'], '100');
});

test('getWriteHeaders returns token for earthdata', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'earthdata',
  });

  const headers = cmrInstance.getWriteHeaders({ token: '12345' });
  t.is(headers.Authorization, '12345');
});

test('getWriteHeaders returns token for launchpad', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'launchpad',
  });

  const headers = cmrInstance.getWriteHeaders({ token: '12345' });

  t.is(headers.Authorization, '12345');
});

test('getReadHeaders returns clientId and token for earthdata', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'earthdata',
  });

  const headers = cmrInstance.getReadHeaders({ token: '12345' });
  t.is(headers['Client-Id'], 'test-client-id');
  t.is(headers.Authorization, '12345');
});

test('getReadHeaders returns clientId and token for launchpad', (t) => {
  const cmrInstance = new CMR({
    provider: 'provider',
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'launchpad',
  });

  const headers = cmrInstance.getReadHeaders({ token: '12345' });
  t.is(headers['Client-Id'], 'test-client-id');
  t.is(headers.Authorization, '12345');
});

test.serial('ingestUMMGranule() returns CMRInternalError when CMR is down', async (t) => {
  const cmrSearch = new CMR({ provider: 'my-provider', token: 'abc', clientId: 'client' });

  const ummgMetadata = { GranuleUR: 'asdf' };

  const internalError = {
    errors: [
      {
        errors: ['Internal error'],
      },
    ],
  };

  process.env.CMR_ENVIRONMENT = 'SIT';

  nock('https://cmr.sit.earthdata.nasa.gov')
    .put(`/ingest/providers/${cmrSearch.provider}/granules/${ummgMetadata.GranuleUR}`)
    .times(3)
    .reply(503, internalError);

  await t.throwsAsync(
    () => cmrSearch.ingestUMMGranule(ummgMetadata),
    { instanceOf: CMRInternalError }
  );
});

test.serial('ingestUMMGranule() throws an exception if the input fails validation', async (t) => {
  const cmrSearch = new CMR({ provider: 'my-provider', token: 'abc', clientId: 'client' });

  const ummgMetadata = { GranuleUR: 'asdf' };

  const ummValidationError = {
    errors: [
      {
        path: ['Temporal'],
        errors: ['oh snap'],
      },
    ],
  };

  process.env.CMR_ENVIRONMENT = 'SIT';

  nock('https://cmr.sit.earthdata.nasa.gov')
    .put(`/ingest/providers/${cmrSearch.provider}/granules/${ummgMetadata.GranuleUR}`)
    .reply(422, ummValidationError);

  await t.throwsAsync(
    () => cmrSearch.ingestUMMGranule(ummgMetadata),
    {
      name: 'Error',
      message: 'Failed to ingest, statusCode: 422, statusMessage: Unprocessable Entity, CMR error message: [{"path":["Temporal"],"errors":["oh snap"]}]',
    }
  );
});

test('getCmrPassword returns the set password if no secret exists', async (t) => {
  const cmr = new CMR({ password: 'test-password' });

  t.is(await cmr.getCmrPassword(), 'test-password');
});

test('getCmrPassword returns password from AWS secret when set', async (t) => {
  // Store the CMR password
  const secretName = 'secret-name';
  await awsServices.secretsManager().createSecret({
    Name: secretName,
    SecretString: 'secretString',
  }).promise();

  try {
    const cmr = new CMR({ passwordSecretName: secretName, password: 'cmr-password' });

    t.is(await cmr.getCmrPassword(), 'secretString');
  } finally {
    await awsServices.secretsManager().deleteSecret({
      SecretId: secretName,
      ForceDeleteWithoutRecovery: true,
    }).promise();
  }
});

test('getToken returns a token when the user\'s token is provided', async (t) => {
  const cmrObj = new CMR({
    provider: 'CUMULUS',
    clientId: 'clientId',
    username: 'username',
    password: 'password',
    token: 'abcde',
  });

  t.is(await cmrObj.getToken(), 'abcde');
});
