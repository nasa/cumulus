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
} = require('@cumulus/aws-client/S3');
const { CMR } = require('@cumulus/cmr-client');
const { s3, secretsManager } = require('@cumulus/aws-client/services');
const { randomId, readJsonFixture, randomString } = require('@cumulus/common/test-utils');
const errors = require('@cumulus/errors');
const launchpad = require('@cumulus/launchpad-auth');

const { getCmrSettings, constructCmrConceptLink } = require('../../cmr-utils');
const cmrUtil = rewire('../../cmr-utils');
const { isCMRFile, getGranuleTemporalInfo } = cmrUtil;
const { xmlParseOptions } = require('../../utils');
const uploadEcho10CMRFile = cmrUtil.__get__('uploadEcho10CMRFile');
const uploadUMMGJSONCMRFile = cmrUtil.__get__('uploadUMMGJSONCMRFile');
const stubDistributionBucketMap = {
  'fake-bucket': 'fake-bucket',
  'mapped-bucket': 'mapped/path/example',
  'cumulus-test-sandbox-protected': 'cumulus-test-sandbox-protected',
  'cumulus-test-sandbox-protected-2': 'cumulus-test-sandbox-protected-2',
  'cumulus-test-sandbox-public': 'cumulus-test-sandbox-public',
};
const { generateFileUrl } = proxyquire('../../cmr-utils', {
  '@cumulus/aws-client/S3': {
    buildS3Uri,
    getS3Object,
    getJsonS3Object: async () => stubDistributionBucketMap,
    parseS3Uri,
    promiseS3Upload,
    s3GetObjectTagging,
    s3TagSetToQueryString,
  },
});

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

