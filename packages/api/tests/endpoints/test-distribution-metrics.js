'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const rewire = require('rewire');

const {
  aws: { apigateway, cloudwatch },
  testUtils: { randomId }
} = require('@cumulus/common');

const models = require('../../models');
const assertions = require('../../lib/assertions');
const { createFakeJwtAuthToken } = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');

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

process.env.UsersTable = randomId('UsersTable');
process.env.AccessTokensTable = randomId('AccessTokensTable');
process.env.ProvidersTable = randomId('ProvidersTable');
process.env.stackName = randomId('stackName');
process.env.distributionApiId = randomId('distributionApiId');
process.env.TOKEN_SECRET = randomId('TOKEN_SECRET');
const { app } = require('../../app');

const cw = cloudwatch();

const oneMinuteinMs = 1000 * 60;

const createFakeAuth = async () => {
  const userModel = new models.User();
  await userModel.createTable();

  const accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  const jwtAuthToken = await createFakeJwtAuthToken({
    accessTokenModel,
    userModel
  });
  const tenMinutesInMs = oneMinuteinMs * 10;
  const unauthorizedToken = createJwtToken({
    accessToken: randomId('access'),
    expirationTime: new Date(Date.now() + tenMinutesInMs),
    username: randomId('user')
  });

  return {
    jwtAuthToken,
    unauthorizedToken,
    userModel,
    accessTokenModel,
    async cleanup() {
      await this.userModel.deleteTable();
      await this.accessTokenModel.deleteTable();
    }
  };
};

let auth;
test.before(async () => {
  auth = await createFakeAuth();
});

test.after.always(async () => {
  await auth.cleanup();
});

test.beforeEach((t) => {
  t.context.originalDateNow = Date.now;
  Date.now = () => 1557525280918; //'2019-05-10T21:54:00.000Z'
});

test.afterEach((t) => {
  Date.now = t.context.originalDateNow;
});
test('GET with invalid access token returns an invalid token response', async (t) => {
  const response = await request(app)
    .get('/distributionMetrics')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET with unauthorized user token returns an unauthorized user response', async (t) => {
  const response = await request(app)
    .get('/distributionMetrics')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${auth.unauthorizedToken}`)
    .expect(401);

  assertions.isInvalidAuthorizationResponse(t, response);
});

test('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/distributionMetrics')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
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
  sinon.restore();
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
