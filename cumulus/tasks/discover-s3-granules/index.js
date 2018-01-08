'use strict';

const { listS3Objects } = require('@cumulus/common/aws');

/**
* filterByFileType
*
* @private
* @param  {string} fileType
* @param  {array} contents array of strings with filenames
* @return {array} filtered array of files
*/
function filterByFileType(fileType, contents) {
  const suffix = fileType.startsWith('.') ? fileType : '.' + fileType;
  return contents.filter((f) => f.Key.endsWith(suffix));
}

/**
* createGranuleObject
*
* @private
* @param  {string} filename
* @param  {string} bucket name of bucket
* @param  {regexp} filenameRegExp used to filter files by regex
* @param  {array} contents array of strings with filenames
* @return {array} filtered array of files
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
* @param  {array} list array of strings with filenames
* @param  {object} options
* @param  {string} options.bucket name of bucket
* @param  {regexp} options.filenameRegExp used to filter files by regex
* @param  {string} [options.fileType]
* @return {array} array of objects with `granuleId` and `files` properties
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
* See schemas/input.json for detailed expected input.
*
* @param  {object} event lambda event object
* @param  {object} event.config
* @param  {object} event.config.buckets
* @param  {object} event.config.bucket_type
* @param  {object} event.config.file_type
* @param  {object} event.config.collection
* @param  {string} event.config.collection.granuleIdExtraction string used to
  create RegExp for matching filenames
* @param  {object} context Lambda context object. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
* @param  {lambdaCallback} callback callback function
* @return {undefined}
*/
function handler(event, context, callback) {
  const config = event.config;
  const fileType = config.file_type;
  const prefix = config.file_prefix;

  const bucketType = config.bucket_type;
  const buckets = config.buckets;
  const bucket = buckets[bucketType];

  const collection = config.collection;
  const filenameRegExp = new RegExp(collection.granuleIdExtraction);

  const outputOptions = { fileType, filenameRegExp, bucket };

  listS3Objects(bucket, prefix)
    .then((list) => {
      const granules = createGranules(list, outputOptions);
      callback(null, { granules });
    })
    .catch(callback);
}

module.exports.handler = handler;
