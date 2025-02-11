'use strict';

const fs = require('fs');

const path = require('path');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('@cumulus/aws-client/services');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const {
  randomId, validateOutput,
  randomString,
} = require('@cumulus/common/test-utils');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { isECHO10Filename, isUMMGFilename, metadataObjectFromCMRFile, granulesToCmrFileObjects, isCMRFile, getCMRCollectionId } = require('@cumulus/cmrjs/cmr-utils');

const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { constructCollectionId } = require('../../../packages/message/Collections');
const { changeGranuleCollectionS3, s3MoveNeeded, s3CopyNeeded, updateCMRData } = require('../dist/src');
const { keyBy } = require('lodash');

async function uploadFiles(files) {
  await Promise.all(files.map((file) => {
    let body;
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.cmr.xml');
    } else if (isUMMGFilename(file)) {
      body = fs.createReadStream('tests/data/ummg-meta.cmr.json');
    } else {
      body = 'abc';
    }
    if (parseS3Uri(file).Bucket && parseS3Uri(file).Key) {
      return promiseS3Upload({
        params: {
          Bucket: parseS3Uri(file).Bucket,
          Key: parseS3Uri(file).Key,
          Body: body,
        },
      });
    }
    return null;
  }));
}
function dummyGetCollection(collectionName, collectionVersion) {
  return {
    MOD11A1___001: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '001',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A2',
    },
    MOD11A1___002: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '002',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
    MOD11A1UMMG___001: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.ummg\\.cmr\\.json$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.TemporalExtent.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '001',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
    MOD11A1UMMG___002: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.ummg\\.cmr\\.json$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.TemporalExtent.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '002',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
    MOD11ANOMOVE___001: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: 'protected',
        },
      ],
      url_path: 'file-staging/subdir/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '001',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
  }[constructCollectionId(collectionName, collectionVersion)];
}

function dummyGetGranule(granuleId, t) {
  return {
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
      granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090725',
      files: [
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725.hdf',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725.hdf',
          bucket: t.context.protectedBucket,
          type: 'data',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg',
          bucket: t.context.privateBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg',
          bucket: t.context.publicBucket,
          type: 'browse',
        },
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json',
          bucket: t.context.protectedBucket,
          type: 'metadata',
        },
      ],
    },
    bad_granule: {
      status: 'completed',
      collectionId: 'MOD11A1___006',
      granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
      files: [
        {
          key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
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
  }[granuleId];
}

function granulesToFileURIs(granuleIds, t) {
  const granules = granuleIds.map((granuleId) => dummyGetGranule(granuleId, t));
  const files = granules.reduce((arr, g) => arr.concat(g.files), []);
  return files.map((file) => buildS3Uri(file.bucket, file.key));
}

function buildPayload(t, collection) {
  const newPayload = t.context.payload;
  newPayload.config.targetCollection = collection;
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.private.name = t.context.privateBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;
  newPayload.config.testApiClientMethods = t.context.testApiClientMethods;
  return newPayload;
}


test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  const testDbName = `change-granule-collection-s3/change-collections-s3${cryptoRandomString({ length: 10 })}`;
  t.context.testApiClientMethods = {
    getGranuleMethod: (params) => dummyGetGranule(params.granuleId, t),
    getCollectionMethod: (params) => (
      dummyGetCollection(params.collectionName, params.collectionVersion)
    ),
  };

  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.privateBucket = randomId('private');
  t.context.systemBucket = randomId('system');
  t.context.stackName = 'changeGranuleCollectionS3TestStack';
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
    DISTRIBUTION_ENDPOINT: 'https://something.api.us-east-1.amazonaws.com/',
    system_bucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };
  await putJsonS3Object(
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
  await recursivelyDeleteS3Bucket(t.context.privateBucket);
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});

test('s3MoveNeeded checks regular files that arent identical', async (t) => {
  const sourceFile = {
    bucket: t.context.protectedBucket,
    key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  };
  const targetFile = {
    bucket: t.context.privateBucket,
    key: 'example2/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  };
  await promiseS3Upload({
    params: {
      Bucket: sourceFile.bucket,
      Key: sourceFile.key,
      Body: 'abcd',
    },
  })

  t.assert(await s3CopyNeeded(sourceFile, targetFile));

  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: 'abcd',
    },
  })

  t.assert((await s3CopyNeeded(sourceFile, targetFile)) == false);
});

