const test = require('ava');
const sinon = require('sinon');
const fs = require('fs-extra');
const path = require('path');

const { randomId } = require('@cumulus/common/test-utils');
const { promiseS3Upload, createBucket, recursivelyDeleteS3Bucket, getJsonS3Object } = require('@cumulus/aws-client/S3');

const { getXMLMetadataAsString, parseXmlString, updateCMRMetadata } = require('../../cmr-utils'); // Adjust the import path accordingly

const mockMetadataObject = {
  GranuleUR: 'original-id',
  DataGranule: { Identifiers: [] },
};

test.beforeEach(async (t) => {
  t.context.cmrFileBucket = randomId('bucket');
  await createBucket(t.context.cmrFileBucket);
  t.context.cmrFileJson = {
    bucket: t.context.cmrFileBucket,
    key: 'path/to/file.cmr.json',
  };
  t.context.cmrFileXml = {
    bucket: t.context.cmrFileBucket,
    key: 'path/to/file.cmr.xml',
  };
  t.context.badFile = {
    bucket: t.context.cmrFileBucket,
    key: 'bogusFile.txt',
  };
  t.context.cmrXmlFixture = await fs.readFile(
    path.join(__dirname, '../fixtures/cmrFileUpdateFixture.cmr.xml'),
    'utf8'
  );
  await Promise.all([
    promiseS3Upload({
      params: {
        Bucket: t.context.cmrFileJson.bucket,
        Key: t.context.cmrFileJson.key,
        Body: JSON.stringify(mockMetadataObject),
      },
    }),
    promiseS3Upload({
      params: {
        Bucket: t.context.cmrFileXml.bucket,
        Key: t.context.cmrFileXml.key,
        Body: t.context.cmrXmlFixture,
      },
    }),
    promiseS3Upload({
      params: {
        Bucket: t.context.cmrFileXml.bucket,
        Key: 'bogusFile.txt',
        Body: '<xml/>',
      },
    }),
  ]);
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.cmrFileBucket);
});

test('updates UMMG metadata with Granule Identifier update, when publish is set to false', async (t) => {
  const cmrFile = t.context.cmrFileJson;
  const result = await updateCMRMetadata({
    granuleId: 'new-granule',
    producerGranuleId: 'original-id',
    cmrFile: t.context.cmrFileJson,
    files: [],
    distEndpoint: 'https://fake-dist-endpoint',
    published: false,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleUr: true,
  });
  const actualObject = await getJsonS3Object(cmrFile.bucket, cmrFile.key);
  const expectedObject = {
    GranuleUR: 'new-granule',
    DataGranule: {
      Identifiers: [
        {
          Identifier: 'original-id',
          IdentifierType: 'ProducerGranuleId',
        },
      ],
    },
    RelatedUrls: [
      {
        URL: 'https://fake-dist-endpoint/s3credentials',
        Description:
          'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
        Type: 'VIEW RELATED INFORMATION',
      },
    ],
  };

  t.deepEqual(actualObject, expectedObject);
  t.deepEqual(result, {
    ...cmrFile,
    etag: result.etag,
  });
});

test('does not updates UMMG metadata granule identifiers when updateGranuleUr is set to false', async (t) => {
  const cmrFile = t.context.cmrFileJson;
  const result = await updateCMRMetadata({
    granuleId: 'new-granule',
    producerGranuleId: 'original-id',
    cmrFile: t.context.cmrFileJson,
    files: [],
    distEndpoint: 'https://fake-dist-endpoint',
    published: false,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleUr: false,
  });
  const actualObject = await getJsonS3Object(cmrFile.bucket, cmrFile.key);
  const expectedObject = {
    GranuleUR: 'original-id',
    DataGranule: {
      Identifiers: [],
    },
    RelatedUrls: [
      {
        URL: 'https://fake-dist-endpoint/s3credentials',
        Description:
          'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
        Type: 'VIEW RELATED INFORMATION',
      },
    ],
  };

  t.deepEqual(actualObject, expectedObject);
  t.deepEqual(result, {
    ...cmrFile,
    etag: result.etag,
  });
});

test('throws on invalid CMR file extension', async (t) => {
  await t.throwsAsync(
    () => updateCMRMetadata({
      granuleId: 'x',
      cmrFile: t.context.badFile,
      files: [],
      distEndpoint: 'https://x',
      published: false,
      bucketTypes: {},
      cmrGranuleUrlType: 'both',
      distributionBucketMap: {},
    }),
    { message: /Invalid CMR filetype/ }
  );
});

