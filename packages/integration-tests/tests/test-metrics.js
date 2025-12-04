'use strict';

const sinon = require('sinon');
const test = require('ava');

const { getAggregateMetricQuery, getInvocationCount } = require('../metrics');

test('getAggregateMetricQuery returns the max average for an Average metrics query', async (t) => {
  const cloudwatch = () => ({
    getMetricStatistics: (_val) => ({
      promise: () => Promise.resolve({ Datapoints: [{ Average: 10 }, { Average: 20 }] }),
    }),
  });
  const actual = await getAggregateMetricQuery({ Statistics: ['Average'] }, cloudwatch);
  t.is(actual, 20);
});

test('getAggregateMetricQuery returns the maximum for a Maximum metrics query', async (t) => {
  const cloudwatch = () => ({
    getMetricStatistics: (_val) => ({
      promise: () => Promise.resolve({ Datapoints: [{ Maximum: 10 }, { Maximum: 30 }] }),
    }),
  });
  const actual = await getAggregateMetricQuery({ Statistics: ['Maximum'] }, cloudwatch);
  t.is(actual, 30);
});

test('getAggregateMetricQuery returns the minimum for a Minimum metrics query', async (t) => {
  const cloudwatch = () => ({
    getMetricStatistics: (_val) => ({
      promise: () => Promise.resolve({ Datapoints: [{ Minimum: 10 }, { Minimum: 30 }] }),
    }),
  });
  const actual = await getAggregateMetricQuery({ Statistics: ['Minimum'] }, cloudwatch);
  t.is(actual, 10);
});

test('getAggregateMetricQuery returns the total for a Sum query', async (t) => {
  const cloudwatch = () => ({
    getMetricStatistics: (_val) => ({
      promise: () => Promise.resolve({ Datapoints: [{ Sum: 10 }, { Sum: 30 }] }),
    }),
  });
  const actual = await getAggregateMetricQuery({ Statistics: ['Sum'] }, cloudwatch);
  t.is(actual, 40);
});

test('getInvocationCount returns the expected invocation count', async (t) => {
  const aggregateMetricQueryFunction = sinon.stub();
  aggregateMetricQueryFunction.returns(5);
  const actual = await getInvocationCount({
    aggregateMetricQueryFunction,
    beginTime: new Date(),
    interval: 15,
    lambda: 'fakeLambda',
    maxCount: 8,
    minCount: 3,
    timeout: 300,
  });
  t.is(actual, 5);
});

test('getInvocationCount returns immediately if result is greater than the max count', async (t) => {
  const aggregateMetricQueryFunction = sinon.stub();
  aggregateMetricQueryFunction.returns(5);
  const actual = await getInvocationCount({
    aggregateMetricQueryFunction,
    beginTime: new Date(),
    interval: 15,
    lambda: 'fakeLambda',
    maxCount: 3,
    minCount: 2,
    timeout: 20,
  });
  t.is(actual, 5);
});

test('getInvocationCount throws immediately if result does not stabilize within the timeout period', async (t) => {
  const aggregateMetricQueryFunction = sinon.stub();
  [2, 4, 5, 6].map(
    (element, index) => aggregateMetricQueryFunction.onCall(index).returns(element)
  );

  await t.throwsAsync(getInvocationCount({
    aggregateMetricQueryFunction,
    beginTime: new Date(),
    interval: 15,
    lambda: 'fakeLambda',
    maxCount: 20,
    minCount: 5,
    timeout: 60,
  }));
});

test('getInvocationCount returns the expected value if result stabilizes', async (t) => {
  const aggregateMetricQueryFunction = sinon.stub();
  [1, 2, 3, 4, 5, 6, 8, 8, 8, 8, 8].map(
    (element, index) => aggregateMetricQueryFunction.onCall(index).returns(element)
  );
  const actual = await getInvocationCount({
    aggregateMetricQueryFunction,
    beginTime: new Date(),
    interval: 1,
    lambda: 'fakeLambda',
    maxCount: 20,
    minCount: 5,
    timeout: 300,
  });
  t.is(actual, 8);
});
