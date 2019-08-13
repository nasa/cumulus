'use strict';

const path = require('path');
const { getS3Object, s3ObjectExists, s3PutObject } = require('./aws');
const LaunchpadToken = require('./LaunchpadToken');
const log = require('./log');

/**
 * get s3 location of the Launchpad token
 *
 * @returns {Promise.<Object.<string, string>>} - s3 Bucket and Key where Launchpad token is stored
 */
function launchpadTokenBucketKey() {
  if (!(process.env.stackName && process.env.system_bucket)) {
    throw new Error('must set environment variables process.env.stackName and process.env.system_bucket');
  }

  return {
    Bucket: process.env.system_bucket,
    Key: path.join(process.env.stackName, 'launchpad/token.json')
  };
}

/**
 * retrieve Launchpad token from s3
 *
 * @returns {Promise.<string>} - the Launchpad token, null if token doesn't exist or invalid
 */
async function getValidLaunchpadTokenFromS3() {
  const s3location = launchpadTokenBucketKey();
  const keyExists = await s3ObjectExists(s3location);

  let token = null;
  if (keyExists) {
    const s3object = await getS3Object(s3location.Bucket, s3location.Key);
    const launchpadToken = JSON.parse(s3object.Body.toString());

    // check if token is still valid
    if (Date.now() / 1000 < launchpadToken.session_maxtimeout + launchpadToken.session_starttime) {
      token = launchpadToken.sm_token;
    }
  }

  return token;
}

/**
 * get Launchpad token
 *
 * @param {Object} params - the configuration parameters for creating LaunchpadToken object
 * @param {string} params.api - the Launchpad token service api endpoint
 * @param {string} params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param {string} params.certificate - the name of the Launchpad PKI pfx certificate
 *
 * @returns {Promise.<string>} - the Launchpad token
 */
async function getLaunchpadToken(params) {
  let token = await getValidLaunchpadTokenFromS3();

  if (!token) {
    log.debug('getLaunchpadToken requesting launchpad token');
    const launchpad = new LaunchpadToken(params);
    const tokenObject = await launchpad.requestToken();

    // add session_starttime to token object, assume token is generated 60s ago
    tokenObject.session_starttime = (Date.now() / 1000 - 60);
    const s3location = launchpadTokenBucketKey();
    await s3PutObject({
      Bucket: s3location.Bucket,
      Key: s3location.Key,
      Body: JSON.stringify(tokenObject)
    });

    token = tokenObject.sm_token;
  }

  return token;
}

module.exports.getLaunchpadToken = getLaunchpadToken;
module.exports.launchpadTokenBucketKey = launchpadTokenBucketKey;
