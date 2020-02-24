'use strict';

const curry = require('lodash.curry');
const groupBy = require('lodash.groupby');
const isBoolean = require('lodash.isboolean');
const Logger = require('@cumulus/logger');
const map = require('lodash.map');
const { runCumulusTask } = require('@cumulus/cumulus-message-adapter-js');
const { buildProviderClient } = require('@cumulus/ingest/providerClientUtils');

const logger = () => new Logger({
  executions: process.env.EXECUTIONS,
  granules: process.env.GRANULES,
  parentArn: process.env.PARENTARN,
  sender: process.env.SENDER,
  stackName: process.env.STACKNAME,
  version: process.env.TASKVERSION
});

/**
 * Fetch a list of files from the provider
 *
 * @param {Object} providerConfig - the connection config for the provider
 * @param {bool} useList - flag to tell ftp server to use 'LIST' instead of 'STAT'
 * @param {*} path - the provider path to search
 * @returns {Array<Object>} a list of discovered file objects
 */
const listFiles = (providerConfig, useList, path) =>
  buildProviderClient({ ...providerConfig, useList }).list(path);

/**
 * Given a regular expression and a file containing a name, extract the granule
 * id from the file's name
 *
 * @param {RegExp} granuleIdRegex - a regular expression where the first
 * matching group is the granule id
 * @param {Object} file - a file containing a `name` property
 * @returns {string|null} returns the granule id, if one could be extracted,
 * or null otherwise
 */
const granuleIdOfFile = curry(
  (granuleIdRegex, { name }) => {
    const match = name.match(granuleIdRegex);
    return match ? match[1] : null;
  }
);

/**
 * Given a regular expression and a list of files, return an Object where the
 * granule ids are the Object keys and the values are an Array of the files with
 * that granule id.
 *
 * Files where a granule id could not be determined will not be returned
 *
 * @param {RegExp} granuleIdRegex - a regular expression where the first
 * matching group is the granule id
 * @param {Array<Object>} files - a list of files containing a `name` property
 * @returns {Object<Array>} the files, grouped by granule id
 */
const groupFilesByGranuleId = (granuleIdRegex, files) => {
  const result = groupBy(files, granuleIdOfFile(granuleIdRegex));
  delete result.null;
  return result;
};

/**
 * Find the collection file config associated with the file
 *
 * @param {Array<Object>} collectionFileConfigs - a list of collection file
 * configs
 * @param {Object} file - a file
 * @returns {Object|undefined} returns the matching collection file config, or
 * `undefined` if a matching config could not be found
 */
const getCollectionFileConfig = (collectionFileConfigs, file) =>
  collectionFileConfigs.find(({ regex }) => file.name.match(regex));

/**
 * Check to see if a file has an associated collection file config
 *
 * @param {Array<Object>} collectionFileConfigs - a list of collection file
 * configs
 * @param {Object} file - a file
 * @returns {boolean}
 */
const fileHasCollectionFileConfig = curry(
  (collectionFileConfigs, file) =>
    getCollectionFileConfig(collectionFileConfigs, file) !== undefined
);

/**
 * Typically, only files that have a matching collection file config will be
 * returned. If `config.ignoreFilesConfigForDiscovery` or
 * `config.collection.ignoreFilesConfigForDiscovery` are set to true, though,
 * all files will be returned. Defaults to `false`.
 *
 * This function inspects the config to determine if all files should be
 * returned;
 *
 * @param {Object} config - the event config
 * @returns {boolean}
 */
const returnAllFiles = (config) => {
  if (isBoolean(config.ignoreFilesConfigForDiscovery)) {
    return config.ignoreFilesConfigForDiscovery;
  }
  if (isBoolean(config.collection.ignoreFilesConfigForDiscovery)) {
    return config.collection.ignoreFilesConfigForDiscovery;
  }
  return false;
};

/**
 * Given an event config and a file, find the collection file config associated
 * with the file. If one is found, add `bucket`, `url_path`, and `type`
 * properties to the file.
 *
 * @param {Object} config - a config object containing `buckets` and
 * `collection` properties
 * @param {Object} file - a file object
 * @returns {Object} a file object, possibly with three additional properties
 */
const updateFileFromCollectionFileConfig = curry(
  ({ buckets, collection }, file) => {
    const fileConfig = getCollectionFileConfig(collection.files, file);

    if (fileConfig === undefined) return file;

    return {
      ...file,
      bucket: buckets[fileConfig.bucket].name,
      url_path: fileConfig.url_path || collection.url_path || '',
      type: fileConfig.type || ''
    };
  }
);

/**
 * Build a granule to be returned from the Lambda function
 *
 * @param {Object} config - the event config
 * @param {Array<Object>} files - a list of files belonging to the granule
 * @param {string} granuleId - the granule id
 * @returns {Object} a granule
 */
const buildGranule = curry(
  (config, files, granuleId) => {
    let filesToReturn;

    if (returnAllFiles(config)) {
      filesToReturn = files;
    } else {
      filesToReturn = files
        .filter(fileHasCollectionFileConfig(config.collection.files))
        .map(updateFileFromCollectionFileConfig(config));
    }

    return {
      granuleId,
      dataType: config.collection.dataType,
      version: config.collection.version,
      files: filesToReturn
    };
  }
);

/**
 * Discovers granules. See schemas/input.json and schemas/config.json for
 * detailed event description.
 *
 * @param {Object} event - Lambda event object
 * @returns {Object} - see schemas/output.json for detailed output schema that
 *    is passed to the next task in the workflow
 */
const discoverGranules = async ({ config }) => {
  const discoveredFiles = await listFiles(
    config.provider,
    config.useList,
    config.collection.provider_path
  );

  const filesByGranuleId = groupFilesByGranuleId(
    config.collection.granuleIdExtraction,
    discoveredFiles
  );

  const granules = map(filesByGranuleId, buildGranule(config));

  logger().info(`Discovered ${granules.length} granules.`);
  return { granules };
};

/**
 * Lambda handler.
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
const handler = (event, context, callback) => {
  runCumulusTask(discoverGranules, event, context, callback);
};

module.exports = {
  discoverGranules,
  handler
};
