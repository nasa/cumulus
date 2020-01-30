'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash.get');
const path = require('path');
const S3 = require('@cumulus/aws-client/S3');
const { buildProviderClient, fetchTextFile } = require('@cumulus/ingest/providerClientUtils');
const { CollectionConfigStore } = require('@cumulus/common');
const { granuleFromFileGroup } = require('@cumulus/ingest/parse-pdr');
const { pvlToJS } = require('@cumulus/pvl/t');

const buildPdrDocument = (rawPdr) => {
  if (rawPdr.trim().length === 0) throw new Error('PDR file had no contents');

  const cleanedPdr = rawPdr
    .replace(/((\w*)=(\w*))/g, '$2 = $3')
    .replace(/"/g, '');

  return pvlToJS(cleanedPdr);
};

/**
* Parse a PDR
* See schemas/input.json for detailed input schema
*
* @param {Object} event - Lambda event object
* @param {Object} event.config - configuration object for the task
* @param {string} event.config.stack - the name of the deployment stack
* @param {string} event.config.pdrFolder - folder for the PDRs
* @param {Object} event.config.provider - provider information
* @param {Object} event.config.bucket - the internal S3 bucket
* @returns {Promise<Object>} - see schemas/output.json for detailed output schema
* that is passed to the next task in the workflow
**/
const parsePdr = async ({ config, input }) => {
  const providerClient = buildProviderClient(config.provider);

  const rawPdr = await fetchTextFile(
    providerClient,
    path.join(input.pdr.path, input.pdr.name)
  );

  const pdrDocument = buildPdrDocument(rawPdr);

  const collectionConfigStore = new CollectionConfigStore(config.bucket, config.stack);

  const allPdrGranules = await Promise.all(
    pdrDocument.objects('FILE_GROUP').map((fileGroup) =>
      granuleFromFileGroup(fileGroup, input.pdr.name, collectionConfigStore))
  );

  await S3.s3PutObject({
    Bucket: config.bucket,
    Key: path.join(config.stack, 'pdrs', input.pdr.name),
    Body: rawPdr
  });

  // Filter based on the granuleIdFilter, default to match all granules
  const granuleIdFilter = get(config, 'granuleIdFilter', '.');
  const granules = allPdrGranules.filter((g) => g.files[0].name.match(granuleIdFilter));

  return {
    ...input,
    granules,
    granulesCount: granules.length,
    filesCount: granules.reduce((sum, { files }) => sum + files.length, 0),
    totalSize: granules.reduce((sum, { granuleSize }) => sum + granuleSize, 0)
  };
};

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(parsePdr, event, context, callback);
}

module.exports = { handler, parsePdr };
