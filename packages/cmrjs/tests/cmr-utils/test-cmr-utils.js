const test = require('ava');
const path = require('path');
const rewire = require('rewire');
const proxyquire = require('proxyquire').noPreserveCache();
const fs = require('fs-extra');
const xml2js = require('xml2js');
const sinon = require('sinon');
const { promisify } = require('util');
const pickAll = require('lodash/fp/pickAll');
const {
  buildS3Uri,
  getS3Object,
  parseS3Uri,
  promiseS3Upload,
  recursivelyDeleteS3Bucket,
  s3GetObjectTagging,
  s3TagSetToQueryString,
  getObjectStreamContents,
  getJsonS3Object,
} = require('@cumulus/aws-client/S3');
const { CMR } = require('@cumulus/cmr-client');
const { s3, secretsManager } = require('@cumulus/aws-client/services');
const { randomId, readJsonFixture, randomString } = require('@cumulus/common/test-utils');
const errors = require('@cumulus/errors');
const launchpad = require('@cumulus/launchpad-auth');

const {
  addEtagsToFileObjects,
  constructCmrConceptLink,
  getCmrSettings,
  granuleToCmrFileObject,
  mapFileEtags,
  removeEtagsFromFileObjects,
} = require('../../cmr-utils');
const cmrUtil = rewire('../../cmr-utils');
const { isCMRFile, isISOFile, getGranuleTemporalInfo } = cmrUtil;
const { xmlParseOptions } = require('../../utils');
const uploadEcho10CMRFile = cmrUtil.__get__('uploadEcho10CMRFile');
const uploadUMMGJSONCMRFile = cmrUtil.__get__('uploadUMMGJSONCMRFile');
const buildCMRQuery = cmrUtil.__get__('buildCMRQuery');
const stubDistributionBucketMap = {
  'fake-bucket': 'fake-bucket',
  'mapped-bucket': 'mapped/path/example',
  'cumulus-test-sandbox-protected': 'cumulus-test-sandbox-protected',
  'cumulus-test-sandbox-protected-2': 'cumulus-test-sandbox-protected-2',
  'cumulus-test-sandbox-public': 'cumulus-test-sandbox-public',
};
const {
  generateFileUrl,
} = proxyquire('../../cmr-utils', {
  '@cumulus/aws-client/S3': {
    buildS3Uri,
    getS3Object,
    getJsonS3Object: () => Promise.resolve(stubDistributionBucketMap),
    parseS3Uri,
    promiseS3Upload,
    s3GetObjectTagging,
    s3TagSetToQueryString,
  },
});

const sortByURL = (a, b) => (a.URL < b.URL ? -1 : 1);

const launchpadSecret = randomId('launchpad-secret');
const launchpadPassphrase = randomId('launchpad-passphrase');
const cmrPasswordSecret = randomId('cmr-password-secret');
const cmrPassword = randomId('cmr-password');

test.before(async (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';

  process.env.cmr_provider = 'CUMULUS-TEST';
  process.env.cmr_client_id = 'Cumulus-Client-Id';
  process.env.cmr_oauth_provider = 'earthdata';

  process.env.launchpad_passphrase_secret_name = launchpadSecret;
  process.env.launchpad_api = 'launchpad-api';
  process.env.launchpad_certificate = 'launchpad-cert';

  await secretsManager().createSecret({
    Name: launchpadSecret,
    SecretString: launchpadPassphrase,
  }).promise();

  process.env.cmr_password_secret_name = cmrPasswordSecret;
  process.env.cmr_username = 'cmr-user';

  await secretsManager().createSecret({
    Name: cmrPasswordSecret,
    SecretString: cmrPassword,
  }).promise();

  t.context.launchpadStub = sinon.stub(launchpad, 'getLaunchpadToken')
    .callsFake((config) => Promise.resolve(`${config.passphrase}-${config.api}-${config.certificate}`));

  const bucketsJson = await readJsonFixture(path.join(__dirname, '../fixtures/buckets.json'));

  t.context.bucketTypes = Object.fromEntries(
    Object.values(bucketsJson).map(({ name, type }) => [name, type])
  );

  t.context.distributionBucketMap = Object.fromEntries(
    Object.values(bucketsJson).map(({ name }) => [name, name])
  );
});

test.after.always(async (t) => {
  await Promise.all([
    await secretsManager().deleteSecret({
      SecretId: launchpadSecret,
      ForceDeleteWithoutRecovery: true,
    }).promise(),
    await secretsManager().deleteSecret({
      SecretId: cmrPasswordSecret,
      ForceDeleteWithoutRecovery: true,
    }).promise(),
  ]);

  t.context.launchpadStub.restore();
});

test('isCMRFile returns true if fileobject has valid .cmr.xml filename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr.xml',
  };
  t.true(isCMRFile(fileObj));
});

