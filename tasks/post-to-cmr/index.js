'use strict';

const keyBy = require('lodash.keyby');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const {
  granulesToCmrFileObjects,
  metadataObjectFromCMRFile,
  publish2CMR
} = require('@cumulus/cmrjs');
const { CMR } = require('@cumulus/cmr-client');
const log = require('@cumulus/common/log');
const { getSecretString } = require('@cumulus/common/aws');
const { removeNilProperties } = require('@cumulus/common/util');
const { CMRMetaFileNotFound } = require('@cumulus/common/errors');
const launchpad = require('@cumulus/common/launchpad');

const buildCmrClient = async (config) => {
  const params = {
    provider: config.cmr.provider,
    clientId: config.cmr.clientId
  };

  if (config.cmr.oauthProvider === 'launchpad') {
    const passphrase = await getSecretString({
      SecretId: config.launchpad.passphraseSecretName
    });

    params.token = await launchpad.getLaunchpadToken({
      api: config.launchpad.api,
      passphrase,
      certificate: config.launchpad.certificate
    });
  } else {
    params.username = config.cmr.username;
    params.password = await getSecretString({
      SecretId: config.cmr.passwordSecretName
    });
  }

  return new CMR(params);
};

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
    const updatedFile = Object.assign({}, { ...cmrFile }, { metadataObject: metadataObject });
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

  const cmrClient = await buildCmrClient(event.config);

  // post all meta files to CMR
  const startTime = Date.now();
  const results = await Promise.all(
    updatedCMRFiles.map((cmrFile) => publish2CMR(cmrFile, cmrClient))
  );
  // eslint-disable-next-line camelcase
  const post_to_cmr_duration = Date.now() - startTime;

  return {
    process: event.config.process,
    granules: buildOutput(
      results,
      event.input.granules
    ).map((g) => ({ ...g, post_to_cmr_duration }))
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
