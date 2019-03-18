'use strict';

const get = require('lodash.get');
const path = require('path');

const { getGranuleId } = require('@cumulus/cmrjs');
const { parseS3Uri } = require('@cumulus/common/aws');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

/**
 * Helper to turn an s3URI into a fileobject
 * @param {string} s3URI s3://mybucket/myprefix/myobject.
 * @returns {Object} file object
 */
function fileObjectFromS3URI(s3URI) {
  const uriParsed = parseS3Uri(s3URI);
  return {
    name: path.basename(s3URI),
    bucket: uriParsed.Bucket,
    filename: s3URI,
    fileStagingDir: path.dirname(uriParsed.Key)
  };
}

/**
 * Takes the files from input and granules and merges them into an object where
 * each file is associated with it's granuleId.
 *
 * @param {Array} inputFiles - list of s3 files to add to the inputgranules
 * @param {Array} inputGranules - an array of the granules
 * @param {string} regex - regex needed to extract granuleId from filenames
 * @returns {Object} an object that contains lists of each granules' files
 *                   attatched by their granuleId
 */
function mergeInputFilesWithInputGranules(inputFiles, inputGranules, regex) {
  const granulesHash = {};
  const filesFromInputGranules = {};

  // create hash list of the granules
  // and a hash list of files
  inputGranules.forEach((g) => {
    granulesHash[g.granuleId] = g;
    g.files.forEach((f) => {
      filesFromInputGranules[f.filename] = g.granuleId;
    });
  });

  // add input files to corresponding granules
  // the process involve getting granuleId of each file
  // match it against the granuleObj and adding the new files to the
  // file list
  inputFiles.forEach((f) => {
    if (f && !filesFromInputGranules[f]) {
      const granuleId = getGranuleId(f, regex);
      granulesHash[granuleId].files.push(fileObjectFromS3URI(f));
    }
  });

  return granulesHash;
}

function convertFileURIArrayToGranuleObjectArray(event) {
  const granuleIdExtractionRegex = get(event.config, 'granuleIdExtraction', '(.*)');
  const inputGranules = get(event.config, 'input_granules', {});
  const inputFileList = get(event, 'input', []);

  const allGranules = mergeInputFilesWithInputGranules(
    inputFileList, inputGranules, granuleIdExtractionRegex
  );

  return {
    granules: Object.keys(allGranules).map((k) => allGranules[k])
  };
}

exports.filesToGranules = convertFileURIArrayToGranuleObjectArray;

function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(
    convertFileURIArrayToGranuleObjectArray, event, context, callback
  );
}

exports.handler = handler;
