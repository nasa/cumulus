const test = require('ava');
const rewire = require('rewire');

const {
  getGranuleId
} = require('../../cmr-utils');

const cmrUtil = rewire('../../cmr-utils');
const isCMRFile = cmrUtil.__get__('isCMRFile');
const stripKeyFromObject = cmrUtil.__get__('stripKeyFromObject');


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

test('stripKeyFromObject removes a Type key from object', (t) => {
  const testObj = {
    leaveme: 'a value',
    Type: 'should be stripped'
  };
  const expected = { leaveme: 'a value' };

  const actual = stripKeyFromObject('Type')(testObj);

  t.deepEqual(expected, actual);
});

test('stripKeyFromObject returns same object if Type key does not exist', (t) => {
  const testObj = {
    leaveme: 'a value',
    existing: 'should not be stripped',
  };
  const expected = { ...testObj };

  const actual = stripKeyFromObject('Type')(testObj);

  t.deepEqual(expected, actual);
});
