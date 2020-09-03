'use strict';

const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const CRP = rewire('../../lambdas/create-reconciliation-report');
const isOneWayReport = CRP.__get__('isOneWayReport');
const shouldFilter = CRP.__get__('shouldFilter');

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
    t.true(isOneWayReport({ ...allTrueKeys, ...allFalseKeys }));
  }
);

test(
  'shouldFilter returns true only when one or more specific parameters '
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
      t.true(shouldFilter({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(shouldFilter({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(shouldFilter(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(shouldFilter(allFalseKeys));
    t.true(shouldFilter({ ...allTrueKeys, ...allFalseKeys }));
  }
);
