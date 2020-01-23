'use strict';

const awsServerlessExpress = require('aws-serverless-express');
const bodyParser = require('body-parser');
const boom = require('express-boom');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const distributionRouter = require('express-promise-router')();
const EarthdataLogin = require('@cumulus/api/lib/EarthdataLogin');
const express = require('express');
const hsts = require('hsts');
const Logger = require('@cumulus/logger');
const morgan = require('morgan');
const urljoin = require('url-join');

const { AccessToken } = require('@cumulus/api/models');
const { isLocalApi } = require('@cumulus/api/lib/testUtils');
const awsServices = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/common/errors');

const log = new Logger({ sender: 's3credentials' });

/**
 * Use NGAP's time-based, temporary credential dispensing lambda.
 *
 * @param {string} username - earthdata login username
 * @returns {Promise<Object>} Payload containing AWS STS credential object valid for 1
 *                   hour.  The credential object contains keys: AccessKeyId,
 *                   SecretAccessKey, SessionToken, Expiration and can be use
 *                   for same-region s3 direct access.
 */
async function requestTemporaryCredentialsFromNgap(username) {
  const FunctionName = process.env.STSCredentialsLambda;
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600', // one hour max allowed by AWS.
    rolesession: username, // <- shows up in access logs
    userid: username // <- used by NGAP
  });

  return awsServices.lambda().invoke({
    FunctionName,
    Payload
  }).promise();
}

/**
 * Dispenses time based temporary credentials for same-region direct s3 access.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} the express response object with object containing
 *                   tempoary s3 credentials for direct same-region s3 access.
 */
async function s3credentials(req, res) {
  const username = req.authorizedMetadata.userName;
  const credentials = await requestTemporaryCredentialsFromNgap(username);
  const creds = JSON.parse(credentials.Payload);
  if (Object.keys(creds).some((key) => ['errorMessage', 'errorType', 'stackTrace'].includes(key))) {
    log.error(credentials.Payload);
    return res.boom.failedDependency(
      `Unable to retrieve credentials from Server: ${credentials.Payload}`
    );
  }
  return res.send(creds);
}

// Running API locally will be on http, not https, so cookies
// should not be set to secure for local runs of the API.
const useSecureCookies = () => {
  if (isLocalApi()) {
    return false;
  }
  return true;
};

/**
 * Returns a configuration object
 *
 * @returns {Object} the configuration object needed to handle requests
 */
function getConfigurations() {
  const earthdataLoginClient = EarthdataLogin.createFromEnv({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT
  });

  return {
    accessTokenModel: new AccessToken(),
    authClient: earthdataLoginClient,
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Client: awsServices.s3()
  };
}

/**
 * Responds to a redirect request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleRedirectRequest(req, res) {
  const {
    accessTokenModel,
    authClient,
    distributionUrl
  } = getConfigurations();

  const { code, state } = req.query;

  const getAccessTokenResponse = await authClient.getAccessToken(code);

  await accessTokenModel.create({
    accessToken: getAccessTokenResponse.accessToken,
    expirationTime: getAccessTokenResponse.expirationTime,
    refreshToken: getAccessTokenResponse.refreshToken,
    username: getAccessTokenResponse.username
  });

  return res
    .cookie(
      'accessToken',
      getAccessTokenResponse.accessToken,
      {
        expires: new Date(getAccessTokenResponse.expirationTime),
        httpOnly: true,
        secure: useSecureCookies()
      }
    )
    .set({ Location: urljoin(distributionUrl, state) })
    .status(307)
    .send('Redirecting');
}

/**
 * Responds to a request for temporary s3 credentials.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object containing
 * temporary credentials
 */
async function handleCredentialRequest(req, res) {
  return s3credentials(req, res);
}

/**
 * Checks if the token is expired
 *
 * @param {Object} accessTokenRecord - the access token record
 * @returns {boolean} true indicates the token is expired
 */
function isAccessTokenExpired(accessTokenRecord) {
  return accessTokenRecord.expirationTime < Date.now();
}

/**
 * Helper function to pull bucket out of a path string.
 * Will ignore leading slash.
 * "/bucket/key" -> "bucket"
 * "bucket/key" -> "bucket"
 *
 * @param {string} path - express request path parameter
 * @returns {string} the first part of a path which is our bucket name
 */
function bucketNameFromPath(path) {
  return path.split('/').filter((d) => d).shift();
}

/**
 * Reads the input path and determines if this is a request for public data
 * or not.
 *
 * @param {string} path - req.path paramater
 * @returns {boolean} - whether this request goes to a public bucket
 */
function isPublicRequest(path) {
  try {
    const publicBuckets = process.env.public_buckets.split(',');
    const requestedBucket = bucketNameFromPath(path);
    return publicBuckets.includes(requestedBucket);
  } catch (error) {
    return false;
  }
}

/**
 * Ensure request is authorized through EarthdataLogin or redirect to become so.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function ensureAuthorizedOrRedirect(req, res, next) {
  // Skip authentication for debugging purposes.
  // TODO Really should remove this
  if (process.env.FAKE_AUTH) {
    req.authorizedMetadata = { userName: randomId('username') };
    return next();
  }

  // Public data doesn't need authentication
  if (isPublicRequest(req.path)) {
    req.authorizedMetadata = { userName: 'unauthenticated user' };
    return next();
  }

  const {
    accessTokenModel,
    authClient
  } = getConfigurations();

  const redirectURLForAuthorizationCode = authClient.getAuthorizationUrl(req.path);
  const accessToken = req.cookies.accessToken;
  if (!accessToken) return res.redirect(307, redirectURLForAuthorizationCode);

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  } catch (err) {
    if (err instanceof RecordDoesNotExist) {
      return res.redirect(307, redirectURLForAuthorizationCode);
    }
    throw err;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return res.redirect(307, redirectURLForAuthorizationCode);
  }

  req.authorizedMetadata = { userName: accessTokenRecord.username };
  return next();
}

distributionRouter.get('/redirect', handleRedirectRequest);
distributionRouter.get('/s3credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);

const distributionApp = express();

// logging config
morgan.token('error_obj', (_req, res) => {
  if (res.statusCode !== 200) {
    return res.error;
  }
  return undefined;
});
morgan.format(
  'combined',
  '[:date[clf]] ":method :url HTTP/:http-version"'
  + ':status :res[content-length] ":referrer" ":user-agent" :error_obj'
);

// Config
distributionApp.use(boom());
distributionApp.use(morgan('combined'));
distributionApp.use(cors());
distributionApp.use(cookieParser());
distributionApp.use(bodyParser.json()); // for parsing distributionApplication/json
distributionApp.use(hsts({ maxAge: 31536000 }));

distributionApp.use('/', distributionRouter);

// global 404 response when page is not found
distributionApp.use((req, res) => {
  res.boom.notFound('requested page not found');
});

// catch all error handling
distributionApp.use((err, req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Something broke!');
});

const server = awsServerlessExpress.createServer(distributionApp, null);

const handler = (event, context) => awsServerlessExpress.proxy(server, event, context);

module.exports = {
  distributionApp,
  handler
};
