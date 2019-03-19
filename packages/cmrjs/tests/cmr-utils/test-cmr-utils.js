const test = require('ava');
const rewire = require('rewire');
const fs = require('fs-extra');
const xml2js = require('xml2js');
const sinon = require('sinon');
const { promisify } = require('util');
const { readJsonFixture } = require('@cumulus/common/test-utils');
const { BucketsConfig } = require('@cumulus/common');
const { xmlParseOptions } = require('../../utils');


const {
  getGranuleId
} = require('../../cmr-utils');

const cmrUtil = rewire('../../cmr-utils');
const isCMRFile = cmrUtil.__get__('isCMRFile');


test('getGranuleId is successful', (t) => {
  const uri = 'test.txt';
  const regex = '(.*).txt';
  t.is(getGranuleId(uri, regex), 'test');
});

test('getGranuleId fails', (t) => {
  const uri = 'test.txt';
  const regex = '(.*).TXT';
  const error = t.throws(() => getGranuleId(uri, regex), Error);
  t.is(error.message, `Could not determine granule id of ${uri} using ${regex}`);
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
      URL: 'https://cumulus-test-sandbox-public.s3.amazonaws.com/MOD09GQ___006/TESTFIXTUREDIR/MOD09GQ.A6391489.a3Odk1.006.3900731509248_ndvi.jpg',
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
  }
  finally {
    revertMetaObject();
    revertMockUpload();
    revertGenerateXml();
  }

  t.deepEqual(actual.Granule.OnlineAccessURLs.OnlineAccessURL, onlineAccessURLsExpected);
  t.deepEqual(actual.Granule.OnlineResources.OnlineResource, onlineResourcesExpected);
  t.deepEqual(actual.Granule.AssociatedBrowseImageUrls.ProviderBrowseUrl, AssociatedBrowseExpected);
  t.truthy(uploadEchoSpy.calledWith('testXmlString', { filename: 's3://cumulus-test-sandbox-private/notUsed' }));
});
