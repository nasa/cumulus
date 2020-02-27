'use strict';

const test = require('ava');
const fs = require('fs');
const libxmljs = require('libxmljs');
const HyraxMetadataUpdate = require('..');
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
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const clonedeep = require('lodash.clonedeep');

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/echo10in.xml') : parseS3Uri(file).Key
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
  t.context.stagingBucket = randomId('staging');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise()
  ]);

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test updating ECHO10 metadata file in S3', async (t) => {
  buildPayload(t);
  const filesToUpload = clonedeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  const event = {
    config: {
      cmr: {
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      },
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  await HyraxMetadataUpdate.updateSingleGranule(event.config, t.context.payload.input.granules[0]);
  // Verify the metadata has been updated at the S3 location
  const metadataFile = t.context.payload.input.granules[0].files.find((f) => f.type === 'metadata');
  const actual = await getS3Object(`${metadataFile.bucket}/${metadataFile.fileStagingDir}`, metadataFile.name);
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  t.is(actual.Body.toString(), expected);
  delete process.env.CMR_ENVIRONMENT;
});

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
