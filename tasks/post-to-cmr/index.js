'use strict';

const keyBy = require('lodash/keyBy');
const pMap = require('p-map');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const {
  addEtagsToFileObjects,
  granulesToCmrFileObjects,
  metadataObjectFromCMRFile,
  publish2CMR,
  removeFromCMR,
  removeEtagsFromFileObjects,
} = require('@cumulus/cmrjs');
const { getCmrSettings, getS3UrlOfFile } = require('@cumulus/cmrjs/cmr-utils');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const { CMRMetaFileNotFound } = require('@cumulus/errors');

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
      cmrMetadataFormat: result.metadataFormat,
    });
  });
}

/**
 * Appends metadata object to each CMR file object.
 *
 * @param {Array<Object>} cmrFiles - array of CMR file objects, each with a
 *    `filename`,`granuleId`, and optionally an `etag` (for specifying an exact
 *    CMR file version)
 * @param {s3Concurrency} number - number of s3 requests to process at a time
 * @returns {Promise<Array<Object>>} clone of input array with each object
 *    updated with its metadata as a `metadataObject` property
 */
async function addMetadataObjects(cmrFiles, s3Concurrency) {
  return await pMap(
    cmrFiles,
    async (cmrFile) => {
      const metadataObject = await metadataObjectFromCMRFile(
        getS3UrlOfFile(cmrFile),
        cmrFile.etag
      );

      return {
        ...cmrFile,
        metadataObject,
      };
    },
    { concurrency: s3Concurrency }
  );
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
 * Remove granules from CMR
 *
 * @param {object} params - parameter object
 * @param {Array<object>} params.granules - granules to remove
 * @param {object} params.cmrSettings - CMR credentials
 * @param {number} params.concurrency - Maximum concurrency of requests to CMR
 * @throws {Error} - Error from CMR request
 */
async function removeGranuleFromCmr({ granules, cmrSettings, concurrency }) {
  const granulesToUnpublish = granules.filter((granule) => granule.published || !!granule.cmrLink);
  // await pMap(
  //   granulesToUnpublish,
  //   (granule) => removeFromCMR(granule.granuleId, cmrSettings),
  //   { concurrency }
  // );

  if (granulesToUnpublish.length > 0) {
    log.info(`Removing ${granulesToUnpublish.length} out of ${granules.length} granules from CMR for republishing`);
  }
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
 * @param {string} event.input.cmrRevisionId - CMR Revision ID
 * @returns {Promise<Object>} the promise of an updated event object
 */
async function postToCMR(event) {
  const { cmrRevisionId, granules } = event.input;
  const { etags = {}, republish = false, concurrency = 20, s3Concurrency = 50 } = event.config;

  const cmrSettings = await getCmrSettings({
    ...event.config.cmr,
    ...event.config.launchpad,
  });

  // if republish is true, unpublish granules which are public
  if (republish) {
    await removeGranuleFromCmr({ granules, cmrSettings, concurrency });
  }

  granules.forEach((granule) => addEtagsToFileObjects(granule, etags));

  // get cmr files and metadata
  const cmrFiles = granulesToCmrFileObjects(granules);
  log.debug(`Found ${cmrFiles.length} CMR files.`);
  if (!event.config.skipMetaCheck) checkForMetadata(granules, cmrFiles);
  const updatedCMRFiles = await addMetadataObjects(cmrFiles, s3Concurrency);

  log.info(`Publishing ${updatedCMRFiles.length} CMR files.`);

  const startTime = Date.now();

  // post all meta files to CMR
  const results = await pMap(
    updatedCMRFiles,
    (cmrFile) => publish2CMR(cmrFile, cmrSettings, cmrRevisionId),
    { concurrency }
  );
  const endTime = Date.now();
  const outputGranules = buildOutput(
    results,
    granules
  ).map((granule) => ({
    ...granule,
    post_to_cmr_duration: endTime - startTime,
  }));
  outputGranules.forEach(removeEtagsFromFileObjects);
  return {
    granules: outputGranules,
  };
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(postToCMR, event, context);
}

exports.handler = handler;
exports.postToCMR = postToCMR;
