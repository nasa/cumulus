'use strict';

const fs = require('fs');

const path = require('path');
const test = require('ava');
const keyBy = require('lodash/keyBy');
const noop = require('lodash/noop');
const range = require('lodash/range');
const cryptoRandomString = require('crypto-random-string');
const { s3, sns } = require('@cumulus/aws-client/services');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  s3ObjectExists,
  promiseS3Upload,
} = require('@cumulus/aws-client/S3');
const {
  randomId, validateOutput,
  randomString,
} = require('@cumulus/common/test-utils');
const {
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const {
  isECHO10Filename,
  metadataObjectFromCMRFile,
  granulesToCmrFileObjects,
  isCMRFile,
  getCMRCollectionId,
} = require('@cumulus/cmrjs/cmr-utils');

const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { constructCollectionId } = require('../../../packages/message/Collections');
const { changeGranuleCollectionS3, s3CopyNeeded, updateCMRData } = require('../dist/src');
const { dummyGetCollection, dummyGetGranule, uploadFiles } = require('./_helpers');

function granulesToFileURIs(granuleIds, t) {
  const granules = granuleIds.map((granuleId) => dummyGetGranule(granuleId, t));
  const files = granules.reduce((arr, g) => (g.files ? arr.concat(g.files) : arr), []);
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
  sns().send(new DeleteTopicCommand({ TopicArn: process.env.granule_sns_topic_arn }));
});

test.serial('changeGranuleCollectionS3 should copy files to final location with cmr xml file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1', version: '002' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2003/` +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  );

  const CollectionInformation = UMM.Granule.Collection;
  t.deepEqual(CollectionInformation, { ShortName: 'MOD11A1', VersionId: '002' });

  const onlineResourceUrls = UMM.Granule.OnlineResources.OnlineResource.map(
    (urlObject) => urlObject.URL
  );
  const browseUrls = UMM.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.map(
    (urlObject) => urlObject.URL
  );
  const onlineAccessURLs = UMM.Granule.OnlineAccessURLs.OnlineAccessURL.map(
    (urlObject) => urlObject.URL
  );

  t.assert(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.assert(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
});

test.serial('changeGranuleCollectionS3 should copy files to final location with cmr umm json file', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_ummg_json.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1UMMG', version: '002' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2016/MOD11A1.A2017200.h19v04.006.2017201090725.hdf',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2016/MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2016/MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json',
  }));
  const UMM = await metadataObjectFromCMRFile(
    `s3://${t.context.publicBucket}/example2/2016/` +
    'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json'
  );
  t.deepEqual(UMM.CollectionReference, { ShortName: 'MOD11A1', Version: '002' });
  const relatedURLS = UMM.RelatedUrls.map((urlObject) => urlObject.URL);

  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.hdf'
  ));
  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg'
  ));
  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg'
  ));
  t.assert(relatedURLS.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json'
  ));

  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.hdf'
  ));
  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg'
  ));
  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg'
  ));
  t.assert(relatedURLS.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2016/' +
    'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json'
  ));
});

test.serial('changeGranuleCollectionS3 should update cmr data to hold extra urls but remove out-dated urls', async (t) => {
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
    'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json'
  );
  const URLDescriptions = UMM.RelatedUrls.map((urlObject) => urlObject.Description);
  // urls that should have been moved are tagged thusly in their description
  t.false(URLDescriptions.includes('this should be gone by the end'));

  // urls that shouldn't have been changed are tagged thsuly in their description
  t.assert(URLDescriptions.includes("This should be held onto as it doesn't follow the pattern of tea/s3 url"));
});

