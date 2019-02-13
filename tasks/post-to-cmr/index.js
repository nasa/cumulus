'use strict';

const flatten = require('lodash.flatten');
const keyBy = require('lodash.keyby');
const cloneDeep = require('lodash.clonedeep');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const {
  getCmrFiles,
  metadataObjectFromCMRFile,
  publish2CMR
} = require('@cumulus/cmrjs');
const { buildS3Uri } = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const { loadJSONTestData } = require('@cumulus/test-data');

/**
 * Builds the output of the post-to-cmr task
 *
 * @param {Array} results - list of results returned by publish function
 * @param {Object} granulesObject - an object of the granules where the key is the granuleId
 * @returns {Array} an updated array of granules
 */
function buildOutput(results, granulesObject) {
  const output = cloneDeep(granulesObject);

  // add results to corresponding granules
  results.forEach((result) => {
    if (output[result.granuleId]) {
      output[result.granuleId].cmrLink = result.link;
      output[result.granuleId].published = true;
    }
  });

  return Object.values(output);
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

const getS3URLOfFile = (file) => {
  if (file.bucket && file.key) return buildS3Uri(file.bucket, file.key);
  if (file.bucket && file.filepath) return buildS3Uri(file.bucket, file.filepath);
  if (file.filename) return file.filename;

  throw new Error(`Unable to determine S3 URL for file: ${JSON.stringify(file)}`);
};

/**
 * Post to CMR
 * See the schemas directory for detailed input and output schemas
 *
 * @param {Object} event -Lambda function payload
 * @param {Object} event.config - the config object
 * @param {string} event.config.bucket - the bucket name where public/private keys
 *                                       are stored
 * @param {string} event.config.stack - the deployment stack name
 * @param {Object} event.input.granules - Object of all granules where granuleID is the key
 * @param {Object} event.config.cmr - the cmr object containing user/pass and provider
 * @returns {Promise} returns the promise of an updated event object
 */
async function postToCMR(event) {
  // We have to post the metadata file for the output granules.
  // First we check if there is an output file.

  const fileURLs = flatten(event.input.granules.map((g) => g.files))
    .map(getS3URLOfFile);

  const granuleIdExtractionRegex = event.config.granuleIdExtraction || '(.*)';

  // get cmr files and metadata
  const cmrFiles = getCmrFiles(fileURLs, granuleIdExtractionRegex);
  const updatedCMRFiles = await addMetadataObjects(cmrFiles);

  // post all meta files to CMR
  const results = await Promise.all(
    updatedCMRFiles.map(
      (cmrFile) =>
        publish2CMR(cmrFile, event.config.cmr, event.config.bucket, event.config.stack)
    )
  );

  const granulesByGranuleId = keyBy(event.input.granules, (g) => g.granuleId);

  return {
    process: event.config.process,
    granules: buildOutput(results, granulesByGranuleId)
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
