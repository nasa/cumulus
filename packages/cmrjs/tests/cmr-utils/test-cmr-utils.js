const test = require('ava');
const rewire = require('rewire');
const proxyquire = require('proxyquire').noPreserveCache();
const fs = require('fs-extra');
const xml2js = require('xml2js');
const sinon = require('sinon');
const { promisify } = require('util');
const {
  buildS3Uri,
  getS3Object,
  recursivelyDeleteS3Bucket,
  promiseS3Upload,
  s3GetObjectTagging,
  parseS3Uri,
  s3TagSetToQueryString
} = require('@cumulus/aws-client/S3');
const { s3, secretsManager } = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { randomId, readJsonFixture } = require('@cumulus/common/test-utils');
const errors = require('@cumulus/errors');
const launchpad = require('@cumulus/launchpad-auth');
const { xmlParseOptions } = require('../../utils');

const { getCmrSettings } = require('../../cmr-utils');
const cmrUtil = rewire('../../cmr-utils');
const { isCMRFile, getGranuleTemporalInfo } = cmrUtil;
const uploadEcho10CMRFile = cmrUtil.__get__('uploadEcho10CMRFile');
const uploadUMMGJSONCMRFile = cmrUtil.__get__('uploadUMMGJSONCMRFile');
const mockDistributionBucketMap = {
  'fake-bucket': 'fake-bucket',
  'mapped-bucket': 'mapped/path/example',
  'cumulus-test-sandbox-protected': 'cumulus-test-sandbox-protected',
  'cumulus-test-sandbox-protected-2': 'cumulus-test-sandbox-protected-2',
  'cumulus-test-sandbox-public': 'cumulus-test-sandbox-public'
};
const { generateFileUrl } = proxyquire('../../cmr-utils', {
  '@cumulus/aws-client/S3': {
    buildS3Uri,
    getS3Object,
    getJsonS3Object: async () => mockDistributionBucketMap,
    parseS3Uri,
    promiseS3Upload,
    s3GetObjectTagging,
    s3TagSetToQueryString
  }
});

const launchpadSecret = randomId('launchpad-secret');
const launchpadPassphrase = randomId('launchpad-passphrase');
const cmrPasswordSecret = randomId('cmr-password-secret');
const cmrPassword = randomId('cmr-password');

test.before(async (t) => {
  process.env.cmr_provider = 'CUMULUS-TEST';
  process.env.cmr_client_id = 'Cumulus-Client-Id';
  process.env.cmr_oauth_provider = 'earthdata';

  process.env.launchpad_passphrase_secret_name = launchpadSecret;
  process.env.launchpad_api = 'launchpad-api';
  process.env.launchpad_certificate = 'launchpad-cert';

  await secretsManager().createSecret({
    Name: launchpadSecret,
    SecretString: launchpadPassphrase
  }).promise();

  process.env.cmr_password_secret_name = cmrPasswordSecret;
  process.env.cmr_username = 'cmr-user';

  await secretsManager().createSecret({
    Name: cmrPasswordSecret,
    SecretString: cmrPassword
  }).promise();

  t.context.launchpadStub = sinon.stub(launchpad, 'getLaunchpadToken')
    .callsFake((config) => Promise.resolve(`${config.passphrase}-${config.api}-${config.certificate}`));
});

test.after.always(async (t) => {
  await Promise.all([
    await secretsManager().deleteSecret({
      SecretId: launchpadSecret,
      ForceDeleteWithoutRecovery: true
    }).promise(),
    await secretsManager().deleteSecret({
      SecretId: cmrPasswordSecret,
      ForceDeleteWithoutRecovery: true
    }).promise()
  ]);

  t.context.launchpadStub.restore();
});

