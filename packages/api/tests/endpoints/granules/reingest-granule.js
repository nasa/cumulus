'use strict';

const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { createFakeJwtAuthToken } = require('../../../lib/testUtils');

const models = require('../../../models');

const { app } = require('../../../app');

process.env.AccessTokensTable = randomString();
process.env.backgroundQueueName = randomString();
process.env.CollectionsTable = randomString();
process.env.GranulesTable = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.UsersTable = randomString();

const fakeCollectionId = 'FakeCollection___006';
const fakeCollection = { duplicateHandling: 'replace' };

let accessTokenModel;
let jwtAuthToken;
let userModel;

test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
});

test('put request with reingest action calls the granuleModel.reingest function with expected parameters', async (t) => {
  const granuleGetStub = sinon.stub(models.Granule.prototype, 'get').returns(
    new Promise((resolve) => resolve({ collectionId: fakeCollectionId }))
  );
  const granuleReingestStub = sinon.stub(models.Granule.prototype, 'reingest').returns(
    new Promise((resolve) => resolve({ response: 'fakeResponse' }))
  );

  const collectionGetStub = sinon.stub(models.Collection.prototype, 'get').returns(
    new Promise((resolve) => resolve(fakeCollection))
  );

  const expectedQueueName = process.env.backgroundQueueName;
  const body = {
    action: 'reingest'
  };

  await request(app)
    .put('/granules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(200);

  t.is(granuleReingestStub.calledOnce, true);

  const reingestArgs = granuleReingestStub.args[0];
  const { queueName } = reingestArgs[0];
  t.truthy(queueName);
  t.is(queueName, expectedQueueName);

  granuleGetStub.restore();
  granuleReingestStub.restore();
  collectionGetStub.restore();
});
