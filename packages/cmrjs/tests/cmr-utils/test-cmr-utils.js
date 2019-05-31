const test = require('ava');
const rewire = require('rewire');
const fs = require('fs-extra');
const xml2js = require('xml2js');
const sinon = require('sinon');
const { promisify } = require('util');
const { readJsonFixture } = require('@cumulus/common/test-utils');
const {
  recursivelyDeleteS3Bucket, s3, promiseS3Upload, getS3Object, s3GetObjectTagging
} = require('@cumulus/common/aws');
const { BucketsConfig } = require('@cumulus/common');
const { xmlParseOptions } = require('../../utils');

const cmrUtil = rewire('../../cmr-utils');
const { isCMRFile, getGranuleTemporalInfo } = cmrUtil;
const uploadEcho10CMRFile = cmrUtil.__get__('uploadEcho10CMRFile');
const uploadUMMGJSONCMRFile = cmrUtil.__get__('uploadUMMGJSONCMRFile');


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
      buckets
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
      buckets
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
