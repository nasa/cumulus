'use strict';

const awsServices = require('@cumulus/aws-client/services');
const { getUserAccessibleBuckets } = require('@cumulus/cmrjs');
const Logger = require('@cumulus/logger');
const log = new Logger({ sender: 's3credentials' });

const buildRoleSessionName = (username, clientName) => {
  if (clientName) {
    return `${username}@${clientName}`;
  }

  return username;
};

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

  return await lambda.invoke({
    FunctionName: lambdaFunctionName,
    Payload,
  });
}

/**
 * If DISABLE_S3_CREDENTIALS is not "true", returns undefined, otherwise, send a
 * boom.ServerUnavailable to the caller, Exiting the request.
 *
 * @param {Object} res - express request object
 * @returns {undefined} - when DISABLE_S3_CREDENTIALS is not 'true'
 */
function ensureEndpointEnabled(res) {
  const disableS3Credentials = process.env.DISABLE_S3_CREDENTIALS;

  if (disableS3Credentials && (disableS3Credentials.toLowerCase() === 'true')) {
    return res.boom.serverUnavailable('S3 Credentials Endpoint has been disabled');
  }
  return undefined;
}

/**
 * @returns {bool} whether or not the endpoint is configured to send ACL based
 * credentials.
 */
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
    return { bucket, keypath: `/${keypath}` };
  } catch (error) {
    return {};
  }
}

/**
 * Reformats a list of buckets and bucket/keyspaths into the shape needed for
 * calling the sts policy helper function. The desired payload is an object
 * with 3 keys, 'accessmode', 'bucketlist' and 'pathlist'. 'bucketlist' and
 * 'pathlist' are arrays of matching bucket and paths.
 *
 * Example:
 * if the cmrAllowedBucketKeyList is:
 * [ 'bucket1/somepath', 'bucket2']
 * then the desired output would be the stringified object:
 *
 *  {
 *   accessmode: 'Allow',
 *   bucketlist: ['bucket1','bucket2'],
 *   pathlist: ['/somepath', '/']
 *  }
 *
 * @param {Array<string>} cmrAllowedBucketKeyList - earthdata login user name
 * @returns {string} - stringified payload for policy helper function.
 */
function formatAllowedBucketKeys(cmrAllowedBucketKeyList) {
  const bucketKeyPairList = cmrAllowedBucketKeyList.map(parseBucketKey);
  const bucketlist = [];
  const pathlist = [];

  bucketKeyPairList.forEach((bucketKeyPair) => {
    bucketlist.push(bucketKeyPair.bucket);
    pathlist.push(bucketKeyPair.keypath);
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
  const cmrAllowedBucketKeyList = await getUserAccessibleBuckets(edlUser, cmrProvider);
  const Payload = formatAllowedBucketKeys(cmrAllowedBucketKeyList);

  return lambda.invoke({
    FunctionName: process.env.STS_POLICY_HELPER_LAMBDA,
    Payload,
  }).then((lambdaReturn) => JSON.parse(new TextDecoder('utf-8').decode(lambdaReturn.Payload)));
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

  let policy;
  if (process.env.OAUTH_PROVIDER === 'earthdata') {
    policy = await fetchPolicyForUser(
      req.authorizedMetadata.userName,
      process.env.cmr_provider,
      req.lambda
    );
  }

  const credentials = await requestTemporaryCredentialsFromNgap({
    lambda: req.lambda,
    lambdaFunctionName: process.env.STS_CREDENTIALS_LAMBDA,
    userId: req.authorizedMetadata.userName,
    roleSessionName,
    policy,
  });

  const decodedOuputPayload = new TextDecoder('utf-8').decode(credentials.Payload);
  const creds = JSON.parse(decodedOuputPayload);
  if (Object.keys(creds).some((key) => ['errorMessage', 'errorType', 'stackTrace'].includes(key))) {
    log.error(decodedOuputPayload);
    return res.boom.failedDependency(
      `Unable to retrieve credentials from Server: ${decodedOuputPayload}`
    );
  }
  return res.send(creds);
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
  return await s3credentials(req, res);
}

module.exports = {
  handleCredentialRequest,
  s3credentials,
  buildRoleSessionName,
  requestTemporaryCredentialsFromNgap,
  getUserAccessibleBuckets,
};
