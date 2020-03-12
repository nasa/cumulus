'use strict';

const test = require('ava');
const fs = require('fs');
const nock = require('nock');
const { RecordDoesNotExist } = require('@cumulus/errors');
const rewire = require('rewire');
const HyraxMetadataUpdate = rewire('../index');

const getEntryTitle = HyraxMetadataUpdate.__get__('getEntryTitle');

const event = {
  config: {
    cmr: {
      oauthProvider: 'earthdata',
      provider: 'GES_DISC',
      clientId: 'xxxxxx',
      username: 'xxxxxx',
      passwordSecretName: 'xxxxx'
    }
  },
  input: {}
};

test.beforeEach(() => {
  process.env.CMR_ENVIRONMENT = 'OPS';
});

test.afterEach.always(() => {
  delete process.env.CMR_ENVIRONMENT;
});

test.serial('Test retrieving entry title with invalid result', async (t) => {
  // Mock out retrieval of entryTitle from CMR
  const headers = { 'cmr-hits': 1, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov').get('/search/collections.json')
    .query({
      short_name: 'GLDAS_CLSM025_D',
      version: '2.0',
      page_size: '50',
      page_num: '1',
      provider_short_name: 'GES_DISC'
    })
    .replyWithFile(200, 'tests/data/cmr-results-no-dataset-id.json', headers);

  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);

  await t.throwsAsync(getEntryTitle(event.config, metadataObject, true), {
    instanceOf: RecordDoesNotExist,
    message: 'Unable to query parent collection entry title using short name GLDAS_CLSM025_D and version 2.0'
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
      provider_short_name: 'GES_DISC'
    })
    .replyWithFile(200, 'tests/data/cmr-results-no-results.json', headers);

  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);

  await t.throwsAsync(getEntryTitle(event.config, metadataObject, true), {
    instanceOf: RecordDoesNotExist,
    message: 'Unable to query parent collection entry title using short name GLDAS_CLSM025_D and version 2.0'
  });
});
