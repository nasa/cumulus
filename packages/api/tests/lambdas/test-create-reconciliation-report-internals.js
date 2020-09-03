'use strict';

const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const CRP = rewire('../../lambdas/create-reconciliation-report');
const isOneWayReport = CRP.__get__('isOneWayReport');
const shouldFilterByTime = CRP.__get__('shouldFilterByTime');

test(
  'isOneWayReport returns true only when one or more specific parameters '
    + ' are present on the reconciliation report object.',
  (t) => {
    const paramsThatShouldReturnTrue = [
      'startTimestamp',
      'endTimestamp',
      'collectionId',
    ];

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
  'shouldFilterByTime returns true only when one or more specific parameters '
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
      t.true(shouldFilterByTime({ [p]: randomId('value') })));

    paramsThatShouldReturnFalse.map((p) =>
      t.false(shouldFilterByTime({ [p]: randomId('value') })));

    const allTrueKeys = paramsThatShouldReturnTrue.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.true(shouldFilterByTime(allTrueKeys));

    const allFalseKeys = paramsThatShouldReturnFalse.reduce(
      (accum, current) => ({ ...accum, [current]: randomId('value') }),
      {}
    );
    t.false(shouldFilterByTime(allFalseKeys));
    t.true(shouldFilterByTime({ ...allTrueKeys, ...allFalseKeys }));
  }
);