test('s3MoveNeeded checks identical files', async (t) => {
  const sourceFile = {
    bucket: t.context.protectedBucket,
    key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  };
  const targetFile = {
    bucket: t.context.protectedBucket,
    key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  };

  t.assert((await s3CopyNeeded(sourceFile, targetFile)) == false);
});

test('s3MoveNeeded throws if file copy is requested to a location already occupied by different file', async (t) => {
  const sourceFile = {
    bucket: t.context.protectedBucket,
    key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  };
  const targetFile = {
    bucket: t.context.privateBucket,
    key: 'example2/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  };
  await promiseS3Upload({
    params: {
      Bucket: sourceFile.bucket,
      Key: sourceFile.key,
      Body: 'abcd',
    },
  })

  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: 'abc',
    },
  })
  await t.throwsAsync(
    () => s3CopyNeeded(sourceFile, targetFile),
    { name: 'DuplicateFile' }
  );
});

test.only('updateCMRData', async (t) => {
  const granules = [
    dummyGetGranule('base_xml_granule', t),
    dummyGetGranule('base_umm_granule', t),
  ]

  const cmrFiles = granulesToCmrFileObjects(granules, isCMRFile);
  await Promise.all([
    promiseS3Upload({
      params: {
        Bucket: cmrFiles[0].bucket,
        Key: cmrFiles[0].key,
        Body: isECHO10Filename(cmrFiles[0].key) ? fs.createReadStream('tests/data/meta.cmr.xml') :
          fs.createReadStream('tests/data/ummg-meta.cmr.json'),
      },
    }),
    promiseS3Upload({
      params: {
        Bucket: cmrFiles[1].bucket,
        Key: cmrFiles[1].key,
        Body: isECHO10Filename(cmrFiles[1].key) ? fs.createReadStream('tests/data/meta.cmr.xml') :
          fs.createReadStream('tests/data/ummg-meta.cmr.json'),
      },
    })
  ]);
  const cmrFilesByGranuleid = keyBy(cmrFiles, 'granuleId');
  const CMRObjectsByGranuleId = {};
  await Promise.all(cmrFiles.map(async (cmrFile) => {
    CMRObjectsByGranuleId[cmrFile.granuleId] = await metadataObjectFromCMRFile(
      `s3://${cmrFile.bucket}/${cmrFile.key}`
    );
  }));
  const updatedCMRData = await updateCMRData(
    granules,
    CMRObjectsByGranuleId,
    cmrFilesByGranuleid,
    {
      targetCollection: {
        name: 'abc',
        version: '003',
      },
      cmrGranuleUrlType: 'both',
      buckets: {
        internal: {
          name: t.context.stagingBucket,
          type: "internal",
        },
        private: {
          name: t.context.privateBucket,
          type: 'private',
        },
        protected: {
          name: t.context.protectedBucket,
          type: "protected",
        },
        public: {
          name: t.context.publicBucket,
          type: "public",
        },
      },
      distribution_endpoint: 'https://something.api.us-east-1.amazonaws.com',
    }
  )
  t.assert(getCMRCollectionId(
    updatedCMRData[granules[0].granuleId],
    cmrFilesByGranuleid[granules[0].granuleId].key
  ) == "abc___003");
  t.assert(getCMRCollectionId(
    updatedCMRData[granules[1].granuleId],
    cmrFilesByGranuleid[granules[1].granuleId].key
  ) == "abc___003");
  const onlineAccessURLs = updatedCMRData[
    'MOD11A1.A2017200.h19v04.006.2017201090724'
  ].Granule.OnlineAccessURLs.OnlineAccessURL.map(
    (urlObject) => urlObject.URL
  );
  const onlineResourceUrls = updatedCMRData[
    'MOD11A1.A2017200.h19v04.006.2017201090724'
  ].Granule.OnlineResources.OnlineResource.map(
    (urlObject) => urlObject.URL
  );
  const browseUrls = updatedCMRData[
    'MOD11A1.A2017200.h19v04.006.2017201090724'
  ].Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.map(
    (urlObject) => urlObject.URL
  );
  // the following entries are *not in * the original cme metadata file
  t.assert(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));

  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.assert(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  const relatedURLS = updatedCMRData[
    'MOD11A1.A2017200.h19v04.006.2017201090725'
  ].RelatedUrls.map((urlObject) => urlObject.URL);
  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.hdf'
  ));
  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg'
  ));
  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json'
  ));

  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.hdf'
  ));
  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg'
  ));
  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json'
  ));
});