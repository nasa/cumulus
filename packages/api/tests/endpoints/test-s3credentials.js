'use strict';
'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const {
  testUtils: {
    randomString
  },
  aws: {
    lambda
  }
} = require('@cumulus/common');
const { verifyJwtToken } = require('../../lib/token');
const assertions = require('../../lib/assertions');
const models = require('../../models');
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory
} = require('../../lib/testUtils');
const {
  createJwtToken
} = require('../../lib/token');

process.env.TOKEN_SECRET = randomString();
let accessTokenModel;
let userModel;
let jwtAuthToken;


// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new models.User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
});

test('GET invokes request for credentials with username from authToken', async (t) => {
  const lambdaInstance = lambda();
  const fakeCredential = { fake: 'credential' };
  const invokeFake = sinon.fake.returns({ promise: () => Promise.resolve(fakeCredential) });
  const previousInvoke = lambdaInstance.invoke;
  lambdaInstance.invoke = invokeFake;

  const parsedToken = verifyJwtToken(jwtAuthToken);
  const FunctionName = 'gsfc-ngap-sh-s3-sts-get-keys';
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    duration: '3600',
    rolesession: 'SAME_REGION_ACCESS',
    userid: parsedToken.username
  });

  await request(app)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.true(invokeFake.calledOnceWithExactly({
    FunctionName,
    Payload
  }));

  lambdaInstance.invoke = previousInvoke;
});

test('GET with invalid access token returns an invalid token response', async (t) => {
  const response = await request(app)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET with unauthorized user token returns an unauthorized user response', async (t) => {
  const accessTokenRecord = await accessTokenModel.create(fakeAccessTokenFactory());
  const requestToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${requestToken}`)
    .expect(401);

  assertions.isInvalidAuthorizationResponse(t, response);
});

test('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
});
