/* eslint-disable no-param-reassign */

'use strict';

const get = require('lodash.get');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { CMR } = require('@cumulus/cmrjs');
const log = require('@cumulus/common/log');

/**
 * function for posting cmr xml files from S3 to CMR
 *
 * @param {Object} cmrFile - an object representing the cmr file
 * @param {string} cmrFile.granuleId - the granuleId of the cmr xml File
 * @param {string} cmrFile.filename - the s3 uri to the cmr xml file
 * @param {Object} creds - credentials needed to post to the CMR
 * @param {string} creds.provider - the name of the Provider used on the CMR side
 * @param {string} creds.clientId - the clientId used to generate CMR token
 * @param {string} creds.username - the CMR username
 * @param {string} creds.password - the encrypted CMR password
 * @param {string} bucket - the bucket name where public/private keys are stored
 * @param {string} stack - the deployment stack name
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publish(cmrFile, creds, bucket, stack) {
  let password;
  try {
    password = await DefaultProvider.decrypt(creds.password, undefined, bucket, stack);
  }
  catch (e) {
    log.error('Decrypting password failed, using unencrypted password');
    password = creds.password;
  }
  const cmr = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );

  const xml = cmrFile.metadata;
  const res = await cmr.ingestGranule(xml);
  const conceptId = res.result['concept-id'];

  log.info(`Published ${cmrFile.granuleId} to the CMR. conceptId: ${conceptId}`);

  return {
    granuleId: cmrFile.granuleId,
    filename: cmrFile.filename,
    conceptId,
    link: 'https://cmr.uat.earthdata.nasa.gov/search/granules.json' +
          `?concept_id=${res.result['concept-id']}`
  };
}

/**
 * Builds the output of the post-to-cmr task
 *
 * @param {Array} results - list of results returned by publish function
 * @param {Object} granulesObject - an object of the granules where the key is the granuleId
 * @returns {Array} an updated array of granules
 */
function buildOutput(results, granulesObject) {
  // add results to corresponding granules
  results.forEach((r) => {
    if (granulesObject[r.granuleId]) {
      granulesObject[r.granuleId].cmrLink = r.link;
      granulesObject[r.granuleId].published = true;
    }
  });

  return Object.keys(granulesObject).map((k) => granulesObject[k]);
}

/**
 * Post to CMR
 * See the schemas directory for detailed input and output schemas
 *
 * @param {Object} event -Lambda function payload
 * @param {Object} event.config - the config object
 * @param {string} event.config.bucket - the bucket name where public/private keys
 *                                       are stored
 * @param {string} event.config.stack - the deployment stack name
 * @param {Object} event.config.allGranules - Object of all granules where granuleID is the key
 * @param {Array} event.config.cmrFiles - list of CMR files from input
 * @param {Object} event.config.cmr - the cmr object containing user/pass and provider
 * @returns {Promise} returns the promise of an updated event object
 */
async function postToCMR(event) {
  // we have to post the meta-xml file of all output granules
  // first we check if there is an output file
  const config = get(event, 'config');
  const bucket = get(config, 'bucket'); // the name of the bucket with private/public keys
  const stack = get(config, 'stack'); // the name of the deployment stack
  const input = get(event, 'input', []);
  const allGranules = get(input, 'allGranules'); // Object of all Granules
  const cmrFiles = get(input, 'cmrFiles'); // list of CMR files from input
  const creds = get(config, 'cmr');

  // post all meta files to CMR
  const publishRquests = cmrFiles.map((cmrFile) => publish(cmrFile, creds, bucket, stack));
  const results = await Promise.all(publishRquests);

  return {
    granules: buildOutput(results, allGranules)
  };
}

exports.postToCMR = postToCMR;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(postToCMR, event, context, callback);
}

exports.handler = handler;

// use node index.js local to invoke this
justLocalRun(() => {
  const payload = require('@cumulus/test-data/cumulus_messages/post-to-cmr.json'); // eslint-disable-line global-require, max-len
  handler(payload, {}, (e, r) => log.info(e, r));
});
