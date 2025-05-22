'use strict';

const flatten = require('lodash/flatten');
const get = require('lodash/get');
const keyBy = require('lodash/keyBy');
const path = require('path');

const { getObjectSize, parseS3Uri } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

const { getGranuleId } = require('./utils');

/**
 * Helper to turn an s3URI into a fileobject
 *
 * @param {string} s3URI - s3://mybucket/myprefix/myobject.
 * @returns {Object} file object
 */
async function fileObjectFromS3URI(s3URI) {
  const uriParsed = parseS3Uri(s3URI);
  const size = await getObjectSize({
    s3: s3(),
    bucket: uriParsed.Bucket,
    key: uriParsed.Key,
  });
  return {
    key: uriParsed.Key,
    fileName: path.basename(uriParsed.Key),
    bucket: uriParsed.Bucket,
    size,
  };
}

/**
 * Takes the files from input and granules and merges them into an object where
 * each file is associated with its granuleId.
 *
 * @param {Object} params - params object
 * @param {Array<string>} params.inputFiles - list of s3 files to add to the inputgranules
 * @param {Array<Object>} params.inputGranules - an array of the granules
 * @param {string} params.regex - regex needed to extract granuleId from filenames
 * @param {boolean} params.matchFilesWithProducerGranuleId -
 *  If true, match files to granules using producerGranuleId. Else, granuleId.
 * @returns {Object} inputGranules with updated file lists
 */
async function mergeInputFilesWithInputGranules({
  inputFiles,
  inputGranules,
  regex,
  matchFilesWithProducerGranuleId
}) {
  // create hash list of the granules
  // and a list of files
  const granulesHash = matchFilesWithProducerGranuleId ?
    keyBy(inputGranules, 'producerGranuleId') :
    keyBy(inputGranules, 'granuleId');
  const filesFromInputGranules = flatten(inputGranules.map((g) => g.files.map((f) => `s3://${f.bucket}/${f.key}`)));

  // add input files to corresponding granules
  // the process involve getting granuleId of each file
  // match it against the granuleObj and adding the new files to the
  // file list
  const filesToAdd = inputFiles.filter((f) => f && !filesFromInputGranules.includes(f));

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < filesToAdd.length; i += 1) {
    const f = filesToAdd[i];
    const fileGranuleId = getGranuleId(f, regex);
    try {
      granulesHash[fileGranuleId].files.push(await fileObjectFromS3URI(f));
    } catch (error) {
      throw new Error(`Failed adding ${f} to ${fileGranuleId}'s files: ${error.name} ${error.message}`);
    }
  }
  /* eslint-enable no-await-in-loop */

  return {
    granules: Object.keys(granulesHash).map((k) => granulesHash[k]),
  };
}

/**
 * Files-To-Granules task to change array-of-files input to granules object output
 *
 * @param {Object} event - Lambda function payload
 * @param {Object} event.config - Cumulus config object
 * @param {string} event.config.granuleIdExtraction - regex needed to extract granuleId
 *                                                    from filenames
 * @param {Array<Object>} event.config.inputGranules - an array of granules
 * @param {Array<string>} event.input - an array of s3 uris
 *
 * @returns {Object} Granules object
 */
function filesToGranules(event) {
  const regex = get(event.config, 'granuleIdExtraction', '(.*)');
  const matchFilesWithProducerGranuleId = get(event.config, 'matchFilesWithProducerGranuleId');
  const inputGranules = event.config.inputGranules;
  const inputFiles = event.input;

  return mergeInputFilesWithInputGranules({
    inputFiles,
    inputGranules,
    regex,
    matchFilesWithProducerGranuleId
});
}
exports.filesToGranules = filesToGranules;

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(
    filesToGranules, event, context
  );
}

exports.handler = handler;
