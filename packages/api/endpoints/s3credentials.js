'use strict';
const awsServices = require('@cumulus/aws-client/services');
const log = new Logger({ sender: 's3credentials' });

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
  handleCredentialRequest
};