test('isCMRFile returns false if fileobject does not have a valid xml filename', (t) => {
  const fileObj = {
    filename: 'invalidfile.xml',
  };
  t.false(isCMRFile(fileObj));
});

test('isCMRFile returns true if fileobject has a valid cmr_iso.xml filename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr_iso.xml',
  };
  t.true(isCMRFile(fileObj));
});

test('isCMRFile returns true if fileobject has valid json filename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr.json',
  };
  t.true(isCMRFile(fileObj));
});

test('isCMRFile returns false if fileobject does not valid json filename', (t) => {
  const fileObj = {
    filename: 'invalidfile.json',
  };
  t.false(isCMRFile(fileObj));
});

test('isCMRFile returns false if fileobject is invalid', (t) => {
  const fileObj = { bad: 'object' };
  t.false(isCMRFile(fileObj));
});

test('isISOFile returns true if fileobject has valid .iso.xml filename', (t) => {
  const fileObj = {
    filename: 'validfile.iso.xml',
  };
  t.true(isISOFile(fileObj));
});

test('isISOFile returns false if fileobject does not have a valid .iso.xml filename', (t) => {
  const fileObj = {
    filename: 'invalidfile.xml',
  };
  t.false(isISOFile(fileObj));
});

test('isISOFile returns true if fileobject has a valid cmr_iso.xml filename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr_iso.xml',
  };
  t.true(isISOFile(fileObj));
});

test('isISOFile returns false if fileobject is invalid', (t) => {
  const fileObj = { bad: 'object' };
  t.false(isISOFile(fileObj));
});

test('granuleToCmrFileObject returns correct objects for files with a bucket/key', (t) => {
  const granule = {
    granuleId: 'fake-id',
    files: [{
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    }],
  };
  t.deepEqual(
    granuleToCmrFileObject(granule),
    [{
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    }]
  );
});

test('granuleToCmrFileObject returns correct objects for files with a filename', (t) => {
  const granule = {
    granuleId: 'fake-id',
    files: [{
      filename: 's3://bucket/fake.cmr.xml',
    }],
  };
  t.deepEqual(
    granuleToCmrFileObject(granule),
    [{
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    }]
  );
});

test('addEtagsToFileObjects adds etag for granule file', (t) => {
  const bucket = 'test-bucket';
  const key = 'some-file.cmr.json';
  const etag = '"abcd1234"';
  const granule = {
    files: [
      {
        bucket,
        key,
      },
    ],
  };
  const etags = {
    [buildS3Uri(bucket, key)]: etag,
  };
  const expectation = {
    files: [
      {
        bucket,
        key,
        etag,
      },
    ],
  };
  addEtagsToFileObjects(granule, etags);
  t.deepEqual(granule, expectation);
});

test('removeEtagsFromFileObjects removes etag from granule file', (t) => {
  const bucket = 'test-bucket';
  const key = 'some-file.cmr.json';
  const etag = '"abcd1234"';
  const granule = {
    files: [
      {
        bucket,
        key,
        etag,
      },
    ],
  };
  const expectation = {
    files: [
      {
        bucket,
        key,
      },
    ],
  };
  removeEtagsFromFileObjects(granule);
  t.deepEqual(granule, expectation);
});

test('mapFileEtags returns map of S3 URIs to etags', (t) => {
  const bucket = 'test-bucket';
  const key = 'some-file.cmr.json';
  const etag = '"abcd1234"';
  const granuleFiles = [
    {
      bucket,
      key,
      etag,
    },
  ];
  const expectation = {
    [buildS3Uri(bucket, key)]: etag,
  };
  t.deepEqual(
    mapFileEtags(granuleFiles),
    expectation
  );
});

test('granuleToCmrFileObject returns correct objects for files with a bucket/key, filtering out non-CMR files', (t) => {
  const granule = {
    granuleId: 'fake-id',
    files: [{
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    },
    {
      bucket: 'bucket',
      key: 'fake.iso.xml',
    }],
  };
  t.deepEqual(
    granuleToCmrFileObject(granule),
    [{
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    }]
  );
});

test('granuleToCmrFileObject returns correct objects for files with a bucket/key, filtering for ISO files', (t) => {
  const granule = {
    granuleId: 'fake-id',
    files: [{
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    },
    {
      bucket: 'bucket',
      key: 'fake.iso.xml',
    }],
  };
  const filterFunc = isISOFile;
  t.deepEqual(
    granuleToCmrFileObject(granule, filterFunc),
    [{
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.iso.xml',
    }]
  );
});

