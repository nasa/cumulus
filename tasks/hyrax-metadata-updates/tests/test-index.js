'use strict';

const test = require('ava');
const fs = require('fs');
const libxmljs = require('libxmljs');
const HyraxMetadataUpdate = require('..');

// Unit tests

test.afterEach.always(async (t) => {
  delete process.env.CMR_ENVIRONMENT;
});

test('Test return prod OPeNDAP host when no environment value supplied', async (t) => {
  delete process.env.CMR_ENVIRONMENT;
  const actual = await HyraxMetadataUpdate.generateAddress();
  t.is(actual, 'https://opendap.earthdata.nasa.gov');
});

test('Test return prod OPeNDAP host when prod environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'PROD';
  const actual = await HyraxMetadataUpdate.generateAddress();
  t.is(actual, 'https://opendap.earthdata.nasa.gov');
});

test('Test return prod OPeNDAP host when ops environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';
  const actual = await HyraxMetadataUpdate.generateAddress();
  t.is(actual, 'https://opendap.earthdata.nasa.gov');
});

test('Test return sit OPeNDAP host when sit environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const actual = await HyraxMetadataUpdate.generateAddress();
  t.is(actual, 'https://opendap.sit.earthdata.nasa.gov');
});

test('Test return uat OPeNDAP host when uat environment value supplied', async (t) => {
  process.env.CMR_ENVIRONMENT = 'UAT';
  const actual = await HyraxMetadataUpdate.generateAddress();
  t.is(actual, 'https://opendap.uat.earthdata.nasa.gov');
});

test('Test return error when invalid environment supplied for host generation', async (t) => {
  process.env.CMR_ENVIRONMENT = 'FOO';
  const error = await t.throws(
    () => HyraxMetadataUpdate.generateAddress()
  );

  t.is(error.message, 'Environment foo is not a valid environment.');
});

test('Test native id extraction from UMM-G', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const actual = await HyraxMetadataUpdate.getNativeId(metadata, true);

  t.is(actual, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test native id extraction from ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const actual = await HyraxMetadataUpdate.getNativeId(metadata, false);

  t.is(actual, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test adding OPeNDAP URL to UMM-G file', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const actual = await HyraxMetadataUpdate.addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to UMM-G file with no related urls', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin-no-related-urls.json', 'utf8');
  const metadata = JSON.parse(data);
  const expected = fs.readFileSync('tests/data/umm-gout-no-related-urls.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const actual = await HyraxMetadataUpdate.addHyraxUrl(metadata, true, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const actual = await HyraxMetadataUpdate.addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected);
});

test('Test adding OPeNDAP URL to ECHO10 file with no OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-no-online-resource-urls.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const expected = fs.readFileSync('tests/data/echo10out-no-online-resource-urls.xml', 'utf8');
  const actual = await HyraxMetadataUpdate.addHyraxUrl(metadata, false, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(actual, expected);
});
