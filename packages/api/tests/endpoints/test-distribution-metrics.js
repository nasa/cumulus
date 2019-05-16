'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const {
  testUtils: { randomId }
} = require('@cumulus/common');

const distributionMetrics = rewire('../../endpoints/distribution-metrics');

const fixture = require('./fixtures/distribution-metrics-fixture');

const valuesFromMetrics = distributionMetrics.__get__('valuesFromMetrics');
const listAllStages = distributionMetrics.__get__('listAllStages');
const sumArray = distributionMetrics.__get__('sumArray');
const getStageName = distributionMetrics.__get__('getStageName');
const combinedResults = distributionMetrics.__get__('combinedResults');
const buildGetMetricParamsFromListMetricsResult = distributionMetrics.__get__(
  'buildGetMetricParamsFromListMetricsResult'
);

const sandbox = sinon.createSandbox();

test.beforeEach((t) => {
  t.context.originalDateNow = Date.now;
  Date.now = () => 1557525280918; //'2019-05-10T21:54:00.000Z'
});

test.afterEach((t) => {
  Date.now = t.context.originalDateNow;
  sandbox.restore();
});

test('sumArray returns sum of an array', (t) => {
  const inputValues = [1, 3, 5, 7];
  const expected = 16;
  const actual = sumArray(inputValues);

  t.is(actual, expected);
});

test('sumArray returns zero for an empty array []', (t) => {
  const inputValues = [];
  const expected = 0;
  const actual = sumArray(inputValues);

  t.is(actual, expected);
});

test('valuesFromMetrics returns the Values arrays of an awsListMetrics result ', (t) => {
  const expected = [3, 11, 3, 11];
  const actual = valuesFromMetrics([
    fixture.getMetricDatasResult,
    fixture.getMetricDatasResult
  ]);
  t.deepEqual(expected, actual);
});

test('valuesFromMetrics returns [0] if no Value fields are available', (t) => {
  const expected = [0];
  const modified = [{ ...fixture.getMetricDatasResult[0] }];
  delete modified[0].MetricDataResults;

  const actual = valuesFromMetrics(modified);
  t.deepEqual(expected, actual);
});

test('listAllStages returns list of api stages present', async (t) => {
  const expected = ['dev', 'prod'];
  const callGetStagesFake = sinon.fake.resolves(fixture.getStagesResult);

  const resetDouble = distributionMetrics.__set__(
    'callGetStages',
    callGetStagesFake
  );
  process.env.distributionApiId = randomId('apiId');

  const actual = await listAllStages();

  t.deepEqual(expected, actual);
  t.true(callGetStagesFake.calledOnceWith(process.env.distributionApiId));

  resetDouble();
});

test('getStageName throws if cumulus has multiple stages defined', async (t) => {
  const original = distributionMetrics.__get__('listAllStages');
  const listAllStagesFake = () => Promise.resolve(['dev', 'prod']);
  distributionMetrics.__set__('listAllStages', listAllStagesFake);

  const error = await t.throws(getStageName());
  console.log(error.message);
  t.true(
    error.message.includes('cumulus configured with wrong number of stages: 2')
  );
  distributionMetrics.__set__('listAllStages', original);
});

test('getStageName returns stage name for a single stage', async (t) => {
  const original = distributionMetrics.__get__('listAllStages');
  const listAllStagesFake = () => Promise.resolve(['only stage']);
  distributionMetrics.__set__('listAllStages', listAllStagesFake);
  const expected = 'only stage';

  const actual = await getStageName();
  t.is(expected, actual);
  distributionMetrics.__set__('listAllStages', original);
});

test('buildGetMetricParamsFromListMetricsResult returns correct parameters for getMetricDatas', (t) => {
  const randomIdFake = () => 'fakeIdValue';
  const resetDouble = distributionMetrics.__set__('randomId', randomIdFake);
  const expected = fixture.getMetricDatasInput;
  const actual = buildGetMetricParamsFromListMetricsResult(
    fixture.listMetricsResult
  );
  t.deepEqual(expected, actual);
  resetDouble();
});

test('combineResults sums errors and returns them', (t) => {
  const userErrors = 1;
  const serverErrors = 2;
  const accessErrors = 3;
  const accessSuccesses = 4;

  const actual = combinedResults(
    userErrors,
    serverErrors,
    accessErrors,
    accessSuccesses
  );
  const expected = {
    errors: '6',
    successes: '4'
  };
  t.deepEqual(expected, actual);
});
