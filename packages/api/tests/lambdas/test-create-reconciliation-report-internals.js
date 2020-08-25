'use strict';

const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const CRP = rewire('../../lambdas/create-reconciliation-report');
const isOneWayReport = CRP.__get__('isOneWayReport');
const dateStringToValue = CRP.__get__('dateStringToValue');
const convertToESCollectionSearchParams = CRP.__get__(
  'convertToESCollectionSearchParams'
);
const convertToESGranuleSearchParams = CRP.__get__(
  'convertToESGranuleSearchParams'
);

test(
  'isOneWayReport returns true only when one or more specific parameters '
    + ' are present on the reconciliation report object.',
  (t) => {
    const paramsThatShouldReturnTrue = ['startTimestamp', 'endTimestamp'];
    const paramsThatShouldReturnFalse = [
      'stackName',
      'systemBucket',
      'anythingAtAll',
    ];

    paramsThatShouldReturnTrue.map((p) =>
      t.true(isOneWayReport({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(isOneWayReport({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(isOneWayReport(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(isOneWayReport(allFalseKeys));
  }
);

test('dateStringToValue converts a string representation to a primitive date.', (t) => {
  const primitiveValue = 1500000000000;
  const testStrings = [
    'Thu Jul 13 2017 20:40:00 GMT-0600',
    'Fri Jul 14 2017 02:40:00 GMT+0000',
    '2017-07-14T02:40:00.000Z',
    'Fri, 14 Jul 2017 02:40:00 GMT',
  ];
  testStrings.map((testVal) =>
    t.is(dateStringToValue(testVal), primitiveValue));
});

test('dateStringToValue returns undefined for any string that cannot be converted to a date.', (t) => {
  const testStrings = ['startTime', '20170713 20:40:00', '20170713T204000'];
  testStrings.map((testVal) => t.is(dateStringToValue(testVal), undefined));
});

test('convertToESCollectionSearchParams returns correct search object.', (t) => {
  const startTimestamp = '2000-10-31T15:00:00.000Z';
  const endTimestamp = '2001-10-31T15:00:00.000Z';
  const testObj = {
    startTimestamp,
    endTimestamp,
    anotherKey: 'anything',
    anotherKey2: 'they are ignored',
  };

  const expected = {
    updatedAt__from: 973004400000,
    updatedAt__to: 1004540400000,
  };

  const actual = convertToESCollectionSearchParams(testObj);
  t.deepEqual(actual, expected);
});

test('convertToESGranuleSearchParams returns correct search object.', (t) => {
  const startTimestamp = '2010-01-01T00:00:00.000Z';
  const endTimestamp = '2011-10-01T12:00:00.000Z';
  const testObj = {
    startTimestamp,
    endTimestamp,
    anotherKey: 'anything',
    anotherKey2: 'they are ignored',
  };

  const expected = {
    updatedAt__from: 1262304000000,
    updatedAt__to: 1317470400000,
  };

  const actual = convertToESGranuleSearchParams(testObj);
  t.deepEqual(actual, expected);
});
