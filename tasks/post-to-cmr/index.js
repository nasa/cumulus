'use strict';

const keyBy = require('lodash.keyby');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const {
  granulesToCmrFileObjects,
  metadataObjectFromCMRFile,
  publish2CMR
} = require('@cumulus/cmrjs');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const { CMRMetaFileNotFound } = require('@cumulus/errors');
const launchpad = require('@cumulus/common/launchpad');

/**
 * Builds the output of the post-to-cmr task
 *
 * @param {Array<Object>} results - list of results returned by publish function
 * @param {Array<Object>} granules - list of granules
 *
 * @returns {Array<Object>} an updated array of granules
 */
function buildOutput(results, granules) {
  const resultsByGranuleId = keyBy(results, 'granuleId');

  return granules.map((granule) => {
    const result = resultsByGranuleId[granule.granuleId];

    if (!result) return granule;

    return removeNilProperties({
      ...granule,
      cmrLink: result.link,
      cmrConceptId: result.conceptId,
      published: true,
      cmrMetadataFormat: result.metadataFormat
    });
  });
}

/**
 * Append metadata object to each cmrFile object
 * @param {Array<Object>} cmrFiles - CMR Objects with filenames and granuleIds.
 * @returns {Array<Object>} clone of input array with object updated with it's metadata.
 */
async function addMetadataObjects(cmrFiles) {
  const updatedCMRFiles = [];
  const objectPromises = cmrFiles.map(async (cmrFile) => {
    const metadataObject = await metadataObjectFromCMRFile(cmrFile.filename);
    const updatedFile = { ...cmrFile, metadataObject };
    updatedCMRFiles.push(updatedFile);
  });
  await Promise.all(objectPromises);
  return updatedCMRFiles;
}

/**
 * Check that each granule to upload contains a CMR Metadata file
 *
 * @param {Array} granules - Granules object from input.
 * @param {Array} cmrFiles - CMR Objects with filenames and granuleIds.
 *
 * @throws {Error} - Error indicating a missing metadata file.
 */
function checkForMetadata(granules, cmrFiles) {
  if (cmrFiles.length === 0) {
    throw new CMRMetaFileNotFound('No CMR Meta file found.');
  }
  const granuleIds = cmrFiles.map((g) => g.granuleId);
  granules.forEach((granule) => {
    if (!granuleIds.includes(granule.granuleId)) {
      throw new CMRMetaFileNotFound(`CMR Meta file not found for granule ${granule.granuleId}`);
    }
  });
}

/**
 * Post to CMR
 *
 * See the schemas directory for detailed input and output schemas
 *
 * @param {Object} event - Lambda function payload
 * @param {Object} event.config - the config object
 * @param {string} event.config.bucket - the bucket name where public/private
 *   keys are stored
 * @param {Object} event.config.cmr - the cmr object containing user/pass and
 *   provider
 * @param {Object} event.config.launchpad - the launchpad object containing api
 *   and passphrase
 * @param {string} event.config.process - the process the granules went through
 * @param {string} event.config.stack - the deployment stack name
 * @param {boolean} event.config.skipMetaCheck - option to skip Meta file check
 * @param {Object} event.input.granules - Object of all granules where granuleID
 *    is the key
 * @returns {Promise<Object>} the promise of an updated event object
 */
async function postToCMR(event) {
  // get cmr files and metadata
  const cmrFiles = granulesToCmrFileObjects(event.input.granules);
  log.debug(`Found ${cmrFiles.length} CMR files.`);
  if (!event.config.skipMetaCheck) checkForMetadata(event.input.granules, cmrFiles);
  const updatedCMRFiles = await addMetadataObjects(cmrFiles);

  log.info(`Publishing ${updatedCMRFiles.length} CMR files.`);

  const startTime = Date.now();

  const cmrCreds = {
    provider: event.config.cmr.provider,
    clientId: event.config.cmr.clientId
  };

  if (event.config.cmr.oauthProvider === 'launchpad') {
    const passphrase = await getSecretString(
      event.config.launchpad.passphraseSecretName
    );

    const token = await launchpad.getLaunchpadToken({
      ...event.config.launchpad,
      passphrase
    });
    cmrCreds.token = token;
  } else {
    cmrCreds.username = event.config.cmr.username;
    cmrCreds.password = await getSecretString(
      event.config.cmr.passwordSecretName
    );
  }

  // post all meta files to CMR
  const results = await Promise.all(
    updatedCMRFiles.map((cmrFile) => publish2CMR(cmrFile, cmrCreds))
  );

  const endTime = Date.now();

  return {
    granules: buildOutput(
      results,
      event.input.granules
    ).map((g) => ({
      ...g,
      post_to_cmr_duration: endTime - startTime
    }))
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