test('isCMRFile returns truthy if fileobject has valid xml name', (t) => {
  const fileObj = {
    name: 'validfile.cmr.xml'
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid xml name', (t) => {
  const fileObj = {
    name: 'invalidfile.xml'
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns truthy if fileobject has valid json name', (t) => {
  const fileObj = {
    name: 'validfile.cmr.json'
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid json name', (t) => {
  const fileObj = {
    name: 'invalidfile.json'
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns truthy if fileobject has valid xml filenamename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr.xml'
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid xml filenamename', (t) => {
  const fileObj = {
    filename: 'invalidfile.xml'
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns truthy if fileobject has valid json filenamename', (t) => {
  const fileObj = {
    filename: 'validfile.cmr.json'
  };
  t.truthy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject does not valid json filenamename', (t) => {
  const fileObj = {
    filename: 'invalidfile.json'
  };
  t.falsy(isCMRFile(fileObj));
});

test('isCMRFile returns falsy if fileobject is invalid', (t) => {
  const fileObj = { bad: 'object' };
  t.falsy(isCMRFile(fileObj));
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
    key: 'metadata.cmr.xml'
  };
  await s3().createBucket({ Bucket: cmrFile.bucket }).promise();
  try {
    const fakeXmlString = '<Granule>fake-granule</Granule>';
    await promiseS3Upload({
      Bucket: cmrFile.bucket,
      Key: cmrFile.key,
      Body: fakeXmlString,
      Tagging: 'tagA=iamtag1&tagB=iamtag2'
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
    key: 'metadata.cmr.json'
  };
  await s3().createBucket({ Bucket: cmrFile.bucket }).promise();
  try {
    const fakeMetadataObject = { fake: 'data' };
    await promiseS3Upload({
      Bucket: cmrFile.bucket,
      Key: cmrFile.key,
      Body: JSON.stringify(fakeMetadataObject),
      Tagging: 'tagA=iamtag1&tagB=iamtag2'
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
  const uploadEchoSpy = sinon.spy(() => Promise.resolve);
  const cmrXml = await fs.readFile('./tests/fixtures/cmrFileUpdateFixture.cmr.xml', 'utf8');
  const cmrMetadata = await (promisify(xml2js.parseString))(cmrXml, xmlParseOptions);
  const filesObject = await readJsonFixture('./tests/fixtures/filesObjectFixture.json');
  const buckets = new BucketsConfig(await readJsonFixture('./tests/fixtures/buckets.json'));

  const distributionBucketMap = {};
  Object.values(buckets.buckets)
    .forEach(({ name }) => Object.assign(distributionBucketMap, ({ [name]: name })));

  const distEndpoint = 'https://distendpoint.com';

  const updateEcho10XMLMetadata = cmrUtil.__get__('updateEcho10XMLMetadata');

  const revertGenerateXml = cmrUtil.__set__('generateEcho10XMLString', () => 'testXmlString');
  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRXMLFile', () => cmrMetadata);
  const revertMockUpload = cmrUtil.__set__('uploadEcho10CMRFile', uploadEchoSpy);

  const onlineAccessURLsExpected = [
    {
      URL: 'https://textFixtureUrl.gov/someCmrFile',
      URLDescription: 'File to download'
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected/MOD09GQ___006/2016/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248.hdf`,
      URLDescription: 'File to download'
    }
  ];
  const onlineResourcesExpected = [
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected-2/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248.cmr.json`,
      Type: 'EXTENDED METADATA',
      Description: 'File to download'
    },
    {
      URL: `${distEndpoint}/s3credentials`,
      Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
      Type: 'VIEW RELATED INFORMATION'
    }
  ];
  const AssociatedBrowseExpected = [
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-public/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg`,
      Description: 'File to download'
    }
  ];
  let actual;
  try {
    actual = await updateEcho10XMLMetadata({
      cmrFile: { filename: 's3://cumulus-test-sandbox-private/notUsed' },
      files: filesObject,
      distEndpoint,
      buckets,
      distributionBucketMap
    });
  } finally {
    revertMetaObject();
    revertMockUpload();
    revertGenerateXml();
  }
  t.deepEqual(actual.Granule.OnlineAccessURLs.OnlineAccessURL, onlineAccessURLsExpected);
  t.deepEqual(actual.Granule.OnlineResources.OnlineResource, onlineResourcesExpected);
  t.deepEqual(actual.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl, AssociatedBrowseExpected);
  t.truthy(uploadEchoSpy.calledWith('testXmlString', { filename: 's3://cumulus-test-sandbox-private/notUsed' }));
});

test.serial('updateUMMGMetadata adds Type correctly to RelatedURLs for granule files', async (t) => {
  const uploadEchoSpy = sinon.spy(() => Promise.resolve);

  const cmrJSON = await fs.readFile('./tests/fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json', 'utf8');
  const cmrMetadata = JSON.parse(cmrJSON);
  const filesObject = await readJsonFixture('./tests/fixtures/UMMGFilesObjectFixture.json');
  const buckets = new BucketsConfig(await readJsonFixture('./tests/fixtures/buckets.json'));
  const bucketMappings = Object.keys(buckets.buckets).map(
    (key) => ({ [buckets.buckets[key].name]: buckets.buckets[key].name })
  );
  const distributionBucketMap = Object.assign({}, ...bucketMappings);

  const distEndpoint = 'https://distendpoint.com';

  const updateUMMGMetadata = cmrUtil.__get__('updateUMMGMetadata');

  const revertMetaObject = cmrUtil.__set__('metadataObjectFromCMRJSONFile', () => cmrMetadata);
  const revertMockUpload = cmrUtil.__set__('uploadUMMGJSONCMRFile', uploadEchoSpy);

  const expectedRelatedURLs = [
    {
      URL: 'https://nasa.github.io/cumulus/docs/cumulus-docs-readme',
      Type: 'GET DATA'
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.hdf`,
      Description: 'File to download',
      Type: 'GET DATA'
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314_ndvi.jpg`,
      Description: 'File to download',
      Type: 'GET RELATED VISUALIZATION'
    },
    {
      URL: `${distEndpoint}/cumulus-test-sandbox-protected-2/MOD09GQ___006/MOD/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json`,
      Description: 'File to download',
      Type: 'EXTENDED METADATA'
    },
    {
      URL: `${distEndpoint}/s3credentials`,
      Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
      Type: 'VIEW RELATED INFORMATION'
    }
  ];
  let actualOutput;
  try {
    actualOutput = await updateUMMGMetadata({
      cmrFile: { filename: 's3://cumulus-test-sandbox-private/notUsed' },
      files: filesObject,
      distEndpoint,
      buckets,
      distributionBucketMap
    });
  } finally {
    revertMetaObject();
    revertMockUpload();
  }
  t.deepEqual(actualOutput.RelatedUrls, expectedRelatedURLs);
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
    lastUpdateDateTime: '2018-12-19T17:30:31.424Z'
  };

  let temporalInfo;
  try {
    temporalInfo = await getGranuleTemporalInfo({ granuleId: 'testGranuleId', files: [] });
  } finally {
    revertCmrFileObject();
    revertMetaObject();
  }
  t.deepEqual(temporalInfo, expectedTemporalInfo);
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
    lastUpdateDateTime: '2018-04-25T21:45:45.524053'
  };

  let temporalInfo;
  try {
    temporalInfo = await getGranuleTemporalInfo({ granuleId: 'testGranuleId', files: [] });
  } finally {
    revertCmrFileObject();
    revertMetaObject();
  }
  t.deepEqual(temporalInfo, expectedTemporalInfo);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType distribution', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt'
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: mockDistributionBucketMap
  });

  t.is(url, 'www.example.com/fake-bucket/folder/key.txt');
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType s3', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt'
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 's3',
    distributionBucketMap: mockDistributionBucketMap
  });

  t.is(url, filename);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType s3 with no filename', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    bucket: 'fake-bucket',
    key: 'folder/key.txt'
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 's3',
    distributionBucketMap: mockDistributionBucketMap
  });

  t.is(url, filename);
});

test.serial('generateFileUrl returns null for cmrGranuleUrlType none', async (t) => {
  const filename = 's3://fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'fake-bucket',
    key: 'folder/key.txt'
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    cmrGranuleUrlType: 'none',
    distributionBucketMap: mockDistributionBucketMap
  });

  t.is(url, null);
});

test.serial('generateFileUrl generates correct url for cmrGranuleUrlType distribution with bucket map defined', async (t) => {
  const filename = 's3://mapped-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'mapped-bucket',
    key: 'folder/key.txt'
  };

  const url = await generateFileUrl({
    file,
    distEndpoint,
    teaEndpoint: 'fakeTeaEndpoint',
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: mockDistributionBucketMap
  });

  t.is(url, 'www.example.com/mapped/path/example/folder/key.txt');
});


test.serial('generateFileUrl throws error for cmrGranuleUrlType distribution with no bucket map defined', async (t) => {
  const filename = 's3://other-fake-bucket/folder/key.txt';
  const distEndpoint = 'www.example.com/';

  const file = {
    filename,
    bucket: 'other-fake-bucket',
    key: 'folder/key.txt'
  };

  await t.throwsAsync(generateFileUrl({
    file,
    distEndpoint,
    teaEndpoint: 'fakeTeaEndpoint',
    cmrGranuleUrlType: 'distribution',
    distributionBucketMap: mockDistributionBucketMap
  }),
  { instanceOf: errors.MissingBucketMap });
});

test('getCmrSettings uses values in environment variables by default', async (t) => {
  const credentials = await getCmrSettings();

  t.deepEqual(credentials, {
    provider: 'CUMULUS-TEST',
    clientId: 'Cumulus-Client-Id',
    password: cmrPassword,
    username: 'cmr-user'
  });
});

test('getCmrSettings uses values in environment variables by default for launchpad auth', async (t) => {
  const credentials = await getCmrSettings({ oauthProvider: 'launchpad' });

  t.deepEqual(credentials, {
    provider: 'CUMULUS-TEST',
    clientId: 'Cumulus-Client-Id',
    token: `${launchpadPassphrase}-launchpad-api-launchpad-cert`
  });
});

test('getCmrSettings uses values in config for earthdata oauth', async (t) => {
  const testPasswordSecret = randomId('test-password-secret');
  const testPassword = randomId('test-password');

  await secretsManager().createSecret({
    Name: testPasswordSecret,
    SecretString: testPassword
  }).promise();

  try {
    const credentials = await getCmrSettings({
      provider: 'CUMULUS-PROV',
      clientId: 'test-client-id',
      username: 'cumulus',
      passwordSecretName: testPasswordSecret
    });

    t.deepEqual(credentials, {
      provider: 'CUMULUS-PROV',
      clientId: 'test-client-id',
      password: testPassword,
      username: 'cumulus'
    });
  } finally {
    await secretsManager().deleteSecret({
      SecretId: testPasswordSecret,
      ForceDeleteWithoutRecovery: true
    }).promise();
  }
});

test('getCmrSettings uses values in config for launchpad oauth', async (t) => {
  const testPassphraseSecret = randomId('test-passphrase-secret');
  const testPassphrase = randomId('test-password');

  await secretsManager().createSecret({
    Name: testPassphraseSecret,
    SecretString: testPassphrase
  }).promise();

  try {
    const credentials = await getCmrSettings({
      oauthProvider: 'launchpad',
      passphraseSecretName: testPassphraseSecret,
      api: 'test-api',
      certificate: 'test-certificate'
    });

    t.deepEqual(credentials, {
      provider: 'CUMULUS-TEST',
      clientId: 'Cumulus-Client-Id',
      token: `${testPassphrase}-test-api-test-certificate`
    });
  } finally {
    await secretsManager().deleteSecret({
      SecretId: testPassphraseSecret,
      ForceDeleteWithoutRecovery: true
    }).promise();
  }
});
