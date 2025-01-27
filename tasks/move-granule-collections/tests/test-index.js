'use strict';

const fs = require('fs');

const proxyquire = require('proxyquire');
const path = require('path');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('@cumulus/aws-client/services');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  s3ObjectExists,
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const {
  randomId, validateOutput,
  randomString,
} = require('@cumulus/common/test-utils');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { isECHO10Filename, isISOFilename, isUMMGFilename, metadataObjectFromCMRFile } = require('@cumulus/cmrjs/cmr-utils');
const { bulkPatchGranuleCollection, bulkPatch } = require('@cumulus/api/endpoints/granules');
const { createTestIndex, cleanupTestIndex } = require('@cumulus/es-client/testUtils');
const indexer = require('@cumulus/es-client/indexer');
// const jest = require('jest');

const sinon = require('sinon');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');

const mockResponse = () => {
  const res = {};
  res.status = sinon.stub().returns(res);
  res.send = sinon.stub().returns(res);
  return res;
};

let moveGranules;
async function uploadFiles(files) {
  await Promise.all(files.map((file) => {
    let body;
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.cmr.xml');
    } else if (isISOFilename(file)) {
      body = fs.createReadStream('tests/data/meta.cmr.iso.xml');
    } else if (isUMMGFilename(file)) {
      body = fs.createReadStream('tests/data/ummg-meta.cmr.json');
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

function dummyGetGranule(granuleId, t) {
  return {
    base_iso_xml_granule: {
      status: 'completed',
      collectionId: 'MOD11A1___006',
      granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
      files: [

        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: t.context.protectedBucket,
          type: 'data',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: t.context.privateBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: t.context.publicBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
          bucket: t.context.protectedBucket,
          type: 'metadata',
        },
      ],
    },
    base_xml_granule: {
      status: 'completed',
      collectionId: 'MOD11A1___006',
      granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
      files: [
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: t.context.protectedBucket,
          type: 'data',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: t.context.privateBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: t.context.publicBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: t.context.protectedBucket,
          type: 'metadata',
        },
      ],
    },
    base_umm_granule: {
      status: 'completed',
      collectionId: 'MOD11A1___006',
      granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
      files: [
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: t.context.protectedBucket,
          type: 'data',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: t.context.privateBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: t.context.publicBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json',
          bucket: t.context.protectedBucket,
          type: 'metadata',
        },
      ],
    },
  }[granuleId];
}

function getOriginalCollection() {
  return JSON.parse(fs.readFileSync(
    path.join(
      __dirname,
      'data',
      'original_collection.json'
    )
  ));
}

async function setupDataStoreData(granuleIds, targetCollection, t) {
  const {
    esClient,
    esIndex,
  } = t.context;
  const granules = granuleIds.map((granuleId) => dummyGetGranule(granuleId, t));
  const sourceCollection = getOriginalCollection();
  
  await indexer.indexCollection(
    esClient,
    sourceCollection,
    esIndex
  );
  await indexer.indexCollection(
    esClient,
    targetCollection,
    esIndex
  );

  await Promise.all(granules.map((g) => indexer.indexGranule(
    esClient,
    g,
    esIndex
  )));
}

function granulesToFileURIs(granuleIds, t) {
  const granules = granuleIds.map((granuleId) => dummyGetGranule(granuleId, t));
  const files = granules.reduce((arr, g) => arr.concat(g.files), []);
  return files.map((file) => buildS3Uri(file.bucket, file.key));
}

function buildPayload(t, collection) {
  const newPayload = t.context.payload;
  newPayload.config.targetCollection = collection;
  newPayload.config.collection = getOriginalCollection();
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.private.name = t.context.privateBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;
  return newPayload;
}

test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  const testDbName = `move-granule-collections/change-collections-s3${cryptoRandomString({ length: 10 })}`;
  moveGranules = proxyquire(
    '../dist/src',
    {
      '@cumulus/api-client/granules': {
        bulkPatchGranuleCollection: (params) => (
          bulkPatchGranuleCollection(params, mockResponse())
        ),
        bulkPatch: (params) => (
          bulkPatch(params, mockResponse())
        ),
        getGranule: (params) => dummyGetGranule(params.granuleId, t),
      },
    }
  ).moveGranules;
  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.privateBucket = randomId('private');
  t.context.systemBucket = randomId('system');
  t.context.stackName = 'moveGranulesTestStack';
  const bucketMapping = {
    public: t.context.publicBucket,
    protected: t.context.protectedBucket,
    private: t.context.privateBucket,
    system: t.context.systemBucket,
  };
  t.context.bucketMapping = bucketMapping;
  await Promise.all([
    s3().createBucket({ Bucket: t.context.publicBucket }),
    s3().createBucket({ Bucket: t.context.protectedBucket }),
    s3().createBucket({ Bucket: t.context.privateBucket }),
    s3().createBucket({ Bucket: t.context.systemBucket }),
  ]);
  process.env = {
    ...process.env,
    PG_DATABASE: testDbName,
  };
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
  await cleanupTestIndex(t.context);
});

