'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { generateCmrFilesForGranules } = require('@cumulus/integration-tests');

/**
 * For each granule, create a CMR XML file and store to S3
 *
 * @param {Object} event - an ingest object
 * @returns {Array<string>} - the list of s3 locations for granule files
 */
async function fakeProcessing(event) {
  const collection = event.config.collection;
  if (collection.name.includes('_test')) {
    const idx = collection.name.indexOf('_test');
    collection.name = collection.name.substring(0, idx);
  }

  return generateCmrFilesForGranules(
    event.input.granules,
    collection,
    event.config.bucket,
    event.config.cmrFileType
  );
}

/**
 * Lambda handler that returns the expected input for the Post to CMR task
 *
 * @param {Object} event - a description of the ingestgranules
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(fakeProcessing, event, context, callback);
}

exports.handler = handler;