test.serial('changeGranuleCollectionS3 handles partially moved files', async (t) => {
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
  ];

  // this is a special case that needs to be in place in massaged form
  // to be identified as 'not an error'
  const targetFile = {
    key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    bucket: t.context.publicBucket,
    type: 'metadata ',
  };

  const targetXMLBody = fs.readFileSync(
    path.join(__dirname, 'data', 'target_meta.cmr.xml')
  ).toString().replaceAll(
    'replaceme-public', t.context.publicBucket
  ).replaceAll(
    'replaceme-protected', t.context.protectedBucket
  );
  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: targetXMLBody,
    },
  });
  const filesToUpload = startingFiles.map((file) => buildS3Uri(file.bucket, file.key));

  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);

  await uploadFiles(filesToUpload, t.context.bucketMapping);

  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.assert(await s3ObjectExists({
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

  t.assert(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.assert(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
});

test.serial('changeGranuleCollectionS3 handles files that are pre-moved and misplaced w/r to postgres', async (t) => {
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
      key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      bucket: t.context.bucketMapping.protected,
      type: 'metadata',
    },
  ];

  const targetFile = {
    key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    bucket: t.context.publicBucket,
    type: 'metadata ',
  };

  const targetXMLBody = fs.readFileSync(
    path.join(__dirname, 'data', 'target_meta.cmr.xml')
  ).toString().replaceAll(
    'replaceme-public', t.context.publicBucket
  ).replaceAll(
    'replaceme-protected', t.context.protectedBucket
  );
  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: targetXMLBody,
    },
  });
  const filesToUpload = startingFiles.map((file) => buildS3Uri(file.bucket, file.key));
  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);

  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.assert(await s3ObjectExists({
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

  t.assert(onlineAccessURLs.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.assert(browseUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    'https://something.api.us-east-1.amazonaws.com/' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));

  t.assert(onlineAccessURLs.includes(
    's3://' +
    `${t.context.protectedBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.hdf'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/jpg/example2/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  ));
  t.assert(browseUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg'
  ));
  t.assert(onlineResourceUrls.includes(
    's3://' +
    `${t.context.publicBucket}` +
    '/example2/2003/' +
    'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'
  ));
});

test.serial('changeGranuleCollectionS3 handles files that need no move', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload_cmr_xml.json');

  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11ANOMOVE', version: '001' };
  const newPayload = buildPayload(t, collection);
  newPayload.config.invalidGranuleBehavior = 'error';
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const targetFile = {
    key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    bucket: t.context.bucketMapping.protected,
    type: 'metadata',
  };
  const targetXMLBody = fs.readFileSync(
    path.join(__dirname, 'data', 'meta.cmr.xml')
  ).toString().replaceAll(
    'replaceme-public', t.context.publicBucket
  ).replaceAll(
    'replaceme-protected', t.context.protectedBucket
  );
  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: targetXMLBody,
    },
  });
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.privateBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
  }));
  t.assert(await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  }));
});

test('changeGranuleCollectionS3 handles empty fileless granule without issue', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'empty_payload.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1', version: '002' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(output.granules.length === 1);
  t.assert(
    output.granules[0].collectionId === constructCollectionId(collection.name, collection.version)
  );
  t.assert(output.granules[0].files.length === 0);
  t.deepEqual(output.granules[0].files, []);
  t.assert(output.oldGranules.length === 1);
  t.assert(
    output.oldGranules[0].collectionId === 'MOD11A1___006'
  );
  t.assert(output.oldGranules[0].files.length === 0);
  t.deepEqual(output.oldGranules[0].files, []);
});

test('changeGranuleCollectionS3 handles empty undefined files granule without issue', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'empty_payload.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  t.context.payload.input.granuleIds = ['undef_files_xml_granule'];
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1', version: '002' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  t.assert(output.granules.length === 1);
  t.assert(
    output.granules[0].collectionId === constructCollectionId(collection.name, collection.version)
  );
  t.assert(output.granules[0].files === undefined);
  t.assert(output.oldGranules.length === 1);
  t.assert(
    output.oldGranules[0].collectionId === 'MOD11A1___006'
  );
  t.assert(output.oldGranules[0].files === undefined);
});

test('changeGranuleCollectionS3 ignores invalid granules when set to skip', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'bad_payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);
  newPayload.config.invalidGranuleBehavior = 'skip';
  const output = await changeGranuleCollectionS3(newPayload);
  t.deepEqual(output, {
    granules: [],
    oldGranules: [],
  });
});

test('changeGranuleCollectionS3 throws on invalid granules when set to error', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'bad_payload_cmr_xml.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  const collection = { name: 'MOD11A1', version: '001' };
  const newPayload = buildPayload(t, collection);
  newPayload.config.invalidGranuleBehavior = 'error';
  // await changeGranuleCollectionS3(newPayload)
  await t.throwsAsync(
    changeGranuleCollectionS3(newPayload),
    { name: 'ValidationError' }
  );
});

test('changeGranuleCollectionS3 handles large group of granules', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'empty_payload.json');
  t.context.payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  t.context.payload.input.granuleIds = range(200).map((i) => `xml_granule${i}`);
  const filesToUpload = granulesToFileURIs(
    t.context.payload.input.granuleIds, t
  );
  const collection = { name: 'MOD11A1', version: '002' };
  const newPayload = buildPayload(t, collection);
  await uploadFiles(filesToUpload, t.context.bucketMapping);
  const output = await changeGranuleCollectionS3(newPayload);
  await validateOutput(t, output);
  t.assert(output.granules.length === 200);
  t.assert(output.oldGranules.length === 200);
  // verify that ll these files are in new location
  await Promise.all(output.granules.map((granule) => (
    Promise.all(granule.files.map(async (file) => (
      t.assert(await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }))
    )))
  )));
  // and have not been deleted from original location
  await Promise.all(output.oldGranules.map((granule) => (
    Promise.all(granule.files.map(async (file) => (
      t.assert(await s3ObjectExists({
        Bucket: file.bucket,
        Key: file.key,
      }))
    )))
  )));
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
  });

  t.assert(await s3CopyNeeded(sourceFile, targetFile));

  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: 'abcd',
    },
  });

  t.assert((await s3CopyNeeded(sourceFile, targetFile)) === false);
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

  t.assert((await s3CopyNeeded(sourceFile, targetFile)) === false);
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
  });

  await promiseS3Upload({
    params: {
      Bucket: targetFile.bucket,
      Key: targetFile.key,
      Body: 'abc',
    },
  });
  await t.throwsAsync(
    () => s3CopyNeeded(sourceFile, targetFile),
    { name: 'DuplicateFile' }
  );
});

test('updateCMRData', async (t) => {
  const granules = [
    dummyGetGranule('base_xml_granule', t),
    dummyGetGranule('base_umm_granule', t),
  ];

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
    }),
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
          type: 'internal',
        },
        private: {
          name: t.context.privateBucket,
          type: 'private',
        },
        protected: {
          name: t.context.protectedBucket,
          type: 'protected',
        },
        public: {
          name: t.context.publicBucket,
          type: 'public',
        },
      },
      distribution_endpoint: 'https://something.api.us-east-1.amazonaws.com',
    }
  );
  t.assert(getCMRCollectionId(
    updatedCMRData[granules[0].granuleId],
    cmrFilesByGranuleid[granules[0].granuleId].key
  ) === 'abc___003');
  t.assert(getCMRCollectionId(
    updatedCMRData[granules[1].granuleId],
    cmrFilesByGranuleid[granules[1].granuleId].key
  ) === 'abc___003');

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
  // the following entries are *not in * the original cmr metadata file
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
