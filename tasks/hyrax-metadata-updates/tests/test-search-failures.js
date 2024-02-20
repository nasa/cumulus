'use strict';

const test = require('ava');
const fs = require('fs');
const nock = require('nock');
const jwt = require('jsonwebtoken');
const { RecordDoesNotExist } = require('@cumulus/errors');
const rewire = require('rewire');
const HyraxMetadataUpdate = rewire('../index');
const { secretsManager } = require('@cumulus/aws-client/services');
const {
  randomId,
} = require('@cumulus/common/test-utils');

const getCollectionEntry = HyraxMetadataUpdate.__get__('getCollectionEntry');

const cmrPasswordSecret = randomId('cmrPassword');

const event = {
  config: {
    cmr: {
      oauthProvider: 'earthdata',
      provider: 'GES_DISC',
      clientId: 'xxxxxx',
      username: 'xxxxxx',
      passwordSecretName: cmrPasswordSecret,
    },
  },
  input: {},
};

const expectedresponse = [
  {
    access_token: jwt.sign(
      { data: 'foobar' },
      randomId('secret'),
      { expiresIn: '365d' }
    ),
    token_type: 'Bearer',
    expiration_date: '1/1/2999',
  },
];

test.before(async () => {
  await secretsManager().createSecret({
    Name: cmrPasswordSecret,
    SecretString: randomId('cmrPasswordSecret'),
  });
});

test.beforeEach(() => {
  process.env.CMR_ENVIRONMENT = 'OPS';

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);
});

test.afterEach.always(() => {
  delete process.env.CMR_ENVIRONMENT;
  nock.cleanAll();
});

test.after.always(async () => {
  await secretsManager().deleteSecret({
    SecretId: cmrPasswordSecret,
    ForceDeleteWithoutRecovery: true,
  });
});

test.serial('Test retrieving collection entry with invalid result (no "id" key)', async (t) => {
  // Mock out retrieval of entryTitle from CMR
  const headers = { 'cmr-hits': 1, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov').get('/search/collections.json')
    .query({
      short_name: 'GLDAS_CLSM025_D',
      version: '2.0',
      page_size: '50',
      page_num: '1',
      provider_short_name: 'GES_DISC',
    })
    .replyWithFile(200, 'tests/data/cmr-results-no-dataset-id.json', headers);

  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);

  await t.throwsAsync(getCollectionEntry(event.config, metadataObject, true), {
    instanceOf: RecordDoesNotExist,
    message: 'Unable to query parent collection using: {"short_name":"GLDAS_CLSM025_D","version":"2.0"}',
  });
});

test.serial('Test retrieving entry title with no results', async (t) => {
  // Mock out retrieval of entryTitle from CMR
  const headers = { 'cmr-hits': 0, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov').get('/search/collections.json')
    .query({
      short_name: 'GLDAS_CLSM025_D',
      version: '2.0',
      page_size: '50',
      page_num: '1',
      provider_short_name: 'GES_DISC',
    })
    .replyWithFile(200, 'tests/data/cmr-results-no-results.json', headers);

  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);

  await t.throwsAsync(getCollectionEntry(event.config, metadataObject, true), {
    instanceOf: RecordDoesNotExist,
    message: 'Unable to query parent collection using: {"short_name":"GLDAS_CLSM025_D","version":"2.0"}',
  });
});
