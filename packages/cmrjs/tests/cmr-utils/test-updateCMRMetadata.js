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
  // Mocking the date for ProductionDateTime value checks in tests as the function
  // updateCMRMetadata sets this to the current time for UMMG Granules for adding or updating a
  // DataGranule when excludeDataGranule is false.
  t.context.clock = sinon.useFakeTimers(new Date('2024-01-01T00:00:00Z').getTime());
});

test.afterEach.always(async (t) => {
  t.context.clock.restore();
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
    updateGranuleIdentifiers: true,
    excludeDataGranule: false,
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
      DayNightFlag: 'Unspecified',
      // Date mocked in tests, as noted above, so this is the expected value for ProductionDateTime
      // despite actually being the time the task is ran (which is what is mocked, Date.now())
      ProductionDateTime: new Date('2024-01-01T00:00:00Z').toISOString(),
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

test('does not update UMMG metadata granule identifiers when updateGranuleIdentifiers is set to false', async (t) => {
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
    updateGranuleIdentifiers: false,
    excludeDataGranule: false,
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

test('does not update UMMG metadata DataGranule when excludeDataGranule is set to true and updateGranuleIdentifiers is set to true', async (t) => {
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
    updateGranuleIdentifiers: true,
    excludeDataGranule: true,
  });
  const actualObject = await getJsonS3Object(cmrFile.bucket, cmrFile.key);

  // The GranuleUR is updated (since that is distinct from the DataGranule,
  // and updateGranuleIdentifiers is true), but the DataGranule is not updated
  // (since excludeDataGranule is true)
  const expectedObject = {
    GranuleUR: 'new-granule',
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
      excludeDataGranule: false,
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
    updateGranuleIdentifiers: true,
    excludeDataGranule: false,
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual, expected);
});

test('does not update Echo10 DataGranule metadata when excludeDataGranule is set to true', async (t) => {
  const cmrFile = t.context.cmrFileXml;
  const { cmrXmlFixture } = t.context;

  const expected = await parseXmlString(cmrXmlFixture);
  // The GranuleUR is updated (since that is distinct from the DataGranule,
  // and updateGranuleIdentifiers is true), but the DataGranule is not updated
  // (since excludeDataGranule is true)
  expected.Granule.GranuleUR = 'updated-id';
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
    updateGranuleIdentifiers: true,
    excludeDataGranule: true,
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual.Granule.GranuleUR, expected.Granule.GranuleUR);
  t.deepEqual(actual.Granule.DataGranule, expected.Granule.DataGranule);
  t.deepEqual(actual.Granule.AssociatedBrowseImageUrls, expected.Granule.AssociatedBrowseImageUrls);
});

test('updateCMRMetadata does not update ECHO10 metadata granule identifiers when updateGranuleIdentifiers is set to false', async (t) => {
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
    updateGranuleIdentifiers: false,
    excludeDataGranule: false,
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual, expected);
});

test('publishes UMMG metadata when publish is set to true', async (t) => {
  const cmrFile = t.context.cmrFileJson;
  const result = await updateCMRMetadata({
    granuleId: 'new-granule',
    producerGranuleId: 'original-id',
    excludeDataGranule: false,
    cmrFile: t.context.cmrFileJson,
    files: [],
    distEndpoint: 'https://fake-dist-endpoint',
    published: true,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleIdentifiers: true,
    testOverrides: {
      publish2CMRMethod: () => ({
        conceptId: 'C123',
        granuleId: 'updated-granule',
        filename: `s3://${cmrFile.bucket}/${cmrFile.key}`,
        metadataFormat: 'umm_json',
        link: 'https://example.com/concepts/C123.umm_json',
      }),
      getCmrSettingsMethod: () => 'someValue',
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
      DayNightFlag: 'Unspecified',
      // Date mocked in tests, as noted above, so this is the expected value for ProductionDateTime
      // despite actually being the time the task is ran (which is what is mocked, Date.now())
      ProductionDateTime: new Date('2024-01-01T00:00:00Z').toISOString(),
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

  const publish2CMRMethod = sinon.spy(() => ({
    conceptId: 'C123',
    granuleId: 'updated-granule',
    filename: `s3://${cmrFile.bucket}/${cmrFile.key}`,
    metadataFormat: 'umm_json',
    link: 'https://example.com/concepts/C123.umm_json',
  }));

  const result = await updateCMRMetadata({
    granuleId: 'updated-id',
    producerGranuleId: 'original-id',
    excludeDataGranule: false,
    cmrFile,
    files: [],
    distEndpoint: 'https://example.com',
    published: true,
    bucketTypes: {},
    cmrGranuleUrlType: 'both',
    distributionBucketMap: {},
    updateGranuleIdentifiers: true,
    testOverrides: {
      publish2CMRMethod,
      getCmrSettingsMethod: () => 'someValue',
    },
  });

  const actual = await getXMLMetadataAsString(`s3://${cmrFile.bucket}/${cmrFile.key}`).then(parseXmlString);
  t.deepEqual(actual, expected);

  t.like(result, {
    conceptId: 'C123',
    granuleId: 'updated-granule',
  });

  const publishedMetadata = publish2CMRMethod.getCall(0).args[0].metadataObject;
  t.is(publishedMetadata.Granule.GranuleUR, 'updated-id');

  t.true(publishedMetadata.Granule.DataGranule instanceof Map);
  t.is(publishedMetadata.Granule.DataGranule.get('ProducerGranuleId'), 'original-id');

  t.deepEqual(publishedMetadata.Granule.AssociatedBrowseImageUrls, { ProviderBrowseUrl: [] });
  t.true(Array.isArray(publishedMetadata.Granule.OnlineAccessURLs.OnlineAccessURL));
  t.true(Array.isArray(publishedMetadata.Granule.OnlineResources.OnlineResource));
});