test('isCMRFile returns truthy if fileobject has valid xml name', (t) => {
  const fileObj = {
    name: 'validfile.cmr.xml',
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid xml name', (t) => {
  const fileObj = {
    name: 'invalidfile.xml',
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns truthy if fileobject has valid json name', (t) => {
  const fileObj = {
    name: 'validfile.cmr.json',
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid json name', (t) => {
  const fileObj = {
    name: 'invalidfile.json',
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns truthy if fileobject has valid xml filenamename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr.xml',
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid xml filenamename', (t) => {
  const fileObj = {
    filename: 'invalidfile.xml',
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns truthy if fileobject has valid json filenamename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr.json',
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid json filenamename', (t) => {
  const fileObj = {
    filename: 'invalidfile.json',
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject is invalid', (t) => {
  const fileObj = { bad: 'object' };
  t.falsy(isCMRFile(fileObj));
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

test('mapACNMTypeToCMRType returns a mapping', (t) => {
  const mapCNMTypeToCMRType = cmrUtil.__get__('mapCNMTypeToCMRType');
  t.is('EXTENDED METADATA', mapCNMTypeToCMRType('qa'));
});

test('mapACNMTypeToCMRType returns a default mapping if non CNM mapping specified', (t) => {
  const mapCNMTypeToCMRType = cmrUtil.__get__('mapCNMTypeToCMRType');
  t.is('GET DATA', mapCNMTypeToCMRType('NOTAREALVALUE'));
});

test.serial('uploadEcho10CMRFile uploads CMR File to S3 correctly, preserving tags and setting ContentType', async (t) => {
  const cmrFile = {
    bucket: 'Echo10FileBucket',
    key: 'metadata.cmr.xml',
  };
  await s3().createBucket({ Bucket: cmrFile.bucket }).promise();
  try {
    const fakeXmlString = '<Granule>fake-granule</Granule>';
    await promiseS3Upload({
      Bucket: cmrFile.bucket,
      Key: cmrFile.key,
      Body: fakeXmlString,
      Tagging: 'tagA=iamtag1&tagB=iamtag2',
    });

    const newXmlString = '<Granule>new-granule</Granule>';
    await uploadEcho10CMRFile(newXmlString, cmrFile);

    const s3Obj = await getS3Object(cmrFile.bucket, cmrFile.key);
    t.is(s3Obj.Body.toString(), newXmlString);
    t.is(s3Obj.ContentType, 'application/xml');

    const tags = await s3GetObjectTagging(cmrFile.bucket, cmrFile.key);
    t.deepEqual(tags.TagSet, [{ Key: 'tagA', Value: 'iamtag1' }, { Key: 'tagB', Value: 'iamtag2' }]);
  } finally {
    recursivelyDeleteS3Bucket(cmrFile.bucket);
  }
});

test.serial('uploadUMMGJSONCMRFile uploads CMR File to S3 correctly, preserving tags and setting ContentType', async (t) => {
  const cmrFile = {
    bucket: 'UMMGJSONFileBucket',
    key: 'metadata.cmr.json',
  };
  await s3().createBucket({ Bucket: cmrFile.bucket }).promise();
  try {
    const fakeMetadataObject = { fake: 'data' };
    await promiseS3Upload({
      Bucket: cmrFile.bucket,
      Key: cmrFile.key,
      Body: JSON.stringify(fakeMetadataObject),
      Tagging: 'tagA=iamtag1&tagB=iamtag2',
    });

    const newFakeMetaObj = { newFake: 'granule' };
    await uploadUMMGJSONCMRFile(newFakeMetaObj, cmrFile);

    const s3Obj = await getS3Object(cmrFile.bucket, cmrFile.key);
    t.is(s3Obj.Body.toString(), JSON.stringify(newFakeMetaObj));
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
  ];
  const AssociatedBrowseExpected = [
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-public/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg`,
      Description: 'Download MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg',
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
    t.deepEqual(metadataObject.Granule.OnlineAccessURLs.OnlineAccessURL,
      onlineAccessURLsExpected);
    t.deepEqual(metadataObject.Granule.OnlineResources.OnlineResource,
      onlineResourcesExpected);
    t.deepEqual(
      metadataObject.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl,
      AssociatedBrowseExpected
    );
    t.truthy(uploadEchoSpy.calledWith('testXmlString',
      { filename: 's3://cumulus-test-sandbox-private/notUsed' }));
  } finally {
    revertMetaObject();
    revertMockUpload();
    revertGenerateXml();
  }
});

test.serial('updateUMMGMetadata adds Type correctly to RelatedURLs for granule files', async (t) => {
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
    t.deepEqual(metadataObject.RelatedUrls, expectedRelatedURLs);
  } finally {
    revertMetaObject();
    revertMockUpload();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR json file', async (t) => {
  const cmrJSON = await fs.readFile('./tests/fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json', 'utf8');
  const cmrMetadata = JSON.parse(cmrJSON);
  const revertCmrFileObject = cmrUtil.__set__('granuleToCmrFileObject', () => ([{ filename: 'test.cmr.json', granuleId: 'testGranuleId' }]));
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
      files: [],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertCmrFileObject();
    revertMetaObject();
  }
});

test.serial('getGranuleTemporalInfo returns temporal information from granule CMR xml file', async (t) => {
  const cmrXml = await fs.readFile('./tests/fixtures/cmrFileUpdateFixture.cmr.xml', 'utf8');
  const cmrMetadata = await (promisify(xml2js.parseString))(cmrXml, xmlParseOptions);
  const revertCmrFileObject = cmrUtil.__set__('granuleToCmrFileObject', () => ([{ filename: 'test.cmr.xml', granuleId: 'testGranuleId' }]));
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
      files: [],
    });

    t.deepEqual(temporalInfo, expectedTemporalInfo);
  } finally {
    revertCmrFileObject();
    revertMetaObject();
  }
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType distribution', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, 'www.example.com/fake-bucket/folder/key.txt');
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType s3', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 's3',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, filename);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType s3 with no filename', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 's3',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, filename);
});

test.serial('generateFileUrl returns undefined for cmrGranuleUrlType none', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt',
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 'none',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, undefined);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType distribution with bucket map defined', async (t) => {
  const filename = 's3://mapped-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'mapped-bucket',
    key: 'folder/key.txt',
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    teaEndpoint: 'fakeTeaEndpoint',
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: stubDistributionBucketMap,
  });

  t.is(url, 'www.example.com/mapped/path/example/folder/key.txt');
});

test.serial('generateFileUrl throws error for cmrGranuleUrlType distribution with no bucket map defined', async (t) => {
  const filename = 's3://other-fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'other-fake-bucket',
    key: 'folder/key.txt',
  };

  await t.throwsAsync(generateFileUrl({
    file,
    distEndpoint,
    teaEndpoint: 'fakeTeaEndpoint',
    cmrGranuleUrlType: 'distribution',
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
  });
});

test('getCmrSettings uses values in environment variables by default for launchpad auth', async (t) => {
  const credentials = await getCmrSettings({ oauthProvider: 'launchpad' });

  t.deepEqual(credentials, {
    provider: 'CUMULUS-TEST',
    clientId: 'Cumulus-Client-Id',
    token: `${launchpadPassphrase}-launchpad-api-launchpad-cert`,
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
        waitForObject: async (_, params) => {
          t.is(params.IfMatch, etag);
          throw Object.assign(new Error(), errorSelector);
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
  const credentials = await getCmrSettings();
  const cmrRevisionId = Math.random;

  t.teardown(() => {
    revertPublishECHO10XML2CMRSpy();
  });
  await cmrUtil.publish2CMR(updatedXmlFile, credentials, cmrRevisionId);
  t.is(publishECHO10XML2CMRSpy.getCall(0).args[2], cmrRevisionId);
});

test.serial('publish2CMR passes cmrRevisionId to publishUMMGJSON2CMR', async (t) => {
  const cmrFileObject = { filename: 'test.cmr.json', granuleId: 'testGranuleId', metadataObject: {} };
  const cmrRevisionId = Math.random;
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
  const cmrRevisionId = Math.random;

  const ingestGranuleSpy = sinon.stub(CMR.prototype, 'ingestGranule').returns({ result: { 'concept-id': conceptId, 'revision-id': cmrRevisionId } });

  t.teardown(() => {
    ingestGranuleSpy.restore();
  });

  await cmrUtil.publish2CMR(cmrFileObject, credentials, cmrRevisionId);
  t.is(ingestGranuleSpy.getCall(0).args[1], cmrRevisionId);
});

test.serial('publishUMMGJSON2CMR passes cmrRevisionId to ingestUMMGranule', async (t) => {
  const cmrFileObject = { filename: 'test.cmr.json', granuleId: 'testGranuleId', metadataObject: {} };
  const cmrRevisionId = Math.random;
  const credentials = {};
  const conceptId = randomString();

  const ingestUMMGranuleSpy = sinon.stub(CMR.prototype, 'ingestUMMGranule').returns({ 'concept-id': conceptId, 'revision-id': cmrRevisionId });

  t.teardown(() => {
    ingestUMMGranuleSpy.restore();
  });

  await cmrUtil.publish2CMR(cmrFileObject, credentials, cmrRevisionId);
  t.is(ingestUMMGranuleSpy.getCall(0).args[1], cmrRevisionId);
});
