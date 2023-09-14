const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');
const omit = require('lodash/omit');

const cmrUtils = rewire('../../cmr-utils');

const constructOnlineAccessUrls = cmrUtils.__get__('constructOnlineAccessUrls');
const constructRelatedUrls = cmrUtils.__get__('constructRelatedUrls');
const getS3CredentialsObject = cmrUtils.__get__('getS3CredentialsObject');
const mapCNMTypeToCMRType = cmrUtils.__get__('mapCNMTypeToCMRType');

const sortByURL = (a, b) => (a.URL < b.URL ? -1 : 1);

const distEndpoint = 'https://endpoint';
const s3CredentialsEndpointObject = getS3CredentialsObject(`${distEndpoint}/s3credentials`);

test.beforeEach((t) => {
  t.context.bucketConfig = {
    private: { name: randomId('private'), type: 'private' },
    protected: { name: randomId('protected'), type: 'protected' },
    public: { name: randomId('public'), type: 'public' },
  };

  t.context.bucketTypes = Object.values(t.context.bucketConfig)
    .reduce(
      (acc, { name, type }) => ({ ...acc, [name]: type }),
      {}
    );

  t.context.distributionBucketMap = {
    [t.context.bucketConfig.protected.name]: t.context.bucketConfig.protected.name,
    [t.context.bucketConfig.public.name]: t.context.bucketConfig.public.name,
  };
});

test('mapCNMTypeToCMRType returns a mapping for non science data type', (t) => {
  t.is(mapCNMTypeToCMRType('browse'), 'GET RELATED VISUALIZATION');
  t.is(mapCNMTypeToCMRType('browse', 's3'), 'GET RELATED VISUALIZATION');
});

test('mapCNMTypeToCMRType returns a mapping for science data type', (t) => {
  t.is(mapCNMTypeToCMRType('data'), 'GET DATA');
  t.is(mapCNMTypeToCMRType('data', 's3'), 'GET DATA');
  t.is(mapCNMTypeToCMRType('data', 's3', true), 'GET DATA VIA DIRECT ACCESS');
});

test('mapCNMTypeToCMRType returns a default mapping if non CNM mapping specified', (t) => {
  t.is(mapCNMTypeToCMRType('NOTAREALVALUE'), 'GET DATA');
  t.is(mapCNMTypeToCMRType('NOTAREALVALUE', 's3'), 'GET DATA');
  t.is(mapCNMTypeToCMRType('NOTAREALVALUE', 's3', true), 'GET DATA VIA DIRECT ACCESS');
  t.is(mapCNMTypeToCMRType(undefined), 'GET DATA');
  t.is(mapCNMTypeToCMRType(undefined, 's3'), 'GET DATA');
  t.is(mapCNMTypeToCMRType(undefined, 's3', true), 'GET DATA VIA DIRECT ACCESS');
});

test('constructOnlineAccessUrls returns both distribution and s3 urls for protected data when cmrGranuleUrlType is not set and useDirectS3Type is not set', (t) => {
  const movedFiles = [
    {
      key: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
  ];
  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/some/path/protected-file.hdf`,
      Description: 'Download protected-file.hdf',
      URLDescription: 'Download protected-file.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.protected.name}/some/path/protected-file.hdf`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});

test('constructOnlineAccessUrls returns both distribution and s3 urls for protected data when cmrGranuleUrlType is not set and useDirectS3Type is true', (t) => {
  const movedFiles = [
    {
      key: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
  ];
  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/some/path/protected-file.hdf`,
      Description: 'Download protected-file.hdf',
      URLDescription: 'Download protected-file.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.protected.name}/some/path/protected-file.hdf`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA VIA DIRECT ACCESS',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
    useDirectS3Type: true,
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});

test('constructOnlineAccessUrls returns correct url for public data when cmrGranuleUrlType is distribution', (t) => {
  const publicBucketName = t.context.bucketConfig.public.name;
  const movedFiles = [
    {
      key: 'some/path/browse_image.jpg',
      bucket: publicBucketName,
    },
  ];
  const expected = [
    {
      URL: `${distEndpoint}/${publicBucketName}/some/path/browse_image.jpg`,
      Description: 'Download browse_image.jpg',
      URLDescription: 'Download browse_image.jpg',
      Type: 'GET DATA',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: t.context.distributionBucketMap,
    useDirectS3Type: true,
  });

  t.deepEqual(actual, expected);
});

test('constructOnlineAccessUrls returns empty url list for private data.', (t) => {
  const privateBucket = t.context.bucketConfig.private.name;
  const movedFiles = [
    {
      key: 'some/path/top/secretfile',
      bucket: privateBucket,
    },
  ];
  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, []);
});

test('constructOnlineAccessUrls returns expected array when called with file list and cmrGranuleUrlType is not set', (t) => {
  const movedFiles = [
    {
      key: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name,
      type: 'data',
    },
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
      type: 'browse',
    },
    {
      key: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name,
      type: 'data',
    },
  ];

  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'Download protected.hdf',
      URLDescription: 'Download protected.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'Download publicfile.jpg',
      URLDescription: 'Download publicfile.jpg',
      Type: 'GET RELATED VISUALIZATION',
    },
    {
      URL: `s3://${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET RELATED VISUALIZATION',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});

test('constructOnlineAccessUrls returns correct links when cmrGranuleUrlType is s3', (t) => {
  const movedFiles = [
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
      filename: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      type: 'browse',
    },
  ];

  const expected = [
    {
      URL: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET RELATED VISUALIZATION',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    cmrGranuleUrlType: 's3',
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, expected.sort(sortByURL));
});

test('constructOnlineAccessUrls returns no links when cmrGranuleUrlType is none', (t) => {
  const movedFiles = [
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
      filename: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      type: 'browse',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    cmrGranuleUrlType: 'none',
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, []);
});

test('constructOnlineAccessUrls throws error if URL type is distribution and distribution endpoint is missing', (t) => {
  t.throws(() => constructOnlineAccessUrls({
    distEndpoint: {},
    cmrGranuleUrlType: 'distribution',
  }));
});

test('constructOnlineAccessUrls returns expected array grouped by URL type starting with distribution files', (t) => {
  const movedFiles = [
    {
      key: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name,
      type: 'data',
    },
    {
      key: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name,
      type: 'data',
    },
    {
      key: 'another/path/public.dmrpp',
      bucket: t.context.bucketConfig.public.name,
      type: 'metadata',
    },
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
      type: 'browse',
    },
  ];

  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'Download protected.hdf',
      URLDescription: 'Download protected.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.public.name}/another/path/public.dmrpp`,
      Description: 'Download public.dmrpp',
      URLDescription: 'Download public.dmrpp',
      Type: 'EXTENDED METADATA',
    },
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'Download publicfile.jpg',
      URLDescription: 'Download publicfile.jpg',
      Type: 'GET RELATED VISUALIZATION',
    },
    {
      URL: `s3://${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.public.name}/another/path/public.dmrpp`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'EXTENDED METADATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'This link provides direct download access via S3 to the granule',
      URLDescription: 'This link provides direct download access via S3 to the granule',
      Type: 'GET RELATED VISUALIZATION',
    },
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, expected);
});

