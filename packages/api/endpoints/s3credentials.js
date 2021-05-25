'use strict';

const awsServices = require('@cumulus/aws-client/services');
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
  roleSessionName,
}) {
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600', // one hour max allowed by AWS.
    rolesession: roleSessionName, // <- shows up in S3 server access logs
    userid: userId, // <- used by NGAP
  });

  return lambda.invoke({
    FunctionName: lambdaFunctionName,
    Payload,
  }).promise();
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
  const disableS3Credentials = process.env.DISABLE_S3_CREDENTIALS;
  if (disableS3Credentials && (disableS3Credentials.toLowerCase() === 'true')) {
    return res.boom.serverUnavailable('S3 Credentials Endpoint has been disabled');
  }
  const roleSessionName = buildRoleSessionName(
    req.authorizedMetadata.userName,
    req.authorizedMetadata.clientName
  );
  const credentials = await requestTemporaryCredentialsFromNgap({
    lambda: req.lambda,
    lambdaFunctionName: process.env.STSCredentialsLambda,
    userId: req.authorizedMetadata.userName,
    roleSessionName,
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

module.exports = {
  handleCredentialRequest,
  s3credentials,
  buildRoleSessionName,
  requestTemporaryCredentialsFromNgap,
};
