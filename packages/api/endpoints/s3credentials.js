'use strict';

const router = require('express-promise-router')();

const { lambda } = require('@cumulus/common/aws');

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
  const FunctionName = process.env.STSCredentialsLambda || 'gsfc-ngap-sh-s3-sts-get-keys';
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600', // one hour max allowed by AWS.
    rolesession: username, // <- shows up in access logs
    userid: username // <- used by NGAP
  });

  return lambda().invoke({
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
  return res.send(JSON.parse(credentials.Payload));
}

router.get('/', s3credentials);

module.exports = router;