test('granuleToCmrFileObject returns correct objects for files with a bucket/key, filtering for "easterbunny" files', (t) => {
  const granule = {
    granuleId: 'fake-id',
    files: [{
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    },
    {
      bucket: 'bucket',
      key: 'fake.easterbunny.xml',
    }],
  };
  const filterFunc = (fileobject) => fileobject.key.endsWith('.easterbunny.xml');
  t.deepEqual(
    granuleToCmrFileObject(granule, filterFunc),
    [{
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.easterbunny.xml',
    }]
  );
});

test('granuleToCmrFileObject returns correct objects for files with a bucket/key, filtering for ISO and CMR files', (t) => {
  const granule = {
    granuleId: 'fake-id',
    files: [{
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    },
    {
      bucket: 'bucket',
      key: 'fake.iso.xml',
    },
    {
      bucket: 'bucket',
      key: 'fake.other.xml',
    }],
  };
  const filterFunc = (fileobject) => fileobject.key.endsWith('.iso.xml') || fileobject.key.endsWith('cmr.xml');
  t.deepEqual(
    granuleToCmrFileObject(granule, filterFunc),
    [{
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.cmr.xml',
    },
    {
      granuleId: 'fake-id',
      bucket: 'bucket',
      key: 'fake.iso.xml',
    }]
  );
});

test('constructCmrConceptLink returns echo10 link', (t) => {
  t.is(
    constructCmrConceptLink('G1234-DAAC', 'echo10'),
    'https://cmr.earthdata.nasa.gov/search/concepts/G1234-DAAC.echo10'
  );
});

test('constructCmrConceptLink returns umm_json link', (t) => {
  t.is(
    constructCmrConceptLink('G1234-DAAC', 'umm_json'),
    'https://cmr.earthdata.nasa.gov/search/concepts/G1234-DAAC.umm_json'
  );
});

test.serial('uploadEcho10CMRFile uploads CMR File to S3 correctly, preserving tags and setting ContentType', async (t) => {
  const cmrFile = {
    bucket: 'echo10filebucket',
    key: 'metadata.cmr.xml',
  };
  await s3().createBucket({ Bucket: cmrFile.bucket });
  try {
    const fakeXmlString = '<Granule>fake-granule</Granule>';
    await promiseS3Upload({
      params: {
        Bucket: cmrFile.bucket,
        Key: cmrFile.key,
        Body: fakeXmlString,
        Tagging: 'tagA=iamtag1&tagB=iamtag2',
      },
    });

    const newXmlString = '<Granule>new-granule</Granule>';
    await uploadEcho10CMRFile(newXmlString, cmrFile);

    const s3Obj = await getS3Object(cmrFile.bucket, cmrFile.key);
    t.is(await getObjectStreamContents(s3Obj.Body), newXmlString);
    t.is(s3Obj.ContentType, 'application/xml');

    const tags = await s3GetObjectTagging(cmrFile.bucket, cmrFile.key);
    t.deepEqual(tags.TagSet, [{ Key: 'tagA', Value: 'iamtag1' }, { Key: 'tagB', Value: 'iamtag2' }]);
  } finally {
    recursivelyDeleteS3Bucket(cmrFile.bucket);
  }
});

test.serial('uploadUMMGJSONCMRFile uploads CMR File to S3 correctly, preserving tags and setting ContentType', async (t) => {
  const cmrFile = {
    bucket: 'ummg-file-bucket',
    key: 'metadata.cmr.json',
  };
  await s3().createBucket({ Bucket: cmrFile.bucket });
  try {
    const fakeMetadataObject = { fake: 'data' };
    await promiseS3Upload({
      params: {
        Bucket: cmrFile.bucket,
        Key: cmrFile.key,
        Body: JSON.stringify(fakeMetadataObject),
        Tagging: 'tagA=iamtag1&tagB=iamtag2',
      },
    });

    const newFakeMetaObj = { newFake: 'granule' };
    await uploadUMMGJSONCMRFile(newFakeMetaObj, cmrFile);

    const s3Obj = await getS3Object(cmrFile.bucket, cmrFile.key);
    t.deepEqual(await getJsonS3Object(cmrFile.bucket, cmrFile.key), newFakeMetaObj);
    t.is(s3Obj.ContentType, 'application/json');

    const tags = await s3GetObjectTagging(cmrFile.bucket, cmrFile.key);
    t.deepEqual(tags.TagSet, [{ Key: 'tagA', Value: 'iamtag1' }, { Key: 'tagB', Value: 'iamtag2' }]);
  } finally {
    recursivelyDeleteS3Bucket(cmrFile.bucket);
  }
});

