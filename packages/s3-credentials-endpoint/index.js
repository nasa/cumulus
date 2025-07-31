'use strict';

const awsServerlessExpress = require('aws-serverless-express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const distributionRouter = require('express-promise-router')();
const express = require('express');
const hsts = require('hsts');
const morgan = require('morgan');
const urljoin = require('url-join');

const boom = require('@cumulus/api/lib/expressBoom');
const {
  EarthdataLoginError,
} = require('@cumulus/oauth-client');
const {
  getConfigurations,
  handleAuthBearerToken,
  isAuthBearTokenRequest,
  useSecureCookies,
} = require('@cumulus/api/lib/distribution');
const { isAccessTokenExpired } = require('@cumulus/api/lib/token');
const { handleCredentialRequest } = require('@cumulus/api/endpoints/s3credentials');
const { RecordDoesNotExist } = require('@cumulus/errors');
const displayS3CredentialInstructions = require('@cumulus/api/endpoints/s3credentials-readme');

// From https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html#API_AssumeRole_RequestParameters
const roleSessionNameRegex = /^[\w+,.=@-]{2,64}$/;

const isValidRoleSessionNameString = (x) => roleSessionNameRegex.test(x);

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
 * Responds to a redirect request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleRedirectRequest(req, res) {
  const {
    accessTokenModel,
    oauthClient,
    distributionUrl,
  } = await getConfigurations();

  const { code, state } = req.query;

  const getAccessTokenResponse = await oauthClient.getAccessToken(code);
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
        sameSite: 'Strict',
      }
    )
    .set({ Location: urljoin(distributionUrl, state) })
    .status(307)
    .send('Redirecting');
}

const isTokenAuthRequest = (req) =>
  req.get('EDL-Client-Id') && req.get('EDL-Token');

const handleTokenAuthRequest = async (req, res, next) => {
  try {
    const userName = await req.oauthClient.getTokenUsername({
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

  const {
    accessTokenModel,
    oauthClient,
  } = await getConfigurations();

  req.oauthClient = oauthClient;

  if (isTokenAuthRequest(req)) {
    return handleTokenAuthRequest(req, res, next);
  }

  if (isAuthBearTokenRequest(req)) {
    return handleAuthBearerToken(req, res, next);
  }

  const redirectURLForAuthorizationCode = oauthClient.getAuthorizationUrl(req.path);
  const accessToken = req.cookies.accessToken;
  let accessTokenRecord;
  if (accessToken) {
    try {
      accessTokenRecord = await accessTokenModel.get({ accessToken });
    } catch (error) {
      if (!(error instanceof RecordDoesNotExist)) {
        throw error;
      }
    }
  }

  if (!accessToken || !accessTokenRecord || isAccessTokenExpired(accessTokenRecord)) {
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

const server = awsServerlessExpress.createServer(distributionApp);
const handler = async (event, context) =>
  await awsServerlessExpress.proxy(
    server,
    event,
    context,
    'PROMISE'
  ).promise;

module.exports = {
  distributionApp,
  handler,
  handleTokenAuthRequest,
};
