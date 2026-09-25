'use strict';

const test = require('ava');
const nock = require('nock');
const some = require('lodash/some');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const launchpad = require('@cumulus/launchpad-auth');
const { CMRInternalError } = require('@cumulus/errors');

const { CMR } = require('../CMR');

const PROVIDER = 'CUMULUS';

test.before(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/(localhost|127.0.0.1)/);
});

test.afterEach.always(() => {
  CMR.resetInstance();
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

  const cmrSearch = CMR.getInstance({
    clientId: 'clientId',
    username: 'username',
    password: 'password',
    token: 'abcde',
  });
  const results = await cmrSearch.searchCollections({}, PROVIDER);

  t.is(expected.length, results.length);

  delete process.env.CMR_ENVIRONMENT;

  expected.forEach((expectedItem) => t.true(some(results, expectedItem)));
});

test.serial('getWriteHeaders returns correct Content-type for UMMG metadata', (t) => {
  const cmrInstance = CMR.getInstance({
    clientId: 'clientID',
    username: 'username',
    password: 'password',
  });
  const ummgVersion = '1.5';
  const headers = cmrInstance.getWriteHeaders({ ummgVersion });
  t.is(headers['Content-type'], 'application/vnd.nasa.cmr.umm+json;version=1.5');
  t.is(headers.Accept, 'application/json');
});

test.serial('getWriteHeaders returns correct Content-type for xml metadata by default', (t) => {
  const cmrInstance = CMR.getInstance({
    clientId: 'clientID',
    username: 'username',
    password: 'password',
  });
  const headers = cmrInstance.getWriteHeaders();
  t.is(headers['Content-type'], 'application/echo10+xml');
  t.is(headers['Client-Id'], 'clientID');
  t.is(headers.Accept, undefined);
});

test.serial('getWriteHeaders returns Cmr-Revision-Id when provided', (t) => {
  const cmrInstance = CMR.getInstance({
    clientId: 'clientID',
    username: 'username',
    password: 'password',
  });
  const cmrRevisionId = '100';
  const headers = cmrInstance.getWriteHeaders({ cmrRevisionId });
  t.is(headers['Cmr-Revision-Id'], '100');
});

test.serial('getWriteHeaders returns token for earthdata', (t) => {
  const cmrInstance = CMR.getInstance({
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'earthdata',
  });

  const headers = cmrInstance.getWriteHeaders({ token: '12345' });
  t.is(headers.Authorization, '12345');
});

test.serial('getWriteHeaders returns token for launchpad', (t) => {
  const cmrInstance = CMR.getInstance({
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'launchpad',
  });

  const headers = cmrInstance.getWriteHeaders({ token: '12345' });

  t.is(headers.Authorization, '12345');
});

test.serial('getReadHeaders returns clientId and token for earthdata', (t) => {
  const cmrInstance = CMR.getInstance({
    clientId: 'test-client-id',
    username: 'username',
    password: 'password',
    oauthProvider: 'earthdata',
  });

  const headers = cmrInstance.getReadHeaders({ token: '12345' });
  t.is(headers['Client-Id'], 'test-client-id');
  t.is(headers.Authorization, '12345');
});

