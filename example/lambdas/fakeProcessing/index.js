'use strict';
const cumulusMessageAdapter = require('../../node_modules/@cumulus/cumulus-message-adapter-js');

/**
 * Ingest a list of granules
 *
 * @param {Object} event - an ingest object
 * @returns {Array} - the list of s3 locations for granules
 */
async function fakeProcessing(event) {
  const listOfs3locations = 'A list';
  console.log(event);
  // do stuff
  return listOfs3locations;
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
