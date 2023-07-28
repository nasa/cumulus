const test = require('ava');
const omit = require('lodash/omit');
const { InvalidArgument } = require('@cumulus/errors');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { randomId } = require('@cumulus/common/test-utils');
const { normalizeEvent } = require('../../../lib/reconciliationReport/normalizeEvent');
const { reconciliationReport } = require('../../../models/schemas');

test('normalizeEvent converts input key collectionId string to length 1 array on collectionIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Inventory',
    collectionId: constructCollectionId('someCollection', 'version'),
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
    reportType: 'Inventory',
    collectionId: [
      constructCollectionId('someCollection', 'version'),
      constructCollectionId('secondcollection', 'version'),
    ],
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
    reportType: 'Inventory',
    collectionIds: [constructCollectionId('someCollection', 'version')],
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
    reportType: 'Inventory',
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
    reportType: 'Inventory',
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
test('normalizeEvent throws error if granuleId and collectionId are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Inventory',
    granuleId: ['someGranuleId'],
    collectionId: ['someCollectionId1'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message: 'Inventory reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
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
    ...omit(inputEvent, ['collectionId', 'granuleId', 'provider']),
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
    reportType: 'Inventory',
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
    reportType: 'Inventory',
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

test('normalizeEvent throws error if provider and collectionId are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Granule Not Found',
    provider: ['someProvider'],
    collectionId: ['someCollectionId1'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message:
      'Granule Not Found reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
  });
});

test('normalizeEvent throws error if provider and granuleId are passed to non-Internal report', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    provider: ['someProvider'],
    granuleId: ['someGranuleId'],
  };
  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message:
      'Inventory reports cannot be launched with more than one input (granuleId, collectionId, or provider).',
  });
});

test('Invalid report type throws InvalidArgument error', (t) => {
  const reportType = randomId('badType');
  const inputEvent = { reportType };

  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message: new RegExp(`${reportType} is not a valid report type\. Please use one of .*`),
  });
});

test('valid Reports types from reconciliation schema do not throw an error.', (t) => {
  const validReportTypes = reconciliationReport.properties.type.enum;
  validReportTypes.forEach((reportType) => {
    t.notThrows(() => normalizeEvent({ reportType }));
  });
});
