'use strict';

const curry = require('lodash/curry');
const get = require('lodash/get');
const groupBy = require('lodash/groupBy');
const isBoolean = require('lodash/isBoolean');
const map = require('lodash/map');
const pick = require('lodash/pick');
const pMap = require('p-map');
const Logger = require('@cumulus/logger');
const granules = require('@cumulus/api-client/granules');
const { runCumulusTask } = require('@cumulus/cumulus-message-adapter-js');
const { buildProviderClient } = require('@cumulus/ingest/providerClientUtils');

const logger = (logOptions) => new Logger({
  executions: process.env.EXECUTIONS,
  granules: process.env.GRANULES ? JSON.parse(process.env.GRANULES) : undefined,
  parentArn: process.env.PARENTARN,
  sender: process.env.SENDER || '@cumulus/discover-granules',
  stackName: process.env.STACKNAME,
  version: process.env.TASKVERSION,
  ...logOptions,
});

/**
 * Fetch a list of files from the provider
 *
 * @param {Object} params
 * @param {Object} params.providerConfig - the connection config for the provider
 * @param {bool}   params.useList - flag to tell ftp server to use 'LIST'
 *   instead  of 'STAT'
 * @param {number} [params.httpRequestTimeout=300] - seconds for http provider
 *   to wait before timing out
 * @param {string} params.path - the provider path to search
 * @returns {Array<Object>} a list of discovered file objects
 */
const listFiles = async (params) => {
  const { providerConfig, useList, httpRequestTimeout = 300, path } = params;
  const provider = buildProviderClient({
    ...providerConfig,
    useList,
    httpRequestTimeout,
  });

  try {
    await provider.connect();
    return await provider.list(path);
  } finally {
    await provider.end();
  }
};

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
      type: fileConfig.type || '',
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
      dataType: config.collection.name,
      version: config.collection.version,
      files: filesToReturn,
    };
  }
);

/**
 * checks a granuleId against the Granules API to determine if
 * there is a duplicate granule
 *
 * @param {string} granuleId - granuleId to evaluate
 * @param {string} duplicateHandling - collection duplicate handling configuration value
 * @returns {*}     - returns granuleId string if no duplicate found, false if
 *                    a duplicate is found.
 * @throws {Error}  - Throws an error on duplicate if
 *                    dupeConfig.duplicateHandling is set to 'error'
 *
 */
const checkGranuleHasNoDuplicate = async (granuleId, duplicateHandling) => {
  let response;
  try {
    response = await granules.getGranuleResponse({
      prefix: process.env.STACKNAME,
      expectedStatusCodes: [200, 404],
      granuleId,
    });
  } catch (error) {
    const responseError = error;
    if (responseError.statusCode !== 404) {
      throw new Error(`Unexpected error from Private API lambda: ${responseError.message}`);
    }
  }

  if (response.statusCode === 200) {
    if (duplicateHandling === 'error') {
      throw new Error(`Duplicate granule found for ${granuleId} with duplicate configuration set to error`);
    }
    return false;
  }

  if (response.statusCode === 404) {
    return granuleId;
  }

  throw new Error(`Unexpected return from Private API lambda: ${JSON.stringify(response)}`);
};

/**
 * Filters granule duplicates from a list of granuleIds according to the
 * configuration in duplicateHandling:
 *
 * skip:               Duplicates will be filtered from the list
 * error:              Duplicates encountered will result in a thrown error
 * replace, version:   Duplicates will be ignored
 *
 * @param {Object} params - params object
 * @param {string[]} params.granuleIds - Array of granuleIds to filter
 * @param {string} params.duplicateHandling - flag that defines this function's behavior
 *                                            (see description)
 * @param {number} params.concurrency - limitation on max concurrent granules
 *                                      to check for duplicates
 *
 * @returns {Array.string} returns granuleIds parameter with applicable duplciates removed
 */
const filterDuplicates = async ({ granuleIds, duplicateHandling, concurrency }) => {
  const checkResults = await pMap(
    granuleIds,
    (key) => checkGranuleHasNoDuplicate(key, duplicateHandling),
    { concurrency }
  );
  return checkResults.filter(Boolean);
};

/**
 * Handles duplicates in the filelist according to the duplicateHandling flag:
 *
 * skip:               Duplicates will be filtered from the list
 * error:              Duplicates encountered will result in a thrown error
 * replace, version:   Duplicates will be ignored
 *
 * @param {Object} params - params object
 * @param {Object} params.filesByGranuleId - Object with granuleId for keys with an array of
 *                                    matching files for each
 *
 * @param {string} params.duplicateHandling - flag that defines this function's behavior
 *                                            (see description)
 * @param {number} params.concurrency - granule duplicate filtering max concurrency
 *                                      (`skip` or `error` handling only)
 *
 * @returns {Object} returns filesByGranuleId with applicable duplciates removed
 */
const handleDuplicates = async ({ filesByGranuleId, duplicateHandling, concurrency }) => {
  logger().info(`Running discoverGranules with duplicateHandling set to ${duplicateHandling}`);
  if (['skip', 'error'].includes(duplicateHandling)) {
    // Iterate over granules, remove if exists in dynamo
    const filteredKeys = await filterDuplicates({
      granuleIds: Object.keys(filesByGranuleId),
      duplicateHandling,
      concurrency,
    });
    return pick(filesByGranuleId, filteredKeys);
  }
  if (['replace', 'version'].includes(duplicateHandling)) {
    return filesByGranuleId;
  }
  throw new Error(`Invalid duplicate handling configuration encountered: ${JSON.stringify(duplicateHandling)}`);
};

/**
 * Discovers granules. See schemas/input.json and schemas/config.json for
 * detailed event description.
 *
 * @param {Object} event - Lambda event object
 * @returns {Object} - see schemas/output.json for detailed output schema that
 *    is passed to the next task in the workflow
 */
const discoverGranules = async ({ config }) => {
  const discoveredFiles = await listFiles({
    providerConfig: config.provider,
    useList: config.useList,
    httpRequestTimeout: config.httpRequestTimeout,
    path: config.provider_path,
  });

  let filesByGranuleId = groupFilesByGranuleId(
    config.collection.granuleIdExtraction,
    discoveredFiles
  );

  const duplicateHandling = config.duplicateGranuleHandling || 'replace';
  filesByGranuleId = await handleDuplicates({
    filesByGranuleId,
    duplicateHandling,
    concurrency: get(config, 'concurrency', 3),
  });

  const discoveredGranules = map(filesByGranuleId, buildGranule(config));

  logger({ granules: discoveredGranules.map((g) => g.granuleId) }).info(`Discovered ${discoveredGranules.length} granules.`);
  return { granules: discoveredGranules };
};

/**
 * Lambda handler.
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
const handler = async (event, context) => await runCumulusTask(discoverGranules, event, context);

module.exports = {
  checkGranuleHasNoDuplicate, // exported to support testing
  discoverGranules,
  handler,
  filterDuplicates, // exported to support testing
  handleDuplicates, // exported to support testing
};
