'use strict';

const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const CRP = rewire('../../lambdas/create-reconciliation-report');
const isOneWayReport = CRP.__get__('isOneWayReport');
const shouldAggregateGranules = CRP.__get__('shouldAggregateGranules');
const normalizeEvent = CRP.__get__('normalizeEvent');

test(
  'isOneWayReport returns true only when one or more specific parameters '
    + ' are present on the reconciliation report object.',
  (t) => {
    const paramsThatShouldReturnTrue = ['startTimestamp', 'endTimestamp'];

    const paramsThatShouldReturnFalse = [
      'stackName',
      'systemBucket',
      'anythingAtAll',
      'collectionId',
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
    t.true(isOneWayReport({ ...allTrueKeys, ...allFalseKeys }));
  }
);

test(
  'shouldAggregateGranules returns true only when one or more specific parameters '
    + ' are present on the reconciliation report object.',
  (t) => {
    const paramsThatShouldReturnTrue = ['updatedAt__to', 'updatedAt__from'];
    const paramsThatShouldReturnFalse = [
      'stackName',
      'systemBucket',
      'startTimestamp',
      'anythingAtAll',
    ];

    paramsThatShouldReturnTrue.map((p) =>
      t.true(shouldAggregateGranules({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(shouldAggregateGranules({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(shouldAggregateGranules(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(shouldAggregateGranules(allFalseKeys));
    t.true(shouldAggregateGranules({ ...allTrueKeys, ...allFalseKeys }));
  }
);

test('normalizeEvent throws error if array of collectionIds passed to Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    collectionId: ['someCollection___version'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    message:
      'collectionId: ["someCollection___version"] is not valid input for an \'Internal\' report.',
  });
});

test('normalizeEvent converts input key collectionId string to length 1 array on collectionIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'NotInternal',
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
    reportType: 'NotInternal',
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

test('normalizeEvent adds new collectionIds key when collectionId passed to Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    collectionId: 'someCollection___version',
  };
  const expect = {
    ...inputEvent,
    collectionIds: ['someCollection___version'],
  };

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent throws error if original input event contains collectionIds key', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    collectionIds: ['someCollection___version'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    message:
      '`collectionIds` is not a valid input key for a reconciliation report, use `collectionId` instead.',
  });
});

test('normalizeEvent moves string on granuleId to array on granuleIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Not Internal',
    granuleId: 'someGranule___version',
  };
  const expect = {
    ...inputEvent,
    granuleIds: ['someGranule___version'],
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
    reportType: 'Not Internal',
    granuleId: ['someGranule___version', 'someGranule___version2'],
  };

  const expect = {
    ...inputEvent,
    granuleIds: ['someGranule___version', 'someGranule___version2'],
  };
  delete expect.granuleId;

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expect);
});

test('normalizeEvent throws error if array of granuleIds is passed to Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    granuleId: ['someCollectionId1'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    message:
      'granuleId: ["someCollectionId1"] is not valid input for an \'Internal\' report.',
  });
});
