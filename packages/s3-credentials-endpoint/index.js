'use strict';

const awsServerlessExpress = require('aws-serverless-express');
const bodyParser = require('body-parser');
const boom = require('express-boom');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const distributionRouter = require('express-promise-router')();
const template = require('lodash/template');
const { promisify } = require('util');
const fs = require('fs');
const readFile = promisify(fs.readFile);
const {
  EarthdataLoginClient,
  EarthdataLoginError,
} = require('@cumulus/earthdata-login-client');
const express = require('express');
const hsts = require('hsts');
const { join: pathjoin } = require('path');
const Logger = require('@cumulus/logger');
const morgan = require('morgan');
const urljoin = require('url-join');

const { AccessToken } = require('@cumulus/api/models');
const { isLocalApi } = require('@cumulus/api/lib/testUtils');
const { isAccessTokenExpired } = require('@cumulus/api/lib/token');
const { getUserAccessableBuckets } = require('@cumulus/cmrjs');
const awsServices = require('@cumulus/aws-client/services');
const { RecordDoesNotExist } = require('@cumulus/errors');

const log = new Logger({ sender: 's3credentials' });

// From https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html#API_AssumeRole_RequestParameters
const roleSessionNameRegex = /^[\w+,.=@-]{2,64}$/;

const isValidRoleSessionNameString = (x) => roleSessionNameRegex.test(x);

const buildRoleSessionName = (username, clientName) => {
  if (clientName) {
    return `${username}@${clientName}`;
  }

  return username;
};

const buildEarthdataLoginClient = () =>
  new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    earthdataLoginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
  });

/**
 * Use NGAP's time-based, temporary credential dispensing lambda.
 *
 * @param {string} username - earthdata login username
 * @returns {Promise<Object>} Payload containing AWS STS credential object valid for 1
 *                   hour.  The credential object contains keys: AccessKeyId,
 *                   SecretAccessKey, SessionToken, Expiration and can be use
 *                   for same-region s3 direct access.
 */
async function requestTemporaryCredentialsFromNgap({
  lambda,
  lambdaFunctionName,
  userId,
  policy = undefined,
  roleSessionName,
}) {
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600', // one hour max allowed by AWS.
    rolesession: roleSessionName, // <- shows up in S3 server access logs
    userid: userId, // <- used by NGAP
    policy,
  });

  return lambda.invoke({
    FunctionName: lambdaFunctionName,
    Payload,
  }).promise();
}

/**
 * Sends a sample webpage describing how to use s3Credentials endpoint
 *
 * @param {Object} _req - express request object (unused)
 * @param {Object} res - express response object
 * @returns {Object} express repose object of the s3Credentials directions.
 */
async function displayS3CredentialInstructions(_req, res) {
  const instructionTemplate = await readFile(pathjoin(__dirname, 'instructions', 'index.html'), 'utf-8');
  const compiled = template(instructionTemplate);
  res.send(compiled(process.env));
}

function ensureEndpointEnabled(res) {
  const disableS3Credentials = process.env.DISABLE_S3_CREDENTIALS;

  if (disableS3Credentials && (disableS3Credentials.toLowerCase() === 'true')) {
    return res.boom.serverUnavailable('S3 Credentials Endpoint has been disabled');
  }
  return undefined;
}

function configuredForACLCredentials() {
  if (process.env.CMR_ACL_BASED_CREDENTIALS && process.env.CMR_ACL_BASED_CREDENTIALS.toLowerCase() === 'true') {
    return true;
  }
  return false;
}

/**
 * Parses a "bucket/key/path" to return an array of ["bucket", "key/path"] where
 * keypath is "/" if not specified.
 *
 * @param {string} bucketKeyPath
 * @returns {Array<string>} Array [bucket, keypath]
 */
function parseBucketKey(bucketKeyPath) {
  try {
    const parts = bucketKeyPath.split('/');
    const bucket = parts.shift();
    const keypath = parts.join('/');
    return [bucket, `/${keypath}`];
  } catch (error) {
    return [undefined, undefined];
  }
}

/**
 * For a given EDL user and provider, request and format the list of allowed
 * s3bucket/keys into a object ready to pass to the NGAP session policy helper
 * lambda.  The desired payload is an object with 3 keys, 'accessmode', 'bucketlist' and
 * 'pathlist'. 'bucketlist' and 'pathlist' are arrays of matching bucket and paths.
 *
 * Example:
 * if the users rawAllowedBucketKeyList is:
 * [ 'bucket1/somepath', 'bucket2']
 * then the desired output would be the strigified object:
 *
 *  {
 *   accessmode: 'Allow',
 *   bucketlist: ['bucket1','bucket2'],
 *   pathlist: ['/somepath', '/']
 *  }
 *
 * @param {string} edlUser - earthdata login user name
 * @param {string} cmrProvider - CMR provider
 * @returns {string} - stringified payload for policy helper function.
 */
async function allowedBucketKeys(edlUser, cmrProvider) {
  const rawAllowedBucketKeyList = await getUserAccessableBuckets(edlUser, cmrProvider);
  const bucketKeyPairList = rawAllowedBucketKeyList.map(parseBucketKey);
  const bucketlist = [];
  const pathlist = [];

  bucketKeyPairList.forEach((bucketKeyPair) => {
    bucketlist.push(bucketKeyPair[0]);
    pathlist.push(bucketKeyPair[1]);
  });

  return JSON.stringify({
    accessmode: 'Allow',
    bucketlist,
    pathlist,
  });
}

