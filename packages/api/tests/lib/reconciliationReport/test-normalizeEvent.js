const test = require('ava');
const omit = require('lodash/omit');
const { InvalidArgument } = require('@cumulus/errors');
const { normalizeEvent } = require('../../../lib/reconciliationReport/normalizeEvent');

test('normalizeEvent converts input key collectionId string to length 1 array on collectionIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'anytype',
    collectionId: 'someCollection___version',
  };
  const expect = { ...inputEvent, collectionIds: ['someCollection___version'] };
  delete expect.collectionId;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent moves input key collectionId array to array on collectionIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'anytype',
    collectionId: ['someCollection___version', 'secondcollection___version'],
  };
  const expect = {
    ...inputEvent,
    collectionIds: ['someCollection___version', 'secondcollection___version'],
  };
  delete expect.collectionId;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent throws error if original input event contains collectionIds key', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'anytype',
    collectionIds: ['someCollection___version'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    message: '`collectionIds` is not a valid input key for a reconciliation report, use `collectionId` instead.',
  });
});

test('normalizeEvent moves string on granuleId to array on granuleIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'anytype',
    granuleId: 'someGranule',
  };
  const expect = {
    ...inputEvent,
    granuleIds: ['someGranule'],
  };
  delete expect.granuleId;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent moves array on granuleId to granuleIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'anytype',
    granuleId: ['someGranule', 'someGranule2'],
  };

  const expect = {
    ...inputEvent,
    granuleIds: ['someGranule', 'someGranule2'],
  };
  delete expect.granuleId;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});
test('normalizeEvent throws error if granuleIds and collectionIds are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'notInternal',
    granuleId: ['someGranuleId'],
    collectionId: ['someCollectionId1'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message: 'notInternal reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
  });
});

test('normalizeEvent correctly handles granuleIds, collectionIds, and providers if reportType is Internal', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    granuleId: 'someGranuleId',
    collectionId: 'someCollectionId1',
    provider: 'someProvider1',
  };

  const expected = {
    ...omit(inputEvent, ['collectionId', 'granuleId']),
    granuleIds: ['someGranuleId'],
    collectionIds: ['someCollectionId1'],
    providers: ['someProvider1'],
  };

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expected);
});

test('normalizeEvent moves string on provider to array on providers', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Not Internal',
    provider: 'someProvider',
  };
  const expect = {
    ...inputEvent,
    providers: ['someProvider'],
  };
  delete expect.provider;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent moves array on provider to providers', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Not Internal',
    provider: ['provider1', 'provider2'],
  };

  const expect = {
    ...inputEvent,
    providers: ['provider1', 'provider2'],
  };
  delete expect.provider;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent throws error if providers and collectionIds are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'anytype',
    provider: ['someProvider'],
    collectionId: ['someCollectionId1'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message:
      'notInternal reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
  });
});

test('normalizeEvent throws error if providers and granuleIds are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'notInternal',
    provider: ['someProvider'],
    granuleId: ['someGranuleId'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message:
      'notInternal reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
  });
});
