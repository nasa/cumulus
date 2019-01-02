const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const cmrUtils = rewire('../cmr-utils');

const { randomId } = require('@cumulus/common/test-utils');

const {
  getGranuleId,
  isCMRFile
} = require('../cmr-utils');

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


test('reconcileCMRMetadata does not updateCMRMetadata if no metadatafile present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr' }];
  const granId = randomId('granuleID');
  const distEndpoint = 'https://example.com/endpoint';
  const pub = true;
  const fakeCall = sinon.fake.resolves(true);

  const restore = cmrUtils.__set__('updateCMRMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);
  t.falsy(results);
  t.false(fakeCall.called);

  sinon.restore();
  restore();
});

test('reconcileCMRMetadata calls updateCMRMetadata if metadatafile present', async (t) => {
  const updatedFiles = [{ filename: 'anotherfile' }, { filename: 'cmrmeta.cmr.xml' }];
  const granId = randomId('granuleID');
  const distEndpoint = 'https://example.com/endpoint';
  const pub = true;
  const fakeCall = sinon.fake.resolves(true);

  const restore = cmrUtils.__set__('updateCMRMetadata', fakeCall);

  const results = await cmrUtils.reconcileCMRMetadata(granId, updatedFiles, distEndpoint, pub);
  t.true(results);
  t.true(fakeCall.calledOnce);
  t.true(fakeCall.calledOnceWith(granId, updatedFiles[1], updatedFiles, distEndpoint, pub));

  sinon.restore();
  restore();
});
