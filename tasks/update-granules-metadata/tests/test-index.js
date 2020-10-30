'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const cloneDeep = require('lodash/cloneDeep');

const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { isCMRFile } = require('@cumulus/cmrjs');
const { s3 } = require('@cumulus/aws-client/services');
const { getDistributionBucketMapKey } = require('@cumulus/common/stack');

const { updateGranulesMetadata } = require('..');

function cmrReadStream(file) {
  return file.endsWith('.cmr.xml') ? fs.createReadStream('tests/data/meta.xml') : fs.createReadStream('tests/data/ummg-meta.json');
}

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: !(file.endsWith('.cmr.xml') || file.endsWith('.cmr.json'))
      ? parseS3Uri(file).Key : cmrReadStream(file),
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
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

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
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.systemBucket = randomId('system');
  t.context.stackName = randomString();
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise(),
    s3().createBucket({ Bucket: t.context.publicBucket }).promise(),
    s3().createBucket({ Bucket: t.context.protectedBucket }).promise(),
    s3().createBucket({ Bucket: t.context.systemBucket }).promise(),
  ]);
  process.env.system_bucket = t.context.systemBucket;
  process.env.stackName = t.context.stackName;
  putJsonS3Object(
    t.context.systemBucket,
    getDistributionBucketMapKey(t.context.stackName),
    {
      [t.context.stagingBucket]: t.context.stagingBucket,
      [t.context.publicBucket]: t.context.publicBucket,
      [t.context.protectedBucket]: t.context.protectedBucket,
      [t.context.systemBucket]: t.context.systemBucket,
    }
  );

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));
  process.env.REINGEST_GRANULE = false;
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});

test.serial('Should add etag to each CMR metadata file by checking that etag is one or more characters, not whitespace', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await updateGranulesMetadata(newPayload);

  output.granules.forEach((g) => g.files
    .filter(isCMRFile)
    .forEach(({ etag = '' }) => t.regex(etag, /"\S+"/)));
});

test.serial('Should update existing etag on CMR metadata file', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);
  const inputGranules = newPayload.input.granules;
  const granuleWithEtag = inputGranules.find((g) => g.files.some((f) => f.etag));
  const previousEtag = granuleWithEtag.files.filter(isCMRFile)[0].etag;
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const { granules } = await updateGranulesMetadata(newPayload);
  const updatedGranule = granules.find((g) => g.granuleId === granuleWithEtag.granuleId);
  const newEtag = updatedGranule.files.filter(isCMRFile)[0].etag;
  t.not(newEtag, previousEtag);
});

test.serial('Update-granules-metadata throws an error when cmr file type is distribution and no distribution endpoint is set', async (t) => {
  const newPayload = buildPayload(t);
  delete newPayload.config.distribution_endpoint;

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  await t.throwsAsync(
    () => updateGranulesMetadata(newPayload),
    { message: 'cmrGranuleUrlType is distribution, but no distribution endpoint is configured.' } 
  );
});
