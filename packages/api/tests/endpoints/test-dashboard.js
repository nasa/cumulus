'use strict';

const test = require('ava');
const request = require('supertest');
const { randomId } = require('@cumulus/common/test-utils');

const { s3 } = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const models = require('../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');

process.env.TOKEN_SECRET = randomId('secret');
process.env.AccessTokensTable = randomId('accessTokens');
process.env.stackName = randomId('stackName');
process.env.system_bucket = randomId('systembucket');

// import the express app after setting the env variables
const { app } = require('../../app');

let accessTokenModel;
const testBucketName = process.env.system_bucket;
const testFileKey = `${randomId('testFilePath')}/${randomId('testFileKey')}.html`;
const testData = '<!DOCTYPE html><html><body><h1>Welcome Page</h1><p>Welcome.</p></body></html>';
const testDataContentType = 'text/html';
let jwtAuthToken;

test.before(async () => {
  await s3().createBucket({ Bucket: testBucketName });
  await promiseS3Upload({
    params: {
      Bucket: testBucketName,
      Key: testFileKey,
      Body: testData,
      ContentType: testDataContentType,
    },
  });

  const username = randomId('username');
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(testBucketName);
});

test('GET returns the requested file', async (t) => {
  const response = await request(app)
    .get(`/dashboard/${testBucketName}/${testFileKey}`)
    .set('Accept', testDataContentType)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  t.is(response.text, testData);
});

test('GET returns error when the requested file does not exist', async (t) => {
  const response = await request(app)
    .get(`/dashboard/${testBucketName}/nonexistkey`)
    .set('Accept', testDataContentType)
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, `file ${testBucketName}/nonexistkey does not exist!`);
});
