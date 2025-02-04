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
const { isECHO10Filename, isUMMGFilename, metadataObjectFromCMRFile } = require('@cumulus/cmrjs/cmr-utils');

const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { constructCollectionId } = require('../../../packages/message/Collections');

let changeGranuleCollectionS3;
async function uploadFiles(files) {
  await Promise.all(files.map((file) => {
    let body;
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.cmr.xml');
    } else if (isUMMGFilename(file)) {
      body = fs.createReadStream('tests/data/ummg-meta.cmr.json');
    } else {
      body = parseS3Uri(file).Key;
    }
    if (!parseS3Uri(file).Bucket || !parseS3Uri(file).Key) {
      return;
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
      name: 'MOD11A2',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A2',
      process: 'modis',
      version: '006',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A2',
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
      name: 'MOD11A2',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A2',
      process: 'modis',
      version: '006',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A2',
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
      name: 'MOD11A2',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A2',
      process: 'modis',
      version: '006',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A2',
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
  return newPayload;
}

test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  const testDbName = `change-granule-collection-s3/change-collections-s3${cryptoRandomString({ length: 10 })}`;
  changeGranuleCollectionS3 = proxyquire(
    '../dist/src',
    {
      '@cumulus/api-client/granules': {
        getGranule: (params) => dummyGetGranule(params.granuleId, t),
      },
      '@cumulus/api-client/collections': {
        getCollection: (params) => (
          dummyGetCollection(params.collectionName, params.collectionVersion)
        ),
      },
    }
  ).changeGranuleCollectionS3;

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

test.serial('Should move files to final location with cmr xml file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
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
  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2003/` +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  );
  const onlineResourceUrls = UMM.Granule.OnlineResources.OnlineResource.map(
    (urlObject) => urlObject.URL
  );
  const browseUrls = UMM.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.map(
    (urlObject) => urlObject.URL
  );
  const onlineAccessURLs = UMM.Granule.OnlineAccessURLs.OnlineAccessURL.map(
    (urlObject) => urlObject.URL
  );

  t.true(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.true(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
});

test.serial('Should move files to final location and update pg data with cmr umm json file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_ummg_json.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1UMMG', version: '001' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
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
  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2016/` +
    'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json'
  );
  const relatedURLS = UMM.RelatedUrls.map((urlObject) => urlObject.URL);

  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json'
  ));

  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json'
  ));
});

test.serial('should update cmr data to hold extra urls but remove out-dated urls', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_ummg_json.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1UMMG', version: '001' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);

  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2016/` +
    'MOD11A1.A2017200.h19v04.006.2017201090724.ummg.cmr.json'
  );
  const URLDescriptions = UMM.RelatedUrls.map((urlObject) => urlObject.Description);
  // urls that should have been moved are tagged thusly in their description
  t.false(URLDescriptions.includes('this should be gone by the end'));

  // urls that shouldn't have been changed are tagged thsuly in their description
  t.true(URLDescriptions.includes("This should be held onto as it doesn't follow the pattern of tea/s3 url"));
});

test.serial('handles partially moved files', async (t) => {
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
  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);

  await uploadFiles(filesToUpload, t.context.bucketMapping);

  const output = await changeGranuleCollectionS3(newPayload);
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
  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2003/` +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  );
  const onlineAccessURLs = UMM.Granule.OnlineAccessURLs.OnlineAccessURL.map(
    (urlObject) => urlObject.URL
  );
  const onlineResourceUrls = UMM.Granule.OnlineResources.OnlineResource.map(
    (urlObject) => urlObject.URL
  );
  const browseUrls = UMM.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.map(
    (urlObject) => urlObject.URL
  );

  t.true(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.true(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
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
  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);

  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
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

  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2003/` +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  );
  const onlineAccessURLs = UMM.Granule.OnlineAccessURLs.OnlineAccessURL.map(
    (urlObject) => urlObject.URL
  );
  const onlineResourceUrls = UMM.Granule.OnlineResources.OnlineResource.map(
    (urlObject) => urlObject.URL
  );
  const browseUrls = UMM.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.map(
    (urlObject) => urlObject.URL
  );

  t.true(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.true(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
});

test.serial('handles files that need no move', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');

  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11ANOMOVE', version: '001' };
  const newPayload = buildPayload(t, collection);
  newPayload.config.invalidBehavior = 'error';
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
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
  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.protectedBucket}/` +
    'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  );
  const onlineAccessURLs = UMM.Granule.OnlineAccessURLs.OnlineAccessURL.map(
    (urlObject) => urlObject.URL
  );
  const onlineResourceUrls = UMM.Granule.OnlineResources.OnlineResource.map(
    (urlObject) => urlObject.URL
  );
  const browseUrls = UMM.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.map(
    (urlObject) => urlObject.URL
  );
  // this is not adding the _1.jpg file to the cmr file because these are private
  t.true(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.true(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.true(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.true(onlineResourceUrls.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/file-staging/subdir/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
});

test('ignores invalid granules when set to skip', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'bad_payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);
  const output = await changeGranuleCollectionS3(newPayload);
  t.deepEqual(output, { granules: [] })
});

test('errors on invalid granules when set to error', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'bad_payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);
  newPayload.config.invalidBehavior = 'error';
  try {
    await changeGranuleCollectionS3(newPayload);
    t.fail()
  } catch (error) {
    t.pass()
  }
});