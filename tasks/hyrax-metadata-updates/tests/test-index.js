'use strict';

const test = require('ava');
const fs = require('fs');
const libxmljs = require('libxmljs');
const HyraxMetadataUpdate = require('..');

// Unit tests

test('Test return prod OPeNDAP host when no environment value supplied', async (t) => {
  delete process.env.CMR_ENVIRONMENT;
  const data = await HyraxMetadataUpdate.generateAddress();
  t.is(data, 'https://opendap.earthdata.nasa.gov');
});

test('Test return prod OPeNDAP host when prod environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'PROD';
  const data = await HyraxMetadataUpdate.generateAddress();
  t.is(data, 'https://opendap.earthdata.nasa.gov');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test return prod OPeNDAP host when ops environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';
  const data = await HyraxMetadataUpdate.generateAddress();
  t.is(data, 'https://opendap.earthdata.nasa.gov');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test return sit OPeNDAP host when sit environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const data = await HyraxMetadataUpdate.generateAddress();
  t.is(data, 'https://opendap.sit.earthdata.nasa.gov');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test return uat OPeNDAP host when uat environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'UAT';
  const data = await HyraxMetadataUpdate.generateAddress();
  t.is(data, 'https://opendap.uat.earthdata.nasa.gov');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test return error when invalid environment supplied for host generation', async (t) => {
  process.env.CMR_ENVIRONMENT = 'FOO';
  const error = await t.throws(
    () => HyraxMetadataUpdate.generateAddress()
  );

  t.is(error.message, 'Environment foo is not a valid environment.');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test generate path from UMM-G', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  const metadata = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(metadata);
  const data = await HyraxMetadataUpdate.generatePath(event.config, metadataObject, true);

  t.is(data, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };

  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = libxmljs.parseXml(metadata);

  const data = await HyraxMetadataUpdate.generatePath(event.config, metadataObject, false);

  t.is(data, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test return error when invalid provider supplied for path generation', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };

  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = libxmljs.parseXml(metadata);

  const error = await t.throws(
    () => HyraxMetadataUpdate.generatePath(event.config, metadataObject, true)
  );

  t.is(error.message, 'Provider not supplied in configuration. Unable to construct path');
});

test('Test return error when invalid entry title supplied for path generation', async (t) => {
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
  const error = await t.throws(
    () => HyraxMetadataUpdate.generatePath(event.config, fs.readFileSync('tests/data/umm-gin.json', 'utf8'), true)
  );

  t.is(error.message, 'Entry Title not supplied in configuration. Unable to construct path');
});

test('Test native id extraction from UMM-G', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const result = await HyraxMetadataUpdate.getNativeId(metadata, true);

  t.is(result, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test native id extraction from ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const result = await HyraxMetadataUpdate.getNativeId(metadata, false);

  t.is(result, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test adding OPeNDAP URL to UMM-G file', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, true, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to UMM-G file with no related urls', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin-no-related-urls.json', 'utf8');
  const expected = fs.readFileSync('tests/data/umm-gout-no-related-urls.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, true, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, expected);
});

test('Test adding OPeNDAP URL to ECHO10 file with no OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-no-online-resource-urls.xml', 'utf8');
  const expected = fs.readFileSync('tests/data/echo10out-no-online-resource-urls.xml', 'utf8');
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, expected);
});

test('Test generating OPeNDAP URL from ECHO10 file ', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  process.env.CMR_ENVIRONMENT = 'SIT';
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const result = await HyraxMetadataUpdate.generateHyraxUrl(event.config, metadata, false);
  t.is(result, 'https://opendap.sit.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test generating OPeNDAP URL from UMM-G file ', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  process.env.CMR_ENVIRONMENT = 'SIT';
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const result = await HyraxMetadataUpdate.generateHyraxUrl(event.config, metadataObject, true);
  t.is(result, 'https://opendap.sit.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  delete process.env.CMR_ENVIRONMENT;
});

test('Test generating OPeNDAP URL from ECHO10 file with no environment set', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  process.env.CMR_ENVIRONMENT = 'PROD';
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const result = await HyraxMetadataUpdate.generateHyraxUrl(event.config, metadata, false);
  t.is(result, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  delete process.env.CMR_ENVIRONMENT;
});

// Integration tests

const nock = require('nock');

test.before(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test.serial('Test retrieving entry title from CMR using UMM-G', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'foo',
        username: 'bar',
        passwordSecretName: 'moo'
      }
    },
    input: {}
  };
  process.env.CMR_ENVIRONMENT = 'OPS';
  const headers = { 'cmr-hits': 1, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov', {
    reqheaders: {
      'user-agent': 'got/9.6.0 (https://github.com/sindresorhus/got)',
      'accept-encoding': 'gzip, deflate'
    }
  }).get('/search/collections.json')
    .query({
      short_name: 'GLDAS_CLSM025_D',
      version: '2.0',
      page_size: '50',
      page_num: '1',
      provider_short_name: 'GES_DISC'
    })
    .replyWithFile(200, 'tests/data/cmr-results.json', headers);
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const result = await HyraxMetadataUpdate.getEntryTitle(event.config, metadataObject, true);
  t.is(result, 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC');
  delete process.env.CMR_ENVIRONMENT;
});

test.serial('Test retrieving entry title from CMR using ECHO10', async (t) => {
  const event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'foo',
        username: 'bar',
        passwordSecretName: 'moo'
      }
    },
    input: {}
  };
  process.env.CMR_ENVIRONMENT = 'OPS';
  const headers = { 'cmr-hits': 1, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov', {
    reqheaders: {
      'user-agent': 'got/9.6.0 (https://github.com/sindresorhus/got)',
      'accept-encoding': 'gzip, deflate'
    }
  }).get('/search/collections.json')
    .query({
      short_name: 'GLDAS_CLSM025_D',
      version: '2.0',
      page_size: '50',
      page_num: '1',
      provider_short_name: 'GES_DISC'
    })
    .replyWithFile(200, 'tests/data/cmr-results.json', headers);
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const result = await HyraxMetadataUpdate.getEntryTitle(event.config, metadata, false);
  t.is(result, 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC');
  delete process.env.CMR_ENVIRONMENT;
});