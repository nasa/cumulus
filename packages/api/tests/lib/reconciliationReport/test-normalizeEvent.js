const test = require('ava');
const { InvalidArgument } = require('@cumulus/errors');
const { randomId } = require('@cumulus/common/test-utils');
const { normalizeEvent } = require('../../../lib/reconciliationReport/normalizeEvent');
const { reconciliationReport } = require('../../../models/schemas');

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
    message: 'collectionId: ["someCollection___version"] is not valid input for an \'Internal\' report.',
  });
});
test('normalizeEvent converts input key collectionId string to length 1 array on collectionIds', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Inventory',
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
    reportType: 'Inventory',
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
    message: 'granuleId: ["someGranuleId"] is not valid input for an \'Internal\' report.',
  });
});
test('normalizeEvent throws error if granuleIds and collectionIds are passed to non-Internal report', (t) => {
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
    message: 'Inventory reports cannot be launched with both granuleId and collectionId input.',
  });
});
test('normalizeEvent correctly handles granuleIds and collectionIds if reportType is Internal', (t) => {
  const inputEvent = {
    systemBucket: 'systemBucket',
    stackName: 'stackName',
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reportType: 'Internal',
    granuleId: 'someGranuleId',
    collectionId: 'someCollectionId1',
  };

  const expected = {
    ...inputEvent,
    granuleIds: ['someGranuleId'],
    collectionIds: ['someCollectionId1'],
  };

  const actual = normalizeEvent(inputEvent);
  t.deepEqual(actual, expected);
});

test('Invalid report type throws InvalidArgument error', (t) => {
  const reportType = randomId('badType');
  const inputEvent = { reportType };

  t.throws(() => normalizeEvent(inputEvent), {
    instanceOf: InvalidArgument,
    message: `${reportType} is not a valid report type. Please use one of ["Granule Inventory","Granule Not Found","Internal","Inventory"].`,
  });
});

test('valid Reports types from reconciliation schema do not throw an error.', (t) => {
  const validReportTypes = reconciliationReport.properties.type.enum;
  validReportTypes.forEach((reportType) => {
    t.notThrows(() => normalizeEvent({ reportType }));
  });
});