test('constructRelatedUrls returns expected array when called with file list and cmrGranuleUrlType is not set and useDirectS3Type is not set', (t) => {
  const movedFiles = [
    {
      key: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name,
    },
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
    },
    {
      key: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
  ];

  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'Download protected.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'Download publicfile.jpg',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA',
    },
    omit(s3CredentialsEndpointObject, 'URLDescription'),
  ];

  const actual = constructRelatedUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});

test('constructRelatedUrls returns expected array when called with file list and cmrGranuleUrlType is not set and useDirectS3Type is true', (t) => {
  const movedFiles = [
    {
      key: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name,
    },
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
    },
    {
      key: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
  ];

  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'Download protected.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'Download publicfile.jpg',
      Type: 'GET DATA',
    },
    {
      URL: `s3://${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA VIA DIRECT ACCESS',
    },
    {
      URL: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA VIA DIRECT ACCESS',
    },
    omit(s3CredentialsEndpointObject, 'URLDescription'),
  ];

  const actual = constructRelatedUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
    useDirectS3Type: true,
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});

test('constructRelatedUrls returns expected array when called with file list and cmrGranuleUrlType is distribution', (t) => {
  const movedFiles = [
    {
      key: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name,
    },
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
    },
    {
      key: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
  ];

  const expected = [
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'Download protected.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'Download publicfile.jpg',
      Type: 'GET DATA',
    },
    omit(s3CredentialsEndpointObject, 'URLDescription'),
  ];

  const actual = constructRelatedUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});

test('constructRelatedUrls returns expected array when called with an empty file list', (t) => {
  const movedFiles = [];
  const expected = [omit(s3CredentialsEndpointObject, 'URLDescription')];

  const actual = constructRelatedUrls({
    files: movedFiles,
    distEndpoint,
    bucketsTypes: t.context.bucketTypes,
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, expected);
});

test('constructRelatedUrls returns s3 urls when cmrGranuleUrlType is s3', (t) => {
  const movedFiles = [
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
      filename: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      type: 'browse',
    },
  ];

  const expected = [
    {
      URL: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET RELATED VISUALIZATION',
    },
    omit(s3CredentialsEndpointObject, 'URLDescription'),
  ];

  const actual = constructRelatedUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    cmrGranuleUrlType: 's3',
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, expected);
});

test('constructRelatedUrls returns just s3 credentials url when cmrGranuleUrlType is none', (t) => {
  const movedFiles = [
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name,
      filename: `s3://${t.context.bucketConfig.public.name}/path/publicfile.jpg`,
      type: 'browse',
    },
  ];

  const actual = constructRelatedUrls({
    files: movedFiles,
    distEndpoint,
    bucketTypes: t.context.bucketTypes,
    cmrGranuleUrlType: 'none',
    distributionBucketMap: t.context.distributionBucketMap,
  });

  t.deepEqual(actual, [omit(s3CredentialsEndpointObject, 'URLDescription')]);
});
