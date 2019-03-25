'use strict';

const keyBy = require('lodash.keyby');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const {
  granulesToCmrFileObjects,
  metadataObjectFromCMRFile,
  publish2CMR
} = require('@cumulus/cmrjs');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const { loadJSONTestData } = require('@cumulus/test-data');

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
 * @param {string} event.config.process - the process the granules went through
 * @param {string} event.config.stack - the deployment stack name
 * @param {Object} event.input.granules - Object of all granules where granuleID
 *    is the key
 * @returns {Promise<Object>} the promise of an updated event object
 */
async function postToCMR(event) {
  // get cmr files and metadata
  const cmrFiles = granulesToCmrFileObjects(event.input.granules);
  log.debug(`Found ${cmrFiles.length} CMR files.`);
  const updatedCMRFiles = await addMetadataObjects(cmrFiles);

  log.info(`Publishing ${updatedCMRFiles.length} CMR files.`);
  // post all meta files to CMR
  const results = await Promise.all(
    updatedCMRFiles.map(
      (cmrFile) =>
        publish2CMR(cmrFile, event.config.cmr, event.config.bucket, event.config.stack)
    )
  );

  return {
    process: event.config.process,
    granules: buildOutput(
      results,
      event.input.granules
    )
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
  const startTime = Date.now();

  cumulusMessageAdapter.runCumulusTask(postToCMR, event, context, (err, data) => {
    if (err) {
      callback(err);
    }
    else {
      const additionalMetaFields = {
        post_to_cmr_duration: Date.now() - startTime,
        post_to_cmr_start_time: startTime
      };
      const meta = Object.assign({}, data.meta, additionalMetaFields);
      callback(null, Object.assign({}, data, { meta }));
    }
  });
}

exports.handler = handler;

// use node index.js local to invoke this
justLocalRun(async () => {
  const payload = await loadJSONTestData('cumulus_messages/post-to-cmr.json');
  handler(payload, {}, (e, r) => log.info(e, r));
});
