'use strict';

const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const CRP = rewire('../../lambdas/create-reconciliation-report');
const linkingFilesToGranules = CRP.__get__('linkingFilesToGranules');
const isOneWayCollectionReport = CRP.__get__('isOneWayCollectionReport');
const isOneWayGranuleReport = CRP.__get__('isOneWayGranuleReport');

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

test('linkingFilesToGranules return values', (t) => {
  const reportTypesToReturnFalse = ['Granule Inventory', 'Internal', 'Inventory'];
  const reportTypesToReturnTrue = ['Granule Not Found'];

  reportTypesToReturnFalse.map((param) => t.false(linkingFilesToGranules(param)));
  reportTypesToReturnTrue.map((param) => t.true(linkingFilesToGranules(param)));
});
