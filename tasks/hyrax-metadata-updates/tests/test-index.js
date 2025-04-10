'use strict';

const test = require('ava');
const fs = require('fs');
const xml2js = require('xml2js');
const { promisify } = require('util');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false,
};

const { InvalidArgument } = require('@cumulus/errors');
const rewire = require('rewire');
const HyraxMetadataUpdate = rewire('../index');

const generateAddress = HyraxMetadataUpdate.__get__('generateAddress');
const getGranuleUr = HyraxMetadataUpdate.__get__('getGranuleUr');
const addHyraxUrl = HyraxMetadataUpdate.__get__('addHyraxUrl');
const getCmrSearchParams = HyraxMetadataUpdate.__get__('getCmrSearchParams');

test.afterEach.always(() => {
  delete process.env.CMR_ENVIRONMENT;
});

test('Test return prod OPeNDAP host when no environment value supplied', (t) => {
  delete process.env.CMR_ENVIRONMENT;
  const actual = generateAddress();
  t.is(actual, 'https://opendap.earthdata.nasa.gov');
});

test('Test return prod OPeNDAP host when prod environment value supplied', (t) => {
  process.env.CMR_ENVIRONMENT = 'PROD';
  const actual = generateAddress();
  t.is(actual, 'https://opendap.earthdata.nasa.gov');
});

test('Test return prod OPeNDAP host when ops environment value supplied', (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';
  const actual = generateAddress();
  t.is(actual, 'https://opendap.earthdata.nasa.gov');
});

test('Test return sit OPeNDAP host when sit environment value supplied', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const actual = generateAddress();
  t.is(actual, 'https://opendap.sit.earthdata.nasa.gov');
});

test('Test return uat OPeNDAP host when uat environment value supplied', (t) => {
  process.env.CMR_ENVIRONMENT = 'UAT';
  const actual = generateAddress();
  t.is(actual, 'https://opendap.uat.earthdata.nasa.gov');
});

test('Test return error when invalid environment supplied for host generation', (t) => {
  process.env.CMR_ENVIRONMENT = 'FOO';
  t.throws(
    () => generateAddress(),
    {
      message: 'Environment foo is not a valid environment.',
      instanceOf: InvalidArgument,
    }
  );
});

test('Test granule ur extraction from UMM-G', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const actual = getGranuleUr(metadata, true);
  t.is(actual, 'GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test granule ur extraction from ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = getGranuleUr(metadata, false);
  t.is(actual, 'GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test adding OPeNDAP URL to UMM-G file', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const actual = addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, undefined, 2));
});

test('Test adding OPeNDAP URL to UMM-G file with no related urls', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin-no-related-urls.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout-no-related-urls.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const actual = addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, undefined, 2));
});

test('Test adding duplicate OPeNDAP URL to UMM-G file', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const newMetadata = JSON.parse(addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4'));
  const actual = addHyraxUrl(newMetadata, true, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, undefined, 2));
});

test('Test adding OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  console.info(actual);
  t.is(actual, expected.trim('\n'));
});

test('Test adding OPeNDAP URL to ECHO10 file with no OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-no-online-resource-urls.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out-no-online-resource-urls.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected.trim('\n'));
});

test('Test adding OPeNDAP URL to ECHO10 file with one OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-1-online-resource-urls.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out-1-online-resource-urls.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected.trim('\n'));
});

test('Test adding OPeNDAP URL to ECHO10 file with two OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-2-online-resource-urls.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out-2-online-resource-urls.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected.trim('\n'));
});

test('Test adding duplicate OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const newMetadata = await (promisify(xml2js.parseString))(addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4'), xmlParseOptions);
  const actual = addHyraxUrl(newMetadata, false, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected.trim('\n'));
});

test('Test building CMR Search Params with short name and version', (t) => {
  const inputSearchParams = {
    shortName: 'GLDAS_CLSM025_D',
    versionId: '2.0',
  };
  const expected = {
    short_name: 'GLDAS_CLSM025_D',
    version: '2.0',
  };
  const actual = getCmrSearchParams(inputSearchParams);
  t.deepEqual(actual, expected);
});

test('Test building CMR Search Params with dataset ID', (t) => {
  const inputSearchParams = {
    datasetId: 'GLDAS_CLSM025_D.2.0',
  };
  const expected = {
    dataset_id: 'GLDAS_CLSM025_D.2.0',
  };
  const actual = getCmrSearchParams(inputSearchParams);
  t.deepEqual(actual, expected);
});

test('Test building invalid CMR Search Params with short name, version, and dataset ID', (t) => {
  const inputSearchParams = {
    datasetId: 'GLDAS_CLSM025_D.2.0',
    shortName: 'GLDAS_CLSM025_D',
    versionId: '2.0',
  };

  t.throws(
    () => getCmrSearchParams(inputSearchParams),
    {
      message: 'Invalid list of keys for searchParams: dataset_id,short_name,version',
      instanceOf: Error,
    }
  );
});

test('Test building invalid CMR Search Params with invalid params (datasetId and Version Id)', (t) => {
  const inputSearchParams = {
    datasetId: 'GLDAS_CLSM025_D.2.0',
    versionId: '2.0',
  };

  t.throws(
    () => getCmrSearchParams(inputSearchParams),
    {
      message: 'Invalid list of keys for searchParams: dataset_id,version',
      instanceOf: Error,
    }
  );
});

test('Test building invalid CMR Search Params with invalid params (datasetId and shortName)', (t) => {
  const inputSearchParams = {
    datasetId: 'GLDAS_CLSM025_D.2.0',
    shortName: 'GLDAS_CLSM025_D',
  };

  t.throws(
    () => getCmrSearchParams(inputSearchParams),
    {
      message: 'Invalid list of keys for searchParams: dataset_id,short_name',
      instanceOf: Error,
    }
  );
});
