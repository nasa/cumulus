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
const { isAccessTokenExpired } = require('@cumulus/api/lib/token');
const awsServices = require('@cumulus/aws-client/services');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { getTokenUsername, TokenValidationError } = require('./EarthdataLogin');

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

const isFailedCredentialsResponse = (credentials) => {
  /* eslint-disable no-prototype-builtins */

  if (credentials.hasOwnProperty('errorMessage')) return true;
  if (credentials.hasOwnProperty('errorType')) return true;
  if (credentials.hasOwnProperty('stackTrace')) return true;

  /* eslint-enable no-prototype-builtins */

  return false;
};

/**
 * Dispenses time based temporary credentials for same-region direct s3 access.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} the express response object with object containing
 *                   tempoary s3 credentials for direct same-region s3 access.
 */
async function handleCredentialRequest(req, res) {
  const username = req.authorizedMetadata.userName;

  const credentialsResponse = await requestTemporaryCredentialsFromNgap(username);

  const parsedCredentialsResponse = JSON.parse(credentialsResponse.Payload);

  if (isFailedCredentialsResponse(parsedCredentialsResponse)) {
    log.error(credentialsResponse.Payload);

    return res.boom.failedDependency(
      `Unable to retrieve credentials from Server: ${credentialsResponse.Payload}`
    );
  }

  return res.send(parsedCredentialsResponse);
}

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

const isSecureRequest = (req) => req.protocol === 'https';

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
        secure: isSecureRequest(req)
      }
    )
    .set({ Location: urljoin(distributionUrl, state) })
    .status(307)
    .send('Redirecting');
}

const useFakeAuth = () => Boolean(process.env.FAKE_AUTH);

const handleFakeAuth = (req, _res, next) => {
  req.authorizedMetadata = { userName: 'fake-username' };

  return next();
};

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

const handlePublicAuth = (req, _res, next) => {
  req.authorizedMetadata = { userName: 'unauthenticated user' };
  return next();
};

const isTokenAuthRequest = (req) =>
  req.get('EDL-Client-Id') && req.get('EDL-Token');

const handleTokenAuthRequest = async (req, res, next) => {
  try {
    const userName = await getTokenUsername({
      earthdataLoginEndpoint: process.env.EARTHDATA_BASE_URL,
      clientId: process.env.EARTHDATA_CLIENT_ID,
      onBehalfOf: req.get('EDL-Client-Id'),
      token: req.get('EDL-Token')
    });

    req.authorizedMetadata = { userName };

    return next();
  } catch (error) {
    if (error instanceof TokenValidationError) {
      res.boom.forbidden('EDL-Token authentication failed');
    }

    throw error;
  }
};

const handleOAuth2 = async (req, res, next) => {
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
};

/**
 * Ensure request is authorized through EarthdataLogin or redirect to become so.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function authenticateRequest(req, res, next) {
  // Skip authentication for debugging purposes.
  if (useFakeAuth()) {
    return handleFakeAuth(req, res, next);
  }

  // Public data doesn't need authentication
  if (isPublicRequest(req.path)) {
    return handlePublicAuth(req, res, next);
  }

  // If an Earthdata Login token was provided, try to authenticate using that
  if (isTokenAuthRequest(req)) {
    return handleTokenAuthRequest(req, res, next);
  }

  // By default, use OAuth2
  return handleOAuth2(req, res, next);
}

distributionRouter.get('/redirect', handleRedirectRequest);
distributionRouter.get('/s3credentials', authenticateRequest, handleCredentialRequest);

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
distributionApp.use((_req, res) => {
  res.boom.notFound('requested page not found');
});

// Catch-all error handling
distributionApp.use((err, _req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Something broke!');
});

const handler = async (event, context) =>
  awsServerlessExpress.proxy(
    awsServerlessExpress.createServer(distributionApp),
    event,
    context,
    'PROMISE'
  ).promise;

module.exports = {
  distributionApp,
  handler
};
