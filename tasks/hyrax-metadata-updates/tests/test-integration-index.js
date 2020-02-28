'use strict';

const nock = require('nock');
const { promisify } = require('util');
const test = require('ava');
const fs = require('fs');
const libxmljs = require('libxmljs');
const { s3 } = require('@cumulus/aws-client/services');
const {
  randomId
} = require('@cumulus/common/test-utils');
const path = require('path');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  promiseS3Upload,
  parseS3Uri,
  getS3Object
} = require('@cumulus/aws-client/S3');
const readFile = promisify(fs.readFile);
const { InvalidArgument } = require('@cumulus/errors');
const ValidationError = require('@cumulus/cmr-client/ValidationError');

const HyraxMetadataUpdate = require('..');

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

async function uploadFilesXml(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/echo10in.xml') : parseS3Uri(file).Key
  })));
}

async function uploadFilesJson(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.json')
      ? fs.createReadStream('tests/data/umm-gin.json') : parseS3Uri(file).Key
  })));
}

function granulesToFileURIs(granules) {
  const s3URIs = granules.reduce((arr, g) => arr.concat(g.files.map((file) => file.filename)), []);
  return s3URIs;
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;

  newPayload.input.granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
      file.filename = buildS3Uri(t.context.stagingBucket, parseS3Uri(file.filename).Key);
    });
  });

  return newPayload;
}

test.beforeEach(async (t) => {
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
    .replyWithFile(200, 'tests/data/cmr-results.json', headers);
  process.env.CMR_ENVIRONMENT = 'OPS';
});

test.afterEach.always(async (t) => {
  delete process.env.CMR_ENVIRONMENT;
});

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

test.serial('Test updating ECHO10 metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov').post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(200);

  // Set up S3
  t.context.stagingBucket = randomId('staging');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise()
  ]);
  const payloadPath = path.join(__dirname, 'data', 'payload-xml.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  buildPayload(t);
  await uploadFilesXml(filesToUpload, t.context.stagingBucket);
  const e = {
    config: event.config,
    input: t.context.payload.input
  };
  await HyraxMetadataUpdate.hyraxMetadataUpdate(e);
  // Verify the metadata has been updated at the S3 location
  const metadataFile = t.context.payload.input.granules[0].files.find((f) => f.type === 'metadata');
  const actual = await getS3Object(`${metadataFile.bucket}/${metadataFile.fileStagingDir}`, metadataFile.name);
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  t.is(actual.Body.toString(), expected);

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test updating UMM-G metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov').post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(200);
  // Set up S3
  t.context.stagingBucket = randomId('staging');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise()
  ]);
  const payloadPath = path.join(__dirname, 'data', 'payload-json.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  buildPayload(t);
  await uploadFilesJson(filesToUpload, t.context.stagingBucket);
  const e = {
    config: event.config,
    input: t.context.payload.input
  };
  await HyraxMetadataUpdate.hyraxMetadataUpdate(e);
  // Verify the metadata has been updated at the S3 location
  const metadataFile = t.context.payload.input.granules[0].files.find((f) => f.type === 'metadata');
  const actual = await getS3Object(`${metadataFile.bucket}/${metadataFile.fileStagingDir}`, metadataFile.name);
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  // We do this dance because formatting.
  const expectedString = JSON.stringify(JSON.parse(expected), null, 2);
  const actualString = JSON.stringify(JSON.parse(actual.Body.toString()), null, 2);
  t.is(actualString, expectedString);

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test valition error when updating UMM-G metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov', {
    reqheaders: {
      'user-agent': 'got/9.6.0 (https://github.com/sindresorhus/got)',
      accept: 'application/json',
      'content-type': 'application/vnd.nasa.cmr.umm+json;version=1.4',
      'accept-encoding': 'gzip, deflate'
    }
  }).post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(400);

  // Set up S3
  t.context.stagingBucket = randomId('staging');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise()
  ]);
  const payloadPath = path.join(__dirname, 'data', 'payload-json.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  buildPayload(t);
  await uploadFilesJson(filesToUpload, t.context.stagingBucket);
  const e = {
    config: event.config,
    input: t.context.payload.input
  };

  await t.throwsAsync(HyraxMetadataUpdate.hyraxMetadataUpdate(e), {
    instanceOf: ValidationError,
    message: 'Validation of metadata for MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json failed'
  });

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test retrieving entry title from CMR using UMM-G', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const actual = await HyraxMetadataUpdate.getEntryTitle(event.config, metadataObject, true);
  t.is(actual, 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC');
});

test.serial('Test retrieving entry title from CMR using ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const actual = await HyraxMetadataUpdate.getEntryTitle(event.config, metadata, false);
  t.is(actual, 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC');
});

test('Test generate path from UMM-G', async (t) => {
  const metadata = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(metadata);
  const actual = await HyraxMetadataUpdate.generatePath(event.config, metadataObject, true);

  t.is(actual, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10', async (t) => {
  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = libxmljs.parseXml(metadata);

  const actual = await HyraxMetadataUpdate.generatePath(event.config, metadataObject, false);

  t.is(actual, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generating OPeNDAP URL from ECHO10 file ', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = libxmljs.parseXml(data);
  const actual = await HyraxMetadataUpdate.generateHyraxUrl(event.config, metadata, false);
  t.is(actual, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generating OPeNDAP URL from UMM-G file ', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const actual = await HyraxMetadataUpdate.generateHyraxUrl(event.config, metadataObject, true);
  t.is(actual, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10 throws exception with broken config', async (t) => {
  const badEvent = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      }
    },
    input: {}
  };
  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = libxmljs.parseXml(metadata);

  await t.throwsAsync(HyraxMetadataUpdate.generatePath(badEvent.config, metadataObject, false), {
    instanceOf: InvalidArgument,
    message: 'Provider not supplied in configuration. Unable to construct path'
  });
});

// Invalid metadata format throw createDom
test('Test generate path from throws exception with broken config', async (t) => {
  // Set up S3
  t.context.stagingBucket = randomId('staging');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise()
  ]);
  const payloadPath = path.join(__dirname, 'data', 'payload-json-broken.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  buildPayload(t);
  await uploadFilesJson(filesToUpload, t.context.stagingBucket);
  const e = {
    config: event.config,
    input: t.context.payload.input
  };

  await t.throwsAsync(HyraxMetadataUpdate.hyraxMetadataUpdate(e), {
    instanceOf: InvalidArgument,
    message: 'Metadata file MOD11A1.A2017200.h19v04.006.2017201090724.cmr.foo is in unknown format'
  });

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});
