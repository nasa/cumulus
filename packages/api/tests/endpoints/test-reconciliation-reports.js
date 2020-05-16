'use strict';

const test = require('ava');
const isEqual = require('lodash/isEqual');
const omit = require('lodash/omit');
const request = require('supertest');
const awsServices = require('@cumulus/aws-client/services');
const { buildS3Uri, fileExists, parseS3Uri, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  createFakeJwtAuthToken,
  fakeReconciliationReportFactory,
  setAuthorizedOAuthUsers
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const indexer = require('../../es/indexer');
const { Search } = require('../../es/search');

process.env.invoke = 'granule-reconciliation-reports';
process.env.stackName = 'test-stack';
process.env.system_bucket = 'testsystembucket';
process.env.AccessTokensTable = randomString();
process.env.ReconciliationReportsTable = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

let esClient;
const esIndex = randomString();

let jwtAuthToken;
let accessTokenModel;
let reconciliationReportModel;
let fakeReportRecords = [];

test.before(async () => {
  // create esClient
  esClient = await Search.es('fakehost');

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  reconciliationReportModel = new models.ReconciliationReport();
  await reconciliationReportModel.createTable();

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  const reportNames = [randomString(), randomString(), randomString()];
  const reportDirectory = `${process.env.stackName}/reconciliation-reports`;

  fakeReportRecords = reportNames.map((reportName) => fakeReconciliationReportFactory({
    name: reportName,
    location: buildS3Uri(process.env.system_bucket, `${reportDirectory}/${reportName}`)
  }));

  // add report records to database and report files go to s3
  // the first and second record have report files in s3, the report file for third one is mssing
  await Promise.all(fakeReportRecords.slice(0, 2).map((reportRecord) =>
    awsServices.s3().putObject({
      ...parseS3Uri(reportRecord.location),
      Body: JSON.stringify({ test_key: `${reportRecord.name} test data` })
    }).promise()));

  // add records to es
  await Promise.all(fakeReportRecords.map((reportRecord) =>
    reconciliationReportModel.create(reportRecord)
      .then((record) => indexer.indexReconciliationReport(esClient, record, esAlias))));
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await reconciliationReportModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/reconciliationReports')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/reconciliationReports/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .post('/reconciliationReports')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .delete('/reconciliationReports/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/reconciliationReports')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-911 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('CUMULUS-911 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/reconciliationReports/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-911 GET with pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('CUMULUS-911 POST with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .post('/reconciliationReports')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-911 POST with an unauthorized user returns an unauthorized response');

test.serial('CUMULUS-911 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/reconciliationReports/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-911 DELETE with pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('default returns list of reports', async (t) => {
  const response = await request(app)
    .get('/reconciliationReports')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const results = response.body;
  t.is(results.results.length, 3);

  const recordsAreEqual = (record1, record2) =>
    isEqual(omit(record1, ['updatedAt', 'timestamp']), omit(record2, ['updatedAt', 'timestamp']));

  results.results.forEach((item) => {
    const recordsFound = fakeReportRecords.filter((record) => recordsAreEqual(record, item));
    t.is(recordsFound.length, 1);
  });
});

test.serial('get a report', (t) =>
  Promise.all(fakeReportRecords.slice(0, 2).map(async (record) => {
    const response = await request(app)
      .get(`/reconciliationReports/${record.name}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .expect(200);
    t.deepEqual(response.body, { test_key: `${record.name} test data` });
  })));

test.serial('get 404 if the report record doesnt exist', async (t) => {
  const response = await request(app)
    .get('/reconciliationReports/404record')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.status, 404);
  t.is(response.body.message, 'No record found for 404record');
});

test.serial('get 404 if the report file doesnt exist', async (t) => {
  const response = await request(app)
    .get(`/reconciliationReports/${fakeReportRecords[2].name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.status, 404);
  t.is(response.body.message, 'The report does not exist!');
});

test.serial('delete a report', (t) =>
  Promise.all(fakeReportRecords.map(async (record) => {
    const response = await request(app)
      .delete(`/reconciliationReports/${record.name}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .expect(200);
    t.deepEqual(response.body, { message: 'Report deleted' });

    const parsed = parseS3Uri(record.location);
    const exists = await fileExists(parsed.Bucket, parsed.Key);
    t.false(exists);
  })));

test.serial('create a report', async (t) => {
  const response = await request(app)
    .post('/reconciliationReports')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const content = response.body;
  t.is(content.message, 'Report is being generated');
});
