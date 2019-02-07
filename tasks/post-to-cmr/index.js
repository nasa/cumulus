'use strict';

const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const {
  getCmrFiles,
  metadataObjectFromCMRXMLFile,
  publishECHO10XML2CMR
} = require('@cumulus/cmrjs');
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
    const metadataObject = await metadataObjectFromCMRXMLFile(cmrFile.filename);
    const updatedFile = Object.assign({}, { ...cmrFile }, { metadataObject: metadataObject });
    updatedCMRFiles.push(updatedFile);
  });
  await Promise.all(objectPromises);
  return updatedCMRFiles;
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
 * @param {Object} event.input.granules - Object of all granules where granuleID is the key
 * @param {Object} event.config.cmr - the cmr object containing user/pass and provider
 * @returns {Promise} returns the promise of an updated event object
 */
async function postToCMR(event) {
  // We have to post the metadata file for the output granules.
  // First we check if there is an output file.
  const config = get(event, 'config');
  const bucket = get(config, 'bucket'); // the name of the bucket with private/public keys
  const stack = get(config, 'stack'); // the name of the deployment stack
  const input = get(event, 'input', []);
  const process = get(config, 'process');
  const regex = get(config, 'granuleIdExtraction', '(.*)');
  const granules = get(input, 'granules'); // Object of all Granules
  const creds = get(config, 'cmr');
  const allGranules = {};
  const allFiles = [];
  granules.forEach((granule) => {
    allGranules[granule.granuleId] = granule;
    granule.files.forEach((file) => {
      allFiles.push(file.filename);
    });
  });

  // get cmr files and metadata
  const cmrFiles = getCmrFiles(allFiles, regex);
  const updatedCMRFiles = await addMetadataObjects(cmrFiles);

  // post all meta files to CMR
  const publishRequests = updatedCMRFiles.map((cmrFile) => (
    publishECHO10XML2CMR(cmrFile, creds, bucket, stack)
  ));
  const results = await Promise.all(publishRequests);

  return {
    process: process,
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
