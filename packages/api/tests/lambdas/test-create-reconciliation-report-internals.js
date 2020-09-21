'use strict';

const test = require('ava');
const rewire = require('rewire');

const { InvalidArgument } = require('@cumulus/errors');
const { randomId } = require('@cumulus/common/test-utils');

const CRP = rewire('../../lambdas/create-reconciliation-report');
const isOneWayCollectionReport = CRP.__get__('isOneWayCollectionReport');
const isOneWayGranuleReport = CRP.__get__('isOneWayGranuleReport');
const shouldAggregateGranulesForCollections = CRP.__get__('shouldAggregateGranulesForCollections');
const normalizeEvent = CRP.__get__('normalizeEvent');

test(
  'isOneWayCollectionReport returns true only when one or more specific parameters '
    + ' are present on the reconciliation report object.',
  (t) => {
    const paramsThatShouldReturnTrue = [
      'startTimestamp',
      'endTimestamp',
      'granuleIds',
      'providers',
    ];

    const paramsThatShouldReturnFalse = [
      'stackName',
      'systemBucket',
      'anythingAtAll',
      'collectionId',
    ];

    paramsThatShouldReturnTrue.map((p) =>
      t.true(isOneWayCollectionReport({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(isOneWayCollectionReport({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(isOneWayCollectionReport(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(isOneWayCollectionReport(allFalseKeys));
    t.true(isOneWayCollectionReport({ ...allTrueKeys, ...allFalseKeys }));
  }
);

test(
  'isOneWayGranuleReport returns true only when one or more specific parameters '
    + ' are present on the reconciliation report object.',
  (t) => {
    const paramsThatShouldReturnTrue = ['startTimestamp', 'endTimestamp', 'providers'];

    const paramsThatShouldReturnFalse = [
      'stackName',
      'systemBucket',
      'anythingAtAll',
      'collectionId',
      'collectionIds',
      'granuleIds',
    ];

    paramsThatShouldReturnTrue.map((p) =>
      t.true(isOneWayGranuleReport({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(isOneWayGranuleReport({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(isOneWayGranuleReport(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(isOneWayGranuleReport(allFalseKeys));
    t.true(isOneWayGranuleReport({ ...allTrueKeys, ...allFalseKeys }));
  }
);

test(
  'shouldAggregateGranulesForCollections returns true only when one or more specific parameters '
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
      t.true(shouldAggregateGranulesForCollections({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(shouldAggregateGranulesForCollections({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(shouldAggregateGranulesForCollections(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(shouldAggregateGranulesForCollections(allFalseKeys));
    t.true(shouldAggregateGranulesForCollections({ ...allTrueKeys, ...allFalseKeys }));
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
    reportType: 'Not Internal',
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

test('normalizeEvent throws error if array of granuleIds is passed to Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    granuleId: ['someGranuleId'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    message:
      'granuleId: ["someGranuleId"] is not valid input for an \'Internal\' report.',
  });
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
    message:
      'notInternal reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
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
    ...inputEvent,
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

test('normalizeEvent throws error if array of providers is passed to Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    provider: ['someProvider'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    message:
      'provider: ["someProvider"] is not a valid input for an \'Internal\' report.',
  });
});

test('normalizeEvent throws error if providers and collectionIds are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'notInternal',
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