test.serial('getReadHeaders returns clientId and token for launchpad', (t) => {
  const cmrInstance = CMR.getInstance({
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
  process.env.CMR_RETRIES = '0';
  t.teardown(() => delete process.env.CMR_RETRIES);

  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;

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
    .put(`/ingest/providers/${provider}/granules/${ummgMetadata.GranuleUR}`)
    .times(3)
    .reply(503, internalError);

  const error = await t.throwsAsync(
    () => cmrSearch.ingestUMMGranule(ummgMetadata, provider),
    { name: 'CMRCallFailedError' }
  );

  t.true(error.cause instanceof CMRInternalError);
});

test.serial('ingestUMMGranule() throws an exception if the input fails validation', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;

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
    .put(`/ingest/providers/${provider}/granules/${ummgMetadata.GranuleUR}`)
    .reply(422, ummValidationError);

  const error = await t.throwsAsync(
    () => cmrSearch.ingestUMMGranule(ummgMetadata, provider),
    { name: 'CMRCallFailedError' }
  );

  t.is(
    error.cause.message,
    'Failed to ingest, statusCode: 422, statusMessage: Unprocessable Entity, CMR error message: [{"path":["Temporal"],"errors":["oh snap"]}]'
  );
});

test.serial('ingestUMMGranule retries on 401 without refreshing the launchpad token', async (t) => {
  process.env.CMR_RETRIES = '1';
  t.teardown(() => delete process.env.CMR_RETRIES);

  const cmrSearch = CMR.getInstance({
    oauthProvider: 'launchpad',
    token: 'invalid-token',
    clientId: 'client',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });
  const provider = PROVIDER;

  const refreshStub = sinon.stub(cmrSearch, 'checkRefreshLaunchpadToken');
  t.teardown(() => refreshStub.restore());

  const ummgMetadata = { GranuleUR: 'asdf' };
  const successBody = { 'concept-id': 'G123-CUMULUS' };

  process.env.CMR_ENVIRONMENT = 'SIT';

  nock('https://cmr.sit.earthdata.nasa.gov')
    .put(`/ingest/providers/${provider}/granules/${ummgMetadata.GranuleUR}`)
    .reply(401, { errors: ['Unauthorized'] });

  nock('https://cmr.sit.earthdata.nasa.gov')
    .put(`/ingest/providers/${provider}/granules/${ummgMetadata.GranuleUR}`)
    .reply(200, successBody);

  const result = await cmrSearch.ingestUMMGranule(ummgMetadata, provider);

  t.deepEqual(result, successBody);
  t.false(refreshStub.called);
  t.true(nock.isDone());
});

test.serial('ingestCollection sends a PUT request and returns the CMR response', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;
  const xml = '<Collection><DataSetId>collection1</DataSetId></Collection>';

  process.env.CMR_ENVIRONMENT = 'SIT';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);

  nock('https://cmr.sit.earthdata.nasa.gov')
    .put('/ingest/providers/CUMULUS/collections/collection1')
    .reply(200, '<result><concept-id>C123-CUMULUS</concept-id></result>');

  const result = await cmrSearch.ingestCollection(xml, provider);

  t.is(result.result['concept-id'], 'C123-CUMULUS');
  t.true(nock.isDone());
});

test.serial('ingestGranule sends a PUT request and returns the CMR response', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;
  const xml = '<Granule><GranuleUR>granule1</GranuleUR></Granule>';

  process.env.CMR_ENVIRONMENT = 'SIT';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);

  nock('https://cmr.sit.earthdata.nasa.gov')
    .put('/ingest/providers/CUMULUS/granules/granule1')
    .reply(200, '<result><concept-id>G123-CUMULUS</concept-id></result>');

  const result = await cmrSearch.ingestGranule(xml, provider);

  t.is(result.result['concept-id'], 'G123-CUMULUS');
  t.true(nock.isDone());
});

test.serial('deleteCollection sends a DELETE request and returns the CMR response', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;

  process.env.CMR_ENVIRONMENT = 'SIT';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);

  nock('https://cmr.sit.earthdata.nasa.gov')
    .delete('/ingest/providers/CUMULUS/collections/collection1')
    .reply(200, '<result><concept-id>C123-CUMULUS</concept-id></result>');

  const result = await cmrSearch.deleteCollection('collection1', provider);

  t.is(result.result['concept-id'], 'C123-CUMULUS');
  t.true(nock.isDone());
});

test.serial('deleteGranule sends a DELETE request and returns the CMR response', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;

  process.env.CMR_ENVIRONMENT = 'SIT';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);

  nock('https://cmr.sit.earthdata.nasa.gov')
    .delete('/ingest/providers/CUMULUS/granules/granule1')
    .reply(200, '<result><concept-id>G123-CUMULUS</concept-id></result>');

  const result = await cmrSearch.deleteGranule('granule1', provider);

  t.is(result.result['concept-id'], 'G123-CUMULUS');
  t.true(nock.isDone());
});

test.serial('searchGranules returns parsed granule entries', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const provider = PROVIDER;
  const body = JSON.stringify({
    feed: {
      updated: 'sometime',
      id: 'someurl',
      title: 'fake Cmr Results',
      entry: [{ granuleEntry: 'data1' }],
    },
  });

  process.env.CMR_ENVIRONMENT = 'UAT';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.json')
    .query((q) => q.page_num === '1')
    .reply(200, body, { 'cmr-hits': 1 });

  const results = await cmrSearch.searchGranules({}, provider);

  t.deepEqual(results, [{ granuleEntry: 'data1' }]);
});

test.serial('getGranuleMetadata returns parsed granule metadata from a concept link', async (t) => {
  const cmrSearch = CMR.getInstance({ oauthProvider: 'launchpad', token: 'abc', clientId: 'client' });
  const conceptId = 'G123-CUMULUS';
  const body = { GranuleUR: 'granule1' };

  nock('https://cmr.example.com')
    .get(`/search/concepts/${conceptId}.json`)
    .reply(200, JSON.stringify(body));

  const result = await cmrSearch.getGranuleMetadata(`https://cmr.example.com/search/concepts/${conceptId}.xml`);

  t.deepEqual(result, body);
});