/**
 *  Retrieve the sts session policy for a user when s3 credentials endpoint is
 *  configured to use CMR ACLs. If the endpoint is not configured for CMR ACLs,
 *  return undefined.
 *
 * @param {string} edlUser - earthdatalogin username
 * @param {string} cmrProvider - Cumulus' CMR provider.
 * @param {Object} lambda - aws lambda service.
 * @returns {Object} session policy generated from user's CMR ACLs or undefined.
 */
async function fetchPolicyForUser(edlUser, cmrProvider, lambda) {
  if (!configuredForACLCredentials()) return undefined;

  // fetch allowed bucket keys from CMR
  const Payload = await allowedBucketKeys(edlUser, cmrProvider);

  return lambda.invoke({
    FunctionName: process.env.STS_POLICY_HELPER_LAMBDA,
    Payload,
  }).promise()
    .then((lambdaReturn) => JSON.parse(lambdaReturn.Payload));
}

/**
 * Dispenses time-based temporary credentials for same-region direct s3 access.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} the express response object with object containing
 *                   tempoary s3 credentials for direct same-region s3 access.
 */
async function s3credentials(req, res) {
  ensureEndpointEnabled(res);

  const roleSessionName = buildRoleSessionName(
    req.authorizedMetadata.userName,
    req.authorizedMetadata.clientName
  );

  const policy = await fetchPolicyForUser(
    req.authorizedMetadata.userName,
    process.env.cmr_provider,
    req.lambda
  );

  const credentials = await requestTemporaryCredentialsFromNgap({
    lambda: req.lambda,
    lambdaFunctionName: process.env.STS_CREDENTIALS_LAMBDA,
    userId: req.authorizedMetadata.userName,
    roleSessionName,
    policy,
  });

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
  return {
    accessTokenModel: new AccessToken(),
    authClient: buildEarthdataLoginClient(),
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Client: awsServices.s3(),
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
    distributionUrl,
  } = getConfigurations();

  const { code, state } = req.query;

  const getAccessTokenResponse = await authClient.getAccessToken(code);
  // expirationTime is in seconds whereas Date is expecting milliseconds
  const expirationTime = getAccessTokenResponse.expirationTime * 1000;

  await accessTokenModel.create({
    accessToken: getAccessTokenResponse.accessToken,
    expirationTime: getAccessTokenResponse.expirationTime,
    refreshToken: getAccessTokenResponse.refreshToken,
    username: getAccessTokenResponse.username,
  });

  return res
    .cookie(
      'accessToken',
      getAccessTokenResponse.accessToken,
      {
        expires: new Date(expirationTime),
        httpOnly: true,
        secure: useSecureCookies(),
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
  req.lambda = awsServices.lambda();
  return s3credentials(req, res);
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

const isTokenAuthRequest = (req) =>
  req.get('EDL-Client-Id') && req.get('EDL-Token');

const handleTokenAuthRequest = async (req, res, next) => {
  try {
    const userName = await req.earthdataLoginClient.getTokenUsername({
      onBehalfOf: req.get('EDL-Client-Id'),
      token: req.get('EDL-Token'),
      xRequestId: req.get('X-Request-Id'),
    });

    req.authorizedMetadata = { userName };

    const clientName = req.get('EDL-Client-Name');
    if (isValidRoleSessionNameString(clientName)) {
      req.authorizedMetadata.clientName = clientName;
    } else {
      return res.boom.badRequest('EDL-Client-Name is invalid');
    }

    return next();
  } catch (error) {
    if (error instanceof EarthdataLoginError) {
      res.boom.forbidden('EDL-Token authentication failed');
    }

    throw error;
  }
};

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
    req.authorizedMetadata = { userName: 'fake-auth-username' };
    return next();
  }

  // Public data doesn't need authentication
  if (isPublicRequest(req.path)) {
    req.authorizedMetadata = { userName: 'unauthenticated user' };
    return next();
  }

  req.earthdataLoginClient = buildEarthdataLoginClient();

  if (isTokenAuthRequest(req)) {
    return handleTokenAuthRequest(req, res, next);
  }

  const {
    accessTokenModel,
    authClient,
  } = getConfigurations();

  const redirectURLForAuthorizationCode = authClient.getAuthorizationUrl(req.path);
  const accessToken = req.cookies.accessToken;
  if (!accessToken) return res.redirect(307, redirectURLForAuthorizationCode);

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.redirect(307, redirectURLForAuthorizationCode);
    }
    throw error;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return res.redirect(307, redirectURLForAuthorizationCode);
  }

  req.authorizedMetadata = { userName: accessTokenRecord.username };
  return next();
}

distributionRouter.get('/redirect', handleRedirectRequest);
distributionRouter.get('/s3credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);
distributionRouter.get('/s3credentialsREADME', displayS3CredentialInstructions);

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

const handler = async (event, context) =>
  awsServerlessExpress.proxy(
    awsServerlessExpress.createServer(distributionApp),
    event,
    context,
    'PROMISE'
  ).promise;

module.exports = {
  buildRoleSessionName,
  distributionApp,
  handler,
  handleTokenAuthRequest,
  requestTemporaryCredentialsFromNgap,
  s3credentials,
};