test.serial('updateEcho10XMLMetadata adds granule files correctly to OnlineAccessURLs/OnlineResources', async (t) => {
  const { bucketTypes, distributionBucketMap } = t.context;

  // Yes, ETag values always include enclosing double-quotes
  const expectedEtag = '"abc"';
  const uploadEchoSpy = sinon.spy(() => Promise.resolve({ ETag: expectedEtag }));
  const cmrXml = await fs.readFile(
    path.join(__dirname, '../fixtures/cmrFileUpdateFixture.cmr.xml'),
    'utf8'
  );
  const cmrMetadata = await promisify(xml2js.parseString)(cmrXml, xmlParseOptions);
  const filesObject = await readJsonFixture(
    path.join(__dirname, '../fixtures/filesObjectFixture.json')
  );

  const distEndpoint = 'https://distendpoint.com';

  const updateEcho10XMLMetadata = cmrUtil.__get__('updateEcho10XMLMetadata');

  const revertGenerateXml = cmrUtil.__set__('generateEcho10XMLString', () => 'testXmlString');
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRXMLFile', () => cmrMetadata);
  const revertMockUpload = cmrUtil.__set__('uploadEcho10CMRFile', uploadEchoSpy);

  const onlineAccessURLsExpected = [
    {
      URL: 'https://textFixtureUrl.gov/someCmrFile',
      URLDescription: 'File to download',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected/MOD09GQ___006/2016/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248.hdf`,
      URLDescription: 'Download MOD09GQ.A6391489.a3Odk1.006.3900731509248.hdf',
    },
    {
      URL: 's3://cumulus-test-sandbox-protected/MOD09GQ___006/2016/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248.hdf',
      URLDescription: 'This link provides direct download access via S3 to the granule',
    },
  ];
  const onlineResourcesExpected = [
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected-2/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248.cmr.json`,
      Type: 'EXTENDED METADATA',
      Description: 'Download MOD09GQ.A6391489.a3Odk1.006.3900731509248.cmr.json',
    },
    {
      URL: `${distEndpoint}/s3credentials`,
      Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
      Type: 'VIEW RELATED INFORMATION',
    },
    {
      URL: 's3://cumulus-test-sandbox-protected-2/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248.cmr.json',
      Type: 'EXTENDED METADATA',
      Description: 'This link provides direct download access via S3 to the granule',
    },
  ];
  const AssociatedBrowseExpected = [
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-public/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg`,
      Description: 'Download MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg',
    },
    {
      URL: 's3://cumulus-test-sandbox-public/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg',
      Description: 'This link provides direct download access via S3 to the granule',
    },
  ];

  try {
    const { metadataObject, etag } = await updateEcho10XMLMetadata({
      cmrFile: { filename: 's3://cumulus-test-sandbox-private/notUsed' },
      files: filesObject,
      distEndpoint,
      bucketTypes,
      distributionBucketMap,
    });

    t.is(etag, expectedEtag, "ETag doesn't match");
    t.deepEqual(metadataObject.Granule.OnlineAccessURLs.OnlineAccessURL.sort(sortByURL),
      onlineAccessURLsExpected.sort(sortByURL));
    t.deepEqual(metadataObject.Granule.OnlineResources.OnlineResource.sort(sortByURL),
      onlineResourcesExpected.sort(sortByURL));
    t.deepEqual(
      metadataObject.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl.sort(sortByURL),
      AssociatedBrowseExpected.sort(sortByURL)
    );
    t.true(uploadEchoSpy.calledWith('testXmlString',
      { filename: 's3://cumulus-test-sandbox-private/notUsed' }));
  } finally {
    revertMetaObject();
    revertMockUpload();
    revertGenerateXml();
  }
});

test.serial('updateUMMGMetadata adds Type correctly to RelatedURLs for granule with UMM-G version 1.5 ', async (t) => {
  const { bucketTypes, distributionBucketMap } = t.context;

  // Yes, ETag values always include enclosing double-quotes
  const expectedEtag = '"abc"';
  const uploadEchoSpy = sinon.spy(() => Promise.resolve({ ETag: expectedEtag }));

  const cmrJSON = await fs.readFile(
    path.join(__dirname, '../fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json'),
    'utf8'
  );
  const cmrMetadata = JSON.parse(cmrJSON);
  const filesObject = await readJsonFixture(
    path.join(__dirname, '../fixtures/UMMGFilesObjectFixture.json')
  );

  const distEndpoint = 'https://distendpoint.com';

  const updateUMMGMetadata = cmrUtil.__get__('updateUMMGMetadata');

  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);
  const revertMockUpload = cmrUtil.__set__('uploadUMMGJSONCMRFile', uploadEchoSpy);

  const expectedRelatedURLs = [
    {
      URL: 'https://nasa.github.io/cumulus/docs/cumulus-docs-readme',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf`,
      Description: 'Download MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg`,
      Description: 'Download MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg',
      Type: 'GET RELATED VISUALIZATION',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected-2/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json`,
      Description: 'Download MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json',
      Type: 'EXTENDED METADATA',
    },
    {
      URL: `${distEndpoint}/s3credentials`,
      Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
      Type: 'VIEW RELATED INFORMATION',
    },
    {
      URL: 's3://cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf',
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA',
    },
    {
      URL: 's3://cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg',
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET RELATED VISUALIZATION',
    },
    {
      URL: 's3://cumulus-test-sandbox-protected-2/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json',
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'EXTENDED METADATA',
    },
  ];

  try {
    const { metadataObject, etag } = await updateUMMGMetadata({
      cmrFile: { filename: 's3://cumulus-test-sandbox-private/notUsed' },
      files: filesObject,
      distEndpoint,
      bucketTypes,
      distributionBucketMap,
    });

    t.is(etag, expectedEtag, "ETag doesn't match");
    t.deepEqual(metadataObject.RelatedUrls.sort(sortByURL), expectedRelatedURLs.sort(sortByURL));
  } finally {
    revertMetaObject();
    revertMockUpload();
  }
});

test.serial('updateUMMGMetadata adds Type correctly to RelatedURLs for granule with UMM-G version 1.6.2 ', async (t) => {
  const { bucketTypes, distributionBucketMap } = t.context;

  // Yes, ETag values always include enclosing double-quotes
  const expectedEtag = '"abc"';
  const uploadEchoSpy = sinon.spy(() => Promise.resolve({ ETag: expectedEtag }));

  const cmrJSON = await fs.readFile(
    path.join(__dirname, '../fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314_v1.6.2.cmr.json'),
    'utf8'
  );
  const cmrMetadata = JSON.parse(cmrJSON);
  const filesObject = await readJsonFixture(
    path.join(__dirname, '../fixtures/UMMGFilesObjectFixture.json')
  );

  const distEndpoint = 'https://distendpoint.com';

  const updateUMMGMetadata = cmrUtil.__get__('updateUMMGMetadata');

  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);
  const revertMockUpload = cmrUtil.__set__('uploadUMMGJSONCMRFile', uploadEchoSpy);

  const expectedRelatedURLs = [
    {
      URL: 'https://nasa.github.io/cumulus/docs/cumulus-docs-readme',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf`,
      Description: 'Download MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf',
      Type: 'GET DATA',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg`,
      Description: 'Download MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg',
      Type: 'GET RELATED VISUALIZATION',
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected-2/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json`,
      Description: 'Download MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json',
      Type: 'EXTENDED METADATA',
    },
    {
      URL: `${distEndpoint}/s3credentials`,
      Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
      Type: 'VIEW RELATED INFORMATION',
    },
    {
      URL: 's3://cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf',
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET DATA VIA DIRECT ACCESS',
    },
    {
      URL: 's3://cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg',
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'GET RELATED VISUALIZATION',
    },
    {
      URL: 's3://cumulus-test-sandbox-protected-2/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json',
      Description: 'This link provides direct download access via S3 to the granule',
      Type: 'EXTENDED METADATA',
    },
  ];

  try {
    const { metadataObject, etag } = await updateUMMGMetadata({
      cmrFile: { filename: 's3://cumulus-test-sandbox-private/notUsed' },
      files: filesObject,
      distEndpoint,
      bucketTypes,
      distributionBucketMap,
    });

    t.is(etag, expectedEtag, "ETag doesn't match");
    t.deepEqual(metadataObject.RelatedUrls.sort(sortByURL), expectedRelatedURLs.sort(sortByURL));
  } finally {
    revertMetaObject();
    revertMockUpload();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR json file with RangeDateTime', async (t) => {
  const cmrJSON = await fs.readFile('./tests/fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json', 'utf8');
  const cmrMetadata = JSON.parse(cmrJSON);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2016-01-09T11:40:45.032Z',
    endingDateTime: '2016-01-09T11:41:12.027Z',
    productionDateTime: '2016-01-09T11:40:45.032Z',
    lastUpdateDateTime: '2018-12-21T17:30:31.424Z',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr.json',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR json file with SingleDateTime', async (t) => {
  const cmrJSON = await fs.readFile('./tests/fixtures/MOD09GQ.singleDateTime.cmr.json', 'utf8');
  const cmrMetadata = JSON.parse(cmrJSON);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2022-01-18T14:40:00.000Z',
    endingDateTime: '2022-01-18T14:40:00.000Z',
    productionDateTime: '2016-01-09T11:40:45.032Z',
    lastUpdateDateTime: '2018-12-21T17:30:31.424Z',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr.json',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR json falling back to "Insert" ProviderDate', async (t) => {
  const cmrJSON = await fs.readFile('./tests/fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314_insert.cmr.json', 'utf8');
  const cmrMetadata = JSON.parse(cmrJSON);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2016-01-09T11:40:45.032Z',
    endingDateTime: '2016-01-09T11:41:12.027Z',
    productionDateTime: '2016-01-09T11:40:45.032Z',
    lastUpdateDateTime: '2018-12-20T17:30:31.424Z',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr.json',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR json falling back to "Create" ProviderDate', async (t) => {
  const cmrJSON = await fs.readFile('./tests/fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314_create.cmr.json', 'utf8');
  const cmrMetadata = JSON.parse(cmrJSON);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2016-01-09T11:40:45.032Z',
    endingDateTime: '2016-01-09T11:41:12.027Z',
    productionDateTime: '2016-01-09T11:40:45.032Z',
    lastUpdateDateTime: '2018-12-19T17:30:31.424Z',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr.json',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR xml file with RangeDateTime', async (t) => {
  const cmrXml = await fs.readFile('./tests/fixtures/cmrFileUpdateFixture.cmr.xml', 'utf8');
  const cmrMetadata = await (promisify(xml2js.parseString))(cmrXml, xmlParseOptions);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRXMLFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2017-10-24T00:00:00Z',
    endingDateTime: '2017-11-08T23:59:59Z',
    productionDateTime: '2018-07-19T12:01:01Z',
    lastUpdateDateTime: '2018-04-25T21:45:45.524053',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr.xml',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR xml file with SingleDateTime', async (t) => {
  const cmrXml = await fs.readFile('./tests/fixtures/cmrFileUpdateFixture.SingleDateTime.cmr.xml', 'utf8');
  const cmrMetadata = await (promisify(xml2js.parseString))(cmrXml, xmlParseOptions);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRXMLFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2022-01-24T00:00:00Z',
    endingDateTime: '2022-01-24T00:00:00Z',
    productionDateTime: '2018-07-19T12:01:01Z',
    lastUpdateDateTime: '2018-04-25T21:45:45.524053',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr.xml',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR ISO XML file with TimePeriod', async (t) => {
  const cmrXml = await fs.readFile('./tests/fixtures/ATL03_fixture.cmr_iso.xml', 'utf8');
  const cmrMetadata = await (promisify(xml2js.parseString))(cmrXml, xmlParseOptions);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRXMLFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2019-01-01T00:04:18.809303Z',
    endingDateTime: '2019-01-01T00:11:20.899913Z',
    productionDateTime: '2021-02-05T04:23:58.000000Z',
    lastUpdateDateTime: '2021-05-07T09:10:59.891292Z',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr_iso.xml',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR ISO XML file with TimeInstant', async (t) => {
  const cmrXml = await fs.readFile('./tests/fixtures/ATL03_fixture.SingleDateTime.cmr_iso.xml', 'utf8');
  const cmrMetadata = await (promisify(xml2js.parseString))(cmrXml, xmlParseOptions);
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRXMLFile', () => cmrMetadata);

  const expectedTemporalInfo = {
    beginningDateTime: '2022-01-18T00:04:18.000Z',
    endingDateTime: '2022-01-18T00:04:18.000Z',
    productionDateTime: '2021-02-05T04:23:58.000000Z',
    lastUpdateDateTime: '2021-05-07T09:10:59.891292Z',
  };

  try {
    const temporalInfo = await getGranuleTemporalInfo({
      granuleId: 'testGranuleId',
      files: [{
        bucket: 'bucket',
        key: 'test.cmr_iso.xml',
      }],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns empty object if cmr file s3 url is not available', async (t) => {
  const temporalInfo = await getGranuleTemporalInfo({
    granuleId: 'testGranuleId',
    files: [{
      path: 'path',
      name: 'test.cmr_iso.xml',
    }],
  });

  t.deepEqual(temporalInfo, {});
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType distribution', (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = generateFileUrl({
    file,
    distEndpoint,
    urlType: 'distribution',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, 'www.example.com/fake-bucket/folder/key.txt');
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType s3', (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = generateFileUrl({
    file,
    distEndpoint,
    urlType: 's3',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, filename);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType s3 with no filename', (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = generateFileUrl({
    file,
    distEndpoint,
    urlType: 's3',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, filename);
});

test.serial('generateFileUrl returns undefined for cmrGranuleUrlType none', (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = generateFileUrl({
    file,
    distEndpoint,
    urlType: 'none',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, undefined);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType distribution with bucket map defined', (t) => {
  const filename = 's3://mapped-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'mapped-bucket',
    key: 'folder/key.txt',
  };

  const url = generateFileUrl({
    file,
    distEndpoint,
    teaEndpoint: 'fakeTeaEndpoint',
    urlType: 'distribution',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, 'www.example.com/mapped/path/example/folder/key.txt');
});

test.serial('generateFileUrl throws error for cmrGranuleUrlType distribution with no bucket map defined', (t) => {
  const filename = 's3://other-fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'other-fake-bucket',
    key: 'folder/key.txt',
  };

  t.throws(() => generateFileUrl({
    file,
    distEndpoint,
    teaEndpoint: 'fakeTeaEndpoint',
    urlType: 'distribution',
    distributionBucketMap: stubDistributionBucketMap,
  }), { instanceOf: errors.MissingBucketMap });
});

test('getCmrSettings uses values in environment variables by default', async (t) => {
  const credentials = await getCmrSettings();

  t.deepEqual(credentials, {
    provider: 'CUMULUS-TEST',
    clientId: 'Cumulus-Client-Id',
    password: cmrPassword,
    username: 'cmr-user',
    oauthProvider: 'earthdata',
  });
});

test('getCmrSettings uses values in environment variables by default for launchpad auth', async (t) => {
  const credentials = await getCmrSettings({ oauthProvider: 'launchpad' });

  t.deepEqual(credentials, {
    provider: 'CUMULUS-TEST',
    clientId: 'Cumulus-Client-Id',
    token: `${launchpadPassphrase}-launchpad-api-launchpad-cert`,
    oauthProvider: 'launchpad',
  });
});

test('getCmrSettings uses values in config for earthdata oauth', async (t) => {
  const testPasswordSecret = randomId('test-password-secret');
  const testPassword = randomId('test-password');

  await secretsManager().createSecret({
    Name: testPasswordSecret,
    SecretString: testPassword,
  }).promise();

  try {
    const credentials = await getCmrSettings({
      provider: 'CUMULUS-PROV',
      clientId: 'test-client-id',
      username: 'cumulus',
      passwordSecretName: testPasswordSecret,
    });

    t.deepEqual(credentials, {
      provider: 'CUMULUS-PROV',
      clientId: 'test-client-id',
      password: testPassword,
      username: 'cumulus',
      oauthProvider: 'earthdata',
    });
  } finally {
    await secretsManager().deleteSecret({
      SecretId: testPasswordSecret,
      ForceDeleteWithoutRecovery: true,
    }).promise();
  }
});

test('getCmrSettings uses values in config for launchpad oauth', async (t) => {
  const testPassphraseSecret = randomId('test-passphrase-secret');
  const testPassphrase = randomId('test-password');

  await secretsManager().createSecret({
    Name: testPassphraseSecret,
    SecretString: testPassphrase,
  }).promise();

  try {
    const credentials = await getCmrSettings({
      oauthProvider: 'launchpad',
      passphraseSecretName: testPassphraseSecret,
      api: 'test-api',
      certificate: 'test-certificate',
    });

    t.deepEqual(credentials, {
      provider: 'CUMULUS-TEST',
      clientId: 'Cumulus-Client-Id',
      token: `${testPassphrase}-test-api-test-certificate`,
      oauthProvider: 'launchpad',
    });
  } finally {
    await secretsManager().deleteSecret({
      SecretId: testPassphraseSecret,
      ForceDeleteWithoutRecovery: true,
    }).promise();
  }
});

test('getFilename returns correct value', (t) => {
  t.is(
    cmrUtil.getFilename({ fileName: 'foo.txt' }),
    'foo.txt'
  );

  t.is(
    cmrUtil.getFilename({ name: 'foo2.txt' }),
    'foo2.txt'
  );

  t.is(
    cmrUtil.getFilename({ filename: '/path/to/foo3.txt' }),
    'foo3.txt'
  );

  t.is(
    cmrUtil.getFilename({ filepath: '/path/to/foo4.txt' }),
    'foo4.txt'
  );

  t.is(
    cmrUtil.getFilename({ key: '/path/to/foo5.txt' }),
    'foo5.txt'
  );
});

test('getFilename returns undefined if file name cannot be determined', (t) => {
  t.is(
    cmrUtil.getFilename({}),
    undefined
  );
});

test('getFileDescription returns correct description', (t) => {
  t.is(
    cmrUtil.getFileDescription({ fileName: 'foo.txt' }),
    'Download foo.txt'
  );
});

test('getFileDescription returns fallback if file name cannot be determined', (t) => {
  t.is(
    cmrUtil.getFileDescription({}),
    'File to download'
  );
});

const testMetadataObjectFromCMRFile = (filename, etag = 'foo') => async (t) => {
  // Simulate throwing a PreconditionFailed error from getObject() because
  // LocalStack ignores the `IfMatch` (and the `IfNoneMatch`) param passed
  // to S3.getObject()
  const errorSelector = {
    code: 'PreconditionFailed',
    errorCode: 412,
    message: 'At least one of the pre-conditions you specified did not hold',
  };
  const { metadataObjectFromCMRFile } = proxyquire(
    '../../cmr-utils',
    {
      '@cumulus/aws-client/S3': {
        waitForObject: (_, params) => {
          t.is(params.IfMatch, etag);
          return Promise.reject(Object.assign(new Error(), errorSelector));
        },
      },
    }
  );

  const error = await t.throwsAsync(metadataObjectFromCMRFile(filename, etag));

  t.deepEqual(pickAll(Object.keys(errorSelector), error), errorSelector);
};

test(
  'metadataObjectFromCMRFile throws PreconditionFailed when ETag does not match CMR XML metadata file',
  testMetadataObjectFromCMRFile('s3://bucket/fake.cmr.xml')
);

test(
  'metadataObjectFromCMRFile throws PreconditionFailed when ETag does not match CMR UMMG JSON metadata file',
  testMetadataObjectFromCMRFile('s3://bucket/fake.cmr.json')
);

test.serial('publish2CMR passes cmrRevisionId to publishECHO10XML2CMR', async (t) => {
  const cmrFileObject = { filename: 'test.cmr.xml', granuleId: 'testGranuleId' };
  const updatedXmlFile = { ...cmrFileObject, metadataObject: {} };

  const publishECHO10XML2CMRSpy = sinon.spy(() => Promise.resolve());
  const revertPublishECHO10XML2CMRSpy = cmrUtil.__set__('publishECHO10XML2CMR', publishECHO10XML2CMRSpy);
  const credentials = {};
  const cmrRevisionId = Math.floor(Math.random() * 100);

  t.teardown(() => {
    revertPublishECHO10XML2CMRSpy();
  });
  await cmrUtil.publish2CMR(updatedXmlFile, credentials, cmrRevisionId);
  t.is(publishECHO10XML2CMRSpy.getCall(0).args[2], cmrRevisionId);
});

test.serial('publish2CMR passes cmrRevisionId to publishUMMGJSON2CMR', async (t) => {
  const cmrFileObject = { filename: 'test.cmr.json', granuleId: 'testGranuleId', metadataObject: {} };
  const cmrRevisionId = Math.floor(Math.random() * 100);
  const credentials = {};

  const publishUMMGJSON2CMRSpy = sinon.spy(() => Promise.resolve());
  const revertPublishUMMGJSON2CMRSpy = cmrUtil.__set__('publishUMMGJSON2CMR', publishUMMGJSON2CMRSpy);

  t.teardown(() => {
    revertPublishUMMGJSON2CMRSpy();
  });

  await cmrUtil.publish2CMR(cmrFileObject, credentials, cmrRevisionId);
  t.is(publishUMMGJSON2CMRSpy.getCall(0).args[2], cmrRevisionId);
});

test.serial('publishECHO10XML2CMR passes cmrRevisionId to ingestGranule', async (t) => {
  const cmrFileObject = { filename: 'test.cmr.xml', granuleId: 'testGranuleId', metadataObject: {} };
  const conceptId = randomString();
  const credentials = {};
  const cmrRevisionId = Math.floor(Math.random() * 100);

  const ingestGranuleSpy = sinon.stub(CMR.prototype, 'ingestGranule').returns({ result: { 'concept-id': conceptId } });

  t.teardown(() => {
    ingestGranuleSpy.restore();
  });

  await cmrUtil.publish2CMR(cmrFileObject, credentials, cmrRevisionId);
  t.is(ingestGranuleSpy.getCall(0).args[1], cmrRevisionId);
});

test.serial('publishUMMGJSON2CMR passes cmrRevisionId to ingestUMMGranule', async (t) => {
  const cmrFileObject = { filename: 'test.cmr.json', granuleId: 'testGranuleId', metadataObject: {} };
  const cmrRevisionId = Math.floor(Math.random() * 100);
  const credentials = {};
  const conceptId = randomString();

  const ingestUMMGranuleSpy = sinon.stub(CMR.prototype, 'ingestUMMGranule').returns({ 'concept-id': conceptId });

  t.teardown(() => {
    ingestUMMGranuleSpy.restore();
  });

  await cmrUtil.publish2CMR(cmrFileObject, credentials, cmrRevisionId);
  t.is(ingestUMMGranuleSpy.getCall(0).args[1], cmrRevisionId);
});

test(
  'buildCMRQuery transforms a list of objects with keys short_name and version into a proper object to post to CMR',
  (t) => {
    const results = [
      { short_name: 'sn1', version: '1' },
      { short_name: 'sn2', version: '2' },
      { short_name: 'sn3', version: '3' },
    ];
    const expected = { condition: { or: [
      { and: [{ short_name: 'sn1' }, { version: '1' }] },
      { and: [{ short_name: 'sn2' }, { version: '2' }] },
      { and: [{ short_name: 'sn3' }, { version: '3' }] },
    ] } };

    const actual = buildCMRQuery(results);
    t.deepEqual(actual, expected);
  }
);

test('buildCMRQuery works with if the input results list is empty', (t) => {
  const results = [];
  const expected = { condition: { or: [] } };
  const actual = buildCMRQuery(results);
  t.deepEqual(actual, expected);
});
