const test = require('ava');
const rewire = require('rewire');
const range = require('lodash/range');

const { constructCollectionId } = require('@cumulus/message/Collections');

const sortBy = require('lodash/sortBy');
const {
  convertToDBCollectionSearchObject,
  convertToOrcaGranuleSearchParams,
  filterDBCollections,
} = require('../../lib/reconciliationReport');
const { fakeCollectionFactory } = require('../../lib/testUtils');

const CRP = rewire('../../lib/reconciliationReport');
const dateToValue = CRP.__get__('dateToValue');

test('dateToValue converts a string representation to a primitive date.', (t) => {
  const primitiveValue = 1500000000000;
  const testStrings = [
    'Thu Jul 13 2017 20:40:00 GMT-0600',
    'Fri Jul 14 2017 02:40:00 GMT+0000',
    '2017-07-14T02:40:00.000Z',
    'Fri, 14 Jul 2017 02:40:00 GMT',
  ];
  testStrings.map((testVal) => t.is(dateToValue(testVal), primitiveValue));
});

test('dateToValue returns undefined for any string that cannot be converted to a date.', (t) => {
  const testStrings = ['startTime', '20170713 20:40:00', '20170713T204000'];
  testStrings.map((testVal) => t.is(dateToValue(testVal), undefined));
});

test('convertToOrcaGranuleSearchParams returns correct search object.', (t) => {
  const startTimestamp = '2010-01-01T00:00:00.000Z';
  const endTimestamp = '2011-10-01T12:00:00.000Z';
  const testObj = {
    startTimestamp,
    endTimestamp,
    anotherKey: 'anything',
    anotherKey2: 'they are ignored',
    collectionIds: 'testcollectionId',
    granuleIds: ['testgranuleId'],
    providers: ['provider1', 'provider2'],
  };

  const expected = {
    startTimestamp: 1262304000000,
    endTimestamp: 1317470400000,
    collectionId: testObj.collectionIds,
    granuleId: testObj.granuleIds,
    providerId: testObj.providers,
  };

  const actual = convertToOrcaGranuleSearchParams(testObj);
  t.deepEqual(actual, expected);
});

test('convertToDBCollectionSearchParams returns correct search object with collectionIds.', (t) => {
  const startTimestamp = '2000-10-31T15:00:00.000Z';
  const endTimestamp = '2001-10-31T15:00:00.000Z';
  const collectionIds = ['name___version'];
  const testObj = {
    startTimestamp,
    endTimestamp,
    collectionIds,
    anotherKey: 'anything',
    anotherKey2: 'they are ignored',
  };

  const expected = [{
    updatedAtFrom: new Date(startTimestamp),
    updatedAtTo: new Date(endTimestamp),
  }, {
    name: 'name',
    version: 'version',
  }];

  const actual = convertToDBCollectionSearchObject(testObj);
  t.deepEqual(actual, expected);
});

test('convertToDBCollectionSearchParams ignores collectionIds when there are multiple collectionIds.', (t) => {
  const startTimestamp = '2000-10-31T15:00:00.000Z';
  const endTimestamp = '2001-10-31T15:00:00.000Z';
  const collectionIds = ['name___version', 'name2___version'];
  const testObj = {
    startTimestamp,
    endTimestamp,
    collectionIds,
    anotherKey: 'anything',
    anotherKey2: 'they are ignored',
  };

  const expected = [{
    updatedAtFrom: new Date(startTimestamp),
    updatedAtTo: new Date(endTimestamp),
  }, {}];

  const actual = convertToDBCollectionSearchObject(testObj);
  t.deepEqual(actual, expected);
});

test('filterDBCollections returns all collections if no collectionIds on recReportParams', (t) => {
  let collections = range(25).map(() => fakeCollectionFactory());
  collections = sortBy(collections, 'name', 'version');
  const reportParams = {
    startTimestamp: 'any',
    endTimestamp: 'also any',
    otherUnusedParams: 'could be anything',
  };

  const actual = filterDBCollections(collections, reportParams);

  t.deepEqual(actual, collections);
});

test("filterDBCollections filters collections by recReportParams's collectionIds", (t) => {
  let collections = range(25).map(() => fakeCollectionFactory());
  collections = sortBy(collections, 'name', 'version');
  const nonDbCollection = fakeCollectionFactory();

  const targetCollections = [
    collections[7],
    collections[9],
    nonDbCollection,
    collections[3],
    collections[5],
  ];

  const collectionIds = targetCollections.map((c) => constructCollectionId(c.name, c.version));

  const expected = sortBy(targetCollections, 'name', 'version')
    .filter((c) => !(c.name === nonDbCollection.name && c.version === nonDbCollection.version));

  const reportParams = {
    startTimestamp: 'any',
    endTimestamp: 'also any',
    otherUnusedParams: 'could be anything',
    collectionIds,
  };

  const actual = filterDBCollections(collections, reportParams);

  t.deepEqual(actual, expected);
});
