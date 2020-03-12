'use strict';

const test = require('ava');
const fs = require('fs');
const xml2js = require('xml2js');
const { promisify } = require('util');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

const { InvalidArgument } = require('@cumulus/errors');
const rewire = require('rewire');
const HyraxMetadataUpdate = rewire('../index');

const generateAddress = HyraxMetadataUpdate.__get__('generateAddress');
const getGranuleUr = HyraxMetadataUpdate.__get__('getGranuleUr');
const addHyraxUrl = HyraxMetadataUpdate.__get__('addHyraxUrl');

test.afterEach.always(async () => {
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
      instanceOf: InvalidArgument
    }
  );
});

test('Test granule ur extraction from UMM-G', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const actual = getGranuleUr(metadata, true);

  t.is(actual, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test granule ur extraction from ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = getGranuleUr(metadata, false);

  t.is(actual, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test adding OPeNDAP URL to UMM-G file', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const actual = addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to UMM-G file with no related urls', (t) => {
  const data = fs.readFileSync('tests/data/umm-gin-no-related-urls.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout-no-related-urls.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const actual = addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected);
});

test('Test adding OPeNDAP URL to ECHO10 file with no OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-no-online-resource-urls.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out-no-online-resource-urls.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected);
});

test('Test adding OPeNDAP URL to ECHO10 file with one OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-1-online-resource-urls.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out-1-online-resource-urls.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected.trim('\n'));
});

test('Test adding OPeNDAP URL to ECHO10 file with two OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-2-online-resource-urls.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const expected = fs.readFileSync('tests/data/echo10out-2-online-resource-urls.xml', 'utf8');
  const actual = addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected);
});
