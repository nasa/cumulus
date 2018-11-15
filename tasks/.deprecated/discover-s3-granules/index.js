'use strict';

const { listS3Objects } = require('@cumulus/common/aws');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { loadJSONTestData } = require('@cumulus/test-data');

/**
* filterByFileType
*
* @private
* @param  {string} fileType - the file type
* @param  {Array} contents - array of strings with filenames
* @returns {Array} filtered array of files
*/
function filterByFileType(fileType, contents) {
  const suffix = fileType.startsWith('.') ? fileType : '.' + fileType;
  return contents.filter((f) => f.Key.endsWith(suffix));
}

/**
* createGranuleObject
*
* @private
* @param  {string} filename - the filename
* @param  {string} bucket - name of bucket
* @param  {RegExp} filenameRegExp - used to filter files by regex
* @returns {Array} filtered array of files
*/
function createGranuleObject(filename, bucket, filenameRegExp) {
  const match = filename.match(filenameRegExp);
  if (!match) return null;

  return {
    granuleId: match[1],
    files: [{
      filename: `s3://${bucket}/${filename}`
    }]
  };
}

/**
* createOutput
*
* @private
* @param  {Array} list - array of strings with filenames
* @param  {Object} options - the options config
* @param  {string} options.bucket - name of bucket
* @param  {RegExp} options.filenameRegExp - used to filter files by regex
* @param  {string} [options.fileType] - the optional fileType
* @returns {Array} array of objects with `granuleId` and `files` properties
* filtered by `options.fileType`
*/
function createGranules(list, options) {
  const fileType = options.fileType;
  const bucket = options.bucket;
  const filenameRegExp = options.filenameRegExp;

  // filter files if filetype is provided
  const files = fileType
    ? filterByFileType(fileType, list)
    : list;

  // get granuleIds of each file and construct the payload
  // filters out files that don't match the filenameRegExp
  return files
    .map((file) => createGranuleObject(file.Key, bucket, filenameRegExp))
    .filter((file) => !!file);
}

/**
* Callback function provided by aws lambda. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
* @callback lambdaCallback
* @param {object} error
* @param {object} output - output object matching schemas/output.json
*/

/**
* Lambda function handler for discovering granules on s3 buckets.
* See schemas/config.json for detailed expected input.
*
* @param  {Object} event - lambda event object
* @param  {Object} event.config - task config object
* @param  {string} event.config.bucket - the bucket to search for files
* @param  {string} event.config.file_type - the type of the files to search for
* @param  {string} event.config.file_prefix - the prefix of the files
* @param  {string} event.config.granuleIdExtraction - the regex used to extract
                                                      granule Id from file names
* @returns {Promise.<Object>} an object that includes the granules
*/
async function discoverS3(event) {
  const config = event.config;
  const fileType = config.file_type;
  const prefix = config.file_prefix;
  const bucket = config.bucket;
  const granuleIdExtraction = config.granuleIdExtraction;
  const filenameRegExp = new RegExp(granuleIdExtraction);

  const outputOptions = { fileType, filenameRegExp, bucket };

  const list = await listS3Objects(bucket, prefix);
  const granules = createGranules(list, outputOptions);
  return {
    granules
  };
}

module.exports.discoverS3 = discoverS3;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  return cumulusMessageAdapter.runCumulusTask(discoverS3, event, context, callback);
}
exports.handler = handler;

// use node index.js local to invoke this
justLocalRun(async () => {
  const payload = await loadJSONTestData('cumulus_messages/discover-s3-granules.json');
  handler(payload, {}, (e, r) => console.log(e, r));
});
