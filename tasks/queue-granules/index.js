'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const { s3 } = require('@cumulus/common/aws');

/**
 * Fetch a collection config from S3
 *
 * @param {string} stackName - the name of the stack
 * @param {string} Bucket - the name of the bucket containing the collection configs
 * @param {string} dataType - the name of the collection
 * @returns {Array} the datatype and the collection config
 */
async function fetchCollectionConfig(stackName, Bucket, dataType) {
  const Key = `${stackName}/collections/${dataType}.json`;
  const collectionConfig = (await s3().getObject({ Bucket, Key }).promise()).Body;
  return [dataType, JSON.parse(collectionConfig)];
}

/**
 * For a list of data-types, fetch the corresponding collection configs from S3
 *
 * @param {string} stackName - the name of the stack
 * @param {string} Bucket - the name of the bucket containing the collection configs
 * @param {Array<string>} dataTypes - the name of the collection
 * @returns {Promise<Object>} a map of data-type to collection config
 */
async function fetchCollectionConfigs(stackName, Bucket, dataTypes) {
  const fetchConfig = (dataType) => fetchCollectionConfig(stackName, Bucket, dataType); // eslint-disable-line require-jsdoc, max-len

  const fetchedCollectionConfigs = await Promise.all(dataTypes.map(fetchConfig));

  const collectionConfigs = {};
  fetchedCollectionConfigs.forEach(([dataType, collectionConfig]) => {
    collectionConfigs[dataType] = collectionConfig;
  });

  return collectionConfigs;
}

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queueGranules(event) {
  const granules = event.input.granules || [];

  const dataTypes = granules.map((granule) => granule.dataType);
  const collectionConfigs = await fetchCollectionConfigs(
    event.config.stackName,
    event.config.internalBucket,
    dataTypes
  );

  await Promise.all( // eslint-disable-line function-paren-newline
    granules.map((granule) => enqueueGranuleIngestMessage(
      granule,
      event.config.queueUrl,
      event.config.granuleIngestMessageTemplateUri,
      event.config.provider,
      collectionConfigs[granule.dataType],
      event.input.pdr
    )));

  return { granules_queued: granules.length };
}
exports.queueGranules = queueGranules;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(queueGranules, event, context, callback);
}
exports.handler = handler;
