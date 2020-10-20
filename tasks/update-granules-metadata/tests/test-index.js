'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const cloneDeep = require('lodash/cloneDeep');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { isCMRFile } = require('@cumulus/cmrjs');
const { getDistributionBucketMapKey } = require('@cumulus/common/stack');

const { updateGranulesMetadata } = require('..');

async function uploadFiles(files, bucket) {
  const upload = await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/meta.xml') : parseS3Uri(file).Key,
  })));
  console.log("UPLOAD")
  console.log(upload)
  return upload
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
  const x = putJsonS3Object(
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

test.serial('Should add etag to each CMR metadata file', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await updateGranulesMetadata(newPayload);

  output.granules[0].files
    .filter(isCMRFile)
    .forEach(({ etag = '' }) => t.regex(etag, /"\S+"/));
});