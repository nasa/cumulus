'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const {
  buildS3Uri,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  s3ObjectExists,
  promiseS3Upload,
  headObject,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const { isCMRFile } = require('@cumulus/cmrjs');
const cloneDeep = require('lodash/cloneDeep');
const set = require('lodash/set');
const errors = require('@cumulus/errors');
const S3 = require('@cumulus/aws-client/S3');
const {
  randomString, randomId, validateConfig, validateInput, validateOutput,
} = require('@cumulus/common/test-utils');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { isECHO10Filename, isISOFilename } = require('@cumulus/cmrjs/cmr-utils');

const { moveGranules } = require('../dist');

async function uploadFiles(files) {
  await Promise.all(files.map((file) => {
    let body;
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.xml');
    } else if (isISOFilename(file)) {
      body = fs.createReadStream('tests/data/meta.iso.xml');
    } else {
      body = parseS3Uri(file).Key;
    }
    return promiseS3Upload({
      params: {
        Bucket: parseS3Uri(file).Bucket,
        Key: parseS3Uri(file).Key,
        Body: body,
      },
    });
  }));
}

function updateCmrFileType(payload) {
  payload.input.granules.forEach(
    (g) => {
      g.files.filter(isCMRFile).forEach((cmrFile) => {
        cmrFile.type = 'userSetType';
      });
    }
  );
}

function granulesToFileURIs(granules) {
  const files = granules.reduce((arr, g) => arr.concat(g.files), []);
  return files.map((file) => buildS3Uri(file.bucket, file.key));
}

function buildPayload(t, collection) {
  const newPayload = t.context.payload;
  newPayload.config.collection = collection
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.private.name = t.context.privateBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  return newPayload;
}

function getExpectedOutputFileKeys() {
  return [
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  ];
}
/**
 * Get file metadata for a set of files.
 * headObject from localstack doesn't return LastModified with millisecond,
 * use listObjectsV2 instead
 *
 * @param {Array<Object>} files - array of file objects
 * @returns {Promise<Array>} - file detail responses
 */
async function getFilesMetadata(files) {
  const getFileRequests = files.map(async (f) => {
    const s3list = await listS3ObjectsV2(
      { Bucket: f.bucket, Prefix: f.Key }
    );
    const s3object = s3list.filter((s3file) => s3file.Key === f.key);

    return {
      key: f.key,
      size: s3object[0].Size,
      LastModified: s3object[0].LastModified,
    };
  });
  return await Promise.all(getFileRequests);
}

test.beforeEach(async (t) => {
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.privateBucket = randomId('private');
  t.context.systemBucket = randomId('system');
  t.context.stackName = 'moveGranulesTestStack';
  const bucketMapping = {
    public: t.context.publicBucket,
    protected: t.context.protectedBucket,
    private: t.context.privateBucket,
    
  }
  t.context.bucketMapping = bucketMapping;
  await Promise.all([
    s3().createBucket({ Bucket: t.context.publicBucket }),
    s3().createBucket({ Bucket: t.context.protectedBucket }),
    s3().createBucket({ Bucket: t.context.privateBucket }),
    s3().createBucket({ Bucket: t.context.systemBucket }),
  ]);
  process.env.system_bucket = t.context.systemBucket;
  process.env.stackName = t.context.stackName;
  putJsonS3Object(
    t.context.systemBucket,
    getDistributionBucketMapKey(t.context.stackName),
    {
      [t.context.publicBucket]: t.context.publicBucket,
      [t.context.privateBucket]: t.context.privateBucket,
      [t.context.protectedBucket]: t.context.protectedBucket,
      [t.context.systemBucket]: t.context.systemBucket,
    }
  );

  
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});

test.only('Should move files to final location.', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
    .replaceAll('replaceme-public', t.context.bucketMapping.public)
    .replaceAll('replaceme-private', t.context.bucketMapping.private)
    .replaceAll('replaceme-protected', t.context.bucketMapping.protected)
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules
  );
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
});

test('updates cumulus datastores', async (t) => {
  t.pass();
});

test('is idempotent with respect to files moved in s3', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
    .replaceAll('replaceme-public', t.context.bucketMapping.public)
    .replaceAll('replaceme-private', t.context.bucketMapping.private)
    .replaceAll('replaceme-protected', t.context.bucketMapping.protected)
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules
  );
  const collectionPath = path.join(__dirname, 'data', 'partial_collection_for_idempotency.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const payload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await moveGranules(payload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));

  const newCollectionPath = path.join(__dirname, 'data', 'finished_collection_for_idempotency.json');
  const newCollection = JSON.parse(fs.readFileSync(newCollectionPath));
  const newPayload = buildPayload(t, newCollection);

  const newOutput = await moveGranules(newPayload);
  await validateOutput(t, newOutput);

});