test.serial('getCmrPassword returns the set password if no secret exists', async (t) => {
  const cmr = CMR.getInstance({ password: 'test-password' });

  t.is(await cmr.getCmrPassword(), 'test-password');
});

test.serial('getCmrPassword throws if no password or secret is set', async (t) => {
  const cmr = CMR.getInstance({});

  await t.throwsAsync(
    () => cmr.getCmrPassword(),
    { message: 'No CMR password set' }
  );
});

test.serial('getCmrPassword returns password from AWS secret when set', async (t) => {
  // Store the CMR password
  const secretName = 'secret-name';
  await awsServices.secretsManager().createSecret({
    Name: secretName,
    SecretString: 'secretString',
  });

  try {
    const cmr = CMR.getInstance({ passwordSecretName: secretName, password: 'cmr-password' });

    t.is(await cmr.getCmrPassword(), 'secretString');
  } finally {
    await awsServices.secretsManager().deleteSecret({
      SecretId: secretName,
      ForceDeleteWithoutRecovery: true,
    });
  }
});

test.serial('getToken returns a token when the user\'s token is provided', async (t) => {
  const cmrObj = CMR.getInstance({
    clientId: 'clientId',
    username: 'username',
    password: 'password',
    token: 'abcde',
  });

  t.is(await cmrObj.getToken(), 'abcde');
});

test.serial('getToken throws if no username is provided when using Earthdata Login', async (t) => {
  const cmrObj = CMR.getInstance({
    clientId: 'clientId',
    password: 'password',
    oauthProvider: 'earthdata',
  });

  await t.throwsAsync(
    () => cmrObj.getToken(),
    { message: 'Username not specified for non-launchpad CMR client' }
  );
});

test.serial('withCmrLaunchpadTokenRefreshRetry does not retry for non-launchpad clients', async (t) => {
  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'earthdata',
    username: 'username',
    password: 'password',
  });

  const refreshSpy = sinon.spy(cmr, 'checkRefreshLaunchpadToken');
  t.teardown(() => refreshSpy.restore());

  const operation = sinon.stub().resolves('result');

  const result = await cmr.withCmrLaunchpadTokenRefreshRetry(operation);

  t.is(result, 'result');
  t.is(operation.callCount, 1);
  t.false(refreshSpy.called);
});

test.serial('withCmrLaunchpadTokenRefreshRetry does not retry when CMR_RETRIES is 0', async (t) => {
  process.env.CMR_RETRIES = '0';
  t.teardown(() => delete process.env.CMR_RETRIES);
  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'some-token',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });

  const refreshSpy = sinon.spy(cmr, 'checkRefreshLaunchpadToken');
  t.teardown(() => refreshSpy.restore());

  const operation = sinon.stub().rejects(
    Object.assign(new Error('Bad Request'), { statusCode: 400 })
  );

  await t.throwsAsync(
    () => cmr.withCmrLaunchpadTokenRefreshRetry(operation),
    { name: 'CMRCallFailedError' }
  );

  t.is(operation.callCount, 1);
  t.false(refreshSpy.called);
});

test.serial('withCmrLaunchpadTokenRefreshRetry wraps a first-attempt failure', async (t) => {
  process.env.CMR_RETRIES = '0';
  t.teardown(() => delete process.env.CMR_RETRIES);
  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'invalid-token',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });

  const refreshStub = sinon.stub(cmr, 'checkRefreshLaunchpadToken');
  t.teardown(() => refreshStub.restore());

  const unauthorizedError = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  const operation = sinon.stub().rejects(unauthorizedError);

  const error = await t.throwsAsync(() => cmr.withCmrLaunchpadTokenRefreshRetry(operation), {
    name: 'CMRCallFailedError',
  });

  t.is(operation.callCount, 1);
  t.false(refreshStub.called);
  t.is(error.cause, unauthorizedError);
});

test.serial('withCmrLaunchpadTokenRefreshRetry retries errors the configured number of times without refreshing the launchpad token', async (t) => {
  process.env.CMR_RETRIES = '1';
  t.teardown(() => delete process.env.CMR_RETRIES);
  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'invalid-token',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });

  const refreshStub = sinon.stub(cmr, 'checkRefreshLaunchpadToken').resolves();
  t.teardown(() => refreshStub.restore());

  const operation = sinon.stub();
  operation.onFirstCall().rejects(Object.assign(new Error('Internal Server Error'), { statusCode: 500 }));
  operation.onSecondCall().resolves('success');

  const result = await cmr.withCmrLaunchpadTokenRefreshRetry(operation);

  t.is(result, 'success');
  t.is(operation.callCount, 2);
  t.false(refreshStub.called);
});