test.serial('Should move files to final location and update pg data with cmr xml file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules, t
  );
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
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

test.serial('Should move files to final location and update pg data with cmr iso xml file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_iso_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules, t
  );

  const collectionPath = path.join(__dirname, 'data', 'new_collection_iso_cmr.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const pgRecords = await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2018/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2018/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2018/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
  }));
});

test.only('Should move files to final location and update pg data with cmr umm json file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_ummg_json.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules, t
  );
  const collectionPath = path.join(__dirname, 'data', 'new_collection_ummg_cmr.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
  const cmrFile = await metadataObjectFromCMRFile(`s3://${t.context.protectedBucket}/file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json`)
  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2016/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2016/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2016/MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json',
  }));
  const UMM = await metadataObjectFromCMRFile(`s3://${t.context.publicBucket}/example2/2016/MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json`)
  const relatedURLS = UMM.RelatedUrls.map((urlObject) => urlObject.URL);
  console.log(relatedURLS)
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ))
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ))
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ))
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json'
  ))

  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ))
  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ))
  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ))
  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json'
  ))
});

test('handles partially moved files', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  // a starting granule state that disagrees with the payload as some have already been moved
  const startingFiles = [
    {
      key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      bucket: t.context.protectedBucket,
      type: 'data',
    },
    {
      key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
      bucket: t.context.publicBucket,
      type: 'browse',
    },
    {
      key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
      bucket: t.context.publicBucket,
      type: 'browse',
    },
    {
      key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      bucket: t.context.publicBucket,
      type: 'metadata ',
    },
    {
      key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      bucket: t.context.protectedBucket,
      type: 'metadata',
    },
  ];
  const filesToUpload = startingFiles.map((file) => buildS3Uri(file.bucket, file.key));
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);

  await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
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

test.serial('handles files that are pre-moved and misplaced w/r to postgres', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const startingFiles = [
    {
      key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      bucket: t.context.protectedBucket,
      type: 'data',
    },
    {
      key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
      bucket: t.context.publicBucket,
      type: 'browse',
    },
    {
      key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
      bucket: t.context.publicBucket,
      type: 'browse',
    },
    {
      key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      bucket: t.context.publicBucket,
      type: 'metadata ',
    },
    {
      key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      bucket: t.context.bucketMapping.protected,
      type: 'metadata',
    },
  ];
  const filesToUpload = startingFiles.map((file) => buildS3Uri(file.bucket, file.key));
  const collectionPath = path.join(__dirname, 'data', 'new_collection_base.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);

  await uploadFiles(filesToUpload, t.context.bucketMapping);
  await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );
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

test.serial('handles files that need no move', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');

  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granules, t
  );
  const collectionPath = path.join(__dirname, 'data', 'no_move_collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath));
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  await setupDataStoreData(
    newPayload.input.granules,
    collection,
    t
  );

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.privateBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.true(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
});