test('updates Echo10 metadata with UR update, when publish is set to false', async (t) => {
  const cmrFile = t.context.cmrFileXml;
  const { cmrXmlFixture } = t.context;

  const expected = await parseXmlString(cmrXmlFixture);
  expected.Granule.GranuleUR = 'updated-id';
  expected.Granule.DataGranule.ProducerGranuleId = 'original-id';
  expected.Granule.AssociatedBrowseImageUrls = '';

  await updateCMRMetadata({
    granuleId: 'updated-id',
    producerGranuleId: 'original-id',
    cmrFile,
    files: [],
    distEndpoint: 'https://example.com',
    published: false,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleUr: true,
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual, expected);
});

test('updateCMRMetadata does not updates ECHO10 metadata granule identifiers when updateGranuleUr is set to false', async (t) => {
  const cmrFile = t.context.cmrFileXml;
  const { cmrXmlFixture } = t.context;

  const expected = await parseXmlString(cmrXmlFixture);
  expected.Granule.AssociatedBrowseImageUrls = '';

  await updateCMRMetadata({
    granuleId: 'updated-id',
    producerGranuleId: 'original-id',
    cmrFile,
    files: [],
    distEndpoint: 'https://example.com',
    published: false,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleUr: false,
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual, expected);
});

test('publishes UMMG metadata when publish is set to true', async (t) => {
  const cmrFile = t.context.cmrFileJson;
  const result = await updateCMRMetadata({
    granuleId: 'new-granule',
    producerGranuleId: 'original-id',
    cmrFile: t.context.cmrFileJson,
    files: [],
    distEndpoint: 'https://fake-dist-endpoint',
    published: true,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleUr: true,
    testOverrides: {
      localPublish2CMR: () => ({
        conceptId: 'C123',
        granuleId: 'updated-granule',
        filename: `s3://${cmrFile.bucket}/${cmrFile.key}`,
        metadataFormat: 'umm_json',
        link: 'https://example.com/concepts/C123.umm_json',
      }),
      localGetCmrSettings: () => 'someValue',
    },
  });
  const actualObject = await getJsonS3Object(cmrFile.bucket, cmrFile.key);
  const expectedObject = {
    GranuleUR: 'new-granule',
    DataGranule: {
      Identifiers: [
        {
          Identifier: 'original-id',
          IdentifierType: 'ProducerGranuleId',
        },
      ],
    },
    RelatedUrls: [
      {
        URL: 'https://fake-dist-endpoint/s3credentials',
        Description:
          'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
        Type: 'VIEW RELATED INFORMATION',
      },
    ],
  };

  t.deepEqual(actualObject, expectedObject);
  t.like(result, {
    conceptId: 'C123',
    granuleId: 'updated-granule',
  });
});

test('publishes ECHO10 metadata when publish is set to true', async (t) => {
  const cmrFile = t.context.cmrFileXml;
  const { cmrXmlFixture } = t.context;

  const expected = await parseXmlString(cmrXmlFixture);
  expected.Granule.GranuleUR = 'updated-id';
  expected.Granule.DataGranule.ProducerGranuleId = 'original-id';
  expected.Granule.AssociatedBrowseImageUrls = '';

  const expectedXmlJsObject = structuredClone(expected);
  // This is the actual expression of some of the 1 value or empty objects
  // in memory/as a node object  when not run through js2xmlParser
  expectedXmlJsObject.Granule.AssociatedBrowseImageUrls = { ProviderBrowseUrl: [] };
  expectedXmlJsObject.Granule.OnlineAccessURLs.OnlineAccessURL = [
    expectedXmlJsObject.Granule.OnlineAccessURLs.OnlineAccessURL,
  ];
  expectedXmlJsObject.Granule.OnlineResources.OnlineResource = [
    expectedXmlJsObject.Granule.OnlineResources.OnlineResource,
  ];

  const localPublish2CMR = sinon.spy(() => ({
    conceptId: 'C123',
    granuleId: 'updated-granule',
    filename: `s3://${cmrFile.bucket}/${cmrFile.key}`,
    metadataFormat: 'umm_json',
    link: 'https://example.com/concepts/C123.umm_json',
  }));

  const result = await updateCMRMetadata({
    granuleId: 'updated-id',
    producerGranuleId: 'original-id',
    cmrFile,
    files: [],
    distEndpoint: 'https://example.com',
    published: true,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleUr: true,
    testOverrides: {
      localPublish2CMR,
      localGetCmrSettings: () => 'someValue',
    },
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual, expected);

  t.like(result, {
    conceptId: 'C123',
    granuleId: 'updated-granule',
  });
  t.deepEqual(localPublish2CMR.getCall(0).args[0].metadataObject, expectedXmlJsObject);
});
