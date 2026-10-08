'use strict';

const test = require('ava');
const request = require('supertest');
const { s3, ssm } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const assertions = require('../../lib/assertions');
const models = require('../../models');
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');
const {
  createJwtToken,
} = require('../../lib/token');

const CMR_ENVIRONMENT = randomString();
const CMR_PROVIDER = randomString();
const CMR_OAUTH_PROVIDER = randomString();
const STACKNAME = randomId('stack');
process.env.CMR_ENVIRONMENT = CMR_ENVIRONMENT;
process.env.cmr_provider = CMR_PROVIDER;
process.env.cmr_oauth_provider = CMR_OAUTH_PROVIDER;
process.env.TOKEN_SECRET = randomString();
process.env.stackName = STACKNAME;
const ICEBERG_ADMINS_PARAMETER_NAME = `${STACKNAME}-iceberg_admins_list`;
let accessTokenModel;
let jwtAuthToken;

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.afterEach.always(async () => {
  await ssm().deleteParameter({ Name: ICEBERG_ADMINS_PARAMETER_NAME }).catch((error) => {
    if (error.name !== 'ParameterNotFound') throw error;
  });
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
});

const getInstanceMeta = () => request(app)
  .get('/instanceMeta')
  .set('Accept', 'application/json')
  .set('Authorization', `Bearer ${jwtAuthToken}`)
  .expect(200);

const putIcebergAdminsParameter = (Value) => ssm().putParameter({
  Name: ICEBERG_ADMINS_PARAMETER_NAME,
  Type: 'StringList',
  Value,
  Overwrite: true,
});

// Tests below create/delete the shared SSM parameter, so they must not run concurrently
test.serial('GET returns expected metadata', async (t) => {
  await putIcebergAdminsParameter('admin-one,admin-two');
  const response = await getInstanceMeta();

  t.deepEqual(response.body, {
    cmr: {
      provider: CMR_PROVIDER,
      environment: CMR_ENVIRONMENT,
      oauth_provider: CMR_OAUTH_PROVIDER,
    },
    cumulus: {
      stackName: STACKNAME,
    },
    icebergAdmins: ['admin-one', 'admin-two'],
  });
});

test.serial('GET returns an empty icebergAdmins list when the SSM parameter does not exist', async (t) => {
  const response = await getInstanceMeta();

  t.deepEqual(response.body.icebergAdmins, []);
  t.is(response.body.cumulus.stackName, STACKNAME);
});

test.serial('GET trims whitespace and ignores empty entries in the icebergAdmins list', async (t) => {
  await putIcebergAdminsParameter('admin-one, admin-two,,');
  const response = await getInstanceMeta();

  t.deepEqual(response.body.icebergAdmins, ['admin-one', 'admin-two']);
});

test('GET with invalid access token returns an invalid token response', async (t) => {
  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET with unauthorized user token returns an unauthorized user response', async (t) => {
  const accessTokenRecord = await accessTokenModel.create(fakeAccessTokenFactory());
  const requestToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${requestToken}`)
    .expect(401);

  assertions.isInvalidAuthorizationResponse(t, response);
});

test('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
});