test.serial('withCmrLaunchpadTokenRefreshRetry wraps an exhausted retry sequence', async (t) => {
  process.env.CMR_RETRIES = '2';
  t.teardown(() => delete process.env.CMR_RETRIES);
  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'invalid-token',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });

  const refreshStub = sinon.stub(cmr, 'checkRefreshLaunchpadToken').resolves();
  t.teardown(() => refreshStub.restore());

  const originalError = Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
  const operation = sinon.stub().rejects(originalError);
  const error = await t.throwsAsync(
    () => cmr.withCmrLaunchpadTokenRefreshRetry(operation),
    { name: 'CMRCallFailedError' }
  );

  t.is(operation.callCount, 3);
  t.false(refreshStub.called);
  t.is(error.cause, originalError);
});

test.serial('refreshLaunchpadToken updates the CMR token with getValidLaunchpadToken', async (t) => {
  const validToken = 'valid-launchpad-token';
  const stub = sinon.stub(launchpad, 'getValidLaunchpadToken').resolves(validToken);
  t.teardown(() => stub.restore());

  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'invalid-token',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });

  await cmr.checkRefreshLaunchpadToken();

  t.is(cmr.token, validToken);
  t.true(stub.calledOnce);
  t.deepEqual(stub.firstCall.args[0], {
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });
});

test.serial('refreshLaunchpadToken throws when passphrase, api, or certificate is missing', async (t) => {
  const stub = sinon.stub(launchpad, 'getValidLaunchpadToken').resolves('Error');
  t.teardown(() => stub.restore());

  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'invalid-token',
  });

  const message = 'Cannot refresh Launchpad token: passphrase, api, and certificate must all be set on the CMR client';
  await t.throwsAsync(
    () => cmr.checkRefreshLaunchpadToken(),
    { message }
  );

  t.false(stub.called);
  t.is(cmr.token, 'invalid-token');
});

test.serial('checkRefreshLaunchpadToken handles concurrent refresh calls correctly', async (t) => {
  const validToken = 'valid-launchpad-token';
  let resolveRefresh;
  const refreshPromise = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const stub = sinon.stub(launchpad, 'getValidLaunchpadToken').returns(refreshPromise);
  t.teardown(() => stub.restore());

  const cmr = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
    token: 'invalid-token',
    passphrase: 'passphrase',
    api: 'api',
    certificate: 'cert',
  });

  const call1 = cmr.checkRefreshLaunchpadToken();
  const call2 = cmr.checkRefreshLaunchpadToken();
  const call3 = cmr.checkRefreshLaunchpadToken();

  t.true(stub.calledOnce);

  resolveRefresh(validToken);
  await Promise.all([call1, call2, call3]);

  t.is(cmr.token, validToken);
  t.true(stub.calledOnce);
  stub.resetHistory();
  stub.resolves('second-valid-token');
  await cmr.checkRefreshLaunchpadToken();
  t.true(stub.calledOnce);
  t.is(cmr.token, 'second-valid-token');
});

test.serial('getInstance creates a new CMR instance if one does not already exist', (t) => {
  const firstCMR = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
  });

  const secondCMR = CMR.getInstance({
    clientId: 'not-clientId',
    oauthProvider: 'earthdata',
  });
  t.is(firstCMR, secondCMR);
});

test.serial('getInstance returns the latest created CMR instance', (t) => {
  const firstCMR = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
  });

  const secondCMR = CMR.getInstance({
    clientId: 'clientId2',
    oauthProvider: 'earthdata',
  });

  const thirdCMR = CMR.getInstance({
    clientId: 'clientId3',
    oauthProvider: 'earthdata',
  });
  t.is(secondCMR, thirdCMR);
  t.is(firstCMR, thirdCMR);
});

test.serial('resetInstance properly reverts the CMR singleton to undefined', (t) => {
  const firstCMR = CMR.getInstance({
    clientId: 'clientId',
    oauthProvider: 'launchpad',
  });

  const secondCMR = CMR.getInstance({
    clientId: 'clientId2',
    oauthProvider: 'earthdata',
  });

  t.is(secondCMR, firstCMR);

  CMR.resetInstance();

  const thirdCMR = CMR.getInstance({
    clientId: 'clientId3',
    oauthProvider: 'launchpad',
  });

  t.not(firstCMR, thirdCMR);
  t.not(secondCMR, thirdCMR);
});
