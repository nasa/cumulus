'use strict';

const get = require('lodash.get');
const path = require('path');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { getMetadata } = require('@cumulus/ingest/granule');
const { publish } = require('@cumulus/ingest/cmr');
const { xmlParseOptions } = require('@cumulus/cmrjs/utils');
const xml2js = require('xml2js');
const log = require('@cumulus/common/log');


/**
 * Extract the granule ID from the a given s3 uri
 *
 * @param {string} uri - the s3 uri of the file
 * @param {string} regex - the regex for extracting the ID
 * @returns {string} the granule
 */
function getGranuleId(uri, regex) {
  const filename = path.basename(uri);
  const match = filename.match(regex);

  if (match) return match[1];
  throw new Error(`Could not determine granule id of ${filename} using ${regex}`);
}

/**
 * Parse an xml string
 *
 * @param {string} xml - xml to parse
 * @returns {Promise<Object>} promise resolves to object version of the xml
 */
async function parseXmlString(xml) {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xml, xmlParseOptions, (err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });
}

/**
 * returns a list of CMR xml files
 *
 * @param {Array} input - an array of s3 uris
 * @param {string} granuleIdExtraction - a regex for extracting granule IDs
 * @returns {Promise<Array>} promise resolves to an array of objects
 * that includes CMR xmls uris and granuleIds
 */
async function getCmrFiles(input, granuleIdExtraction) {
  const files = [];
  const expectedFormat = /.*\.cmr\.xml$/;

  for (const filename of input) {
    if (filename && filename.match(expectedFormat)) {
      const metadata = await getMetadata(filename);
      const metadataObject = await parseXmlString(metadata);

      const cmrFileObject = {
        filename,
        metadata,
        metadataObject,
        granuleId: getGranuleId(filename, granuleIdExtraction)
      };

      files.push(cmrFileObject);
    }
  }

  return files;
}

/**
 * Builds the output of the post-to-cmr task
 *
 * @param {Array} results - list of results returned by publish function
 * @param {Object} granulesObject - an object of the granules where the key is the granuleId
 * @returns {Array} an updated array of granules
 */
function buildOutput(results, granulesObject) {
  // add results to corresponding granules
  results.forEach((r) => {
    if (granulesObject[r.granuleId]) {
      granulesObject[r.granuleId].cmrLink = r.link;
      granulesObject[r.granuleId].published = true;
    }
  });

  return Object.keys(granulesObject).map((k) => granulesObject[k]);
}

/**
 * Post to CMR
 * See the schemas directory for detailed input and output schemas
 *
 * @param {Object} event -Lambda function payload
 * @param {Object} event.config - the config object
 * @param {string} event.config.bucket - the bucket name where public/private keys
 *                                       are stored
 * @param {string} event.config.stack - the deployment stack name
 * @param {Object} event.input.granules - Object of all granules where granuleID is the key
 * @param {Object} event.config.cmr - the cmr object containing user/pass and provider
 * @returns {Promise} returns the promise of an updated event object
 */
async function postToCMR(event) {
  // we have to post the meta-xml file of all output granules
  // first we check if there is an output file
  const config = get(event, 'config');
  const bucket = get(config, 'bucket'); // the name of the bucket with private/public keys
  const stack = get(config, 'stack'); // the name of the deployment stack
  const input = get(event, 'input', []);
  const process = get(config, 'process');
  const regex = get(config, 'granuleIdExtraction', '(.*)');
  const granules = get(input, 'granules'); // Object of all Granules
  const creds = get(config, 'cmr');
  const allGranules = {};
  const allFiles = [];
  granules.forEach((granule) => {
    allGranules[granule.granuleId] = granule;
    granule.files.forEach((file) => {
      allFiles.push(file.filename);
    });
  });

  // get cmr files
  const cmrFiles = await getCmrFiles(allFiles, regex);

  // post all meta files to CMR
  const publishRequests = cmrFiles.map((cmrFile) => publish(cmrFile, creds, bucket, stack));
  const results = await Promise.all(publishRequests);

  return {
    process: process,
    granules: buildOutput(results, allGranules)
  };
}

exports.postToCMR = postToCMR;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  const startTime = Date.now();

  cumulusMessageAdapter.runCumulusTask(postToCMR, event, context, (err, data) => {
    if (err) {
      callback(err);
    }
    else {
      const additionalMetaFields = {
        post_to_cmr_duration: Date.now() - startTime,
        post_to_cmr_start_time: startTime
      };
      const meta = Object.assign({}, data.meta, additionalMetaFields);
      callback(null, Object.assign({}, data, { meta }));
    }
  });
}

exports.handler = handler;

// use node index.js local to invoke this
justLocalRun(() => {
  const payload = require('@cumulus/test-data/cumulus_messages/post-to-cmr.json'); // eslint-disable-line global-require, max-len
  handler(payload, {}, (e, r) => log.info(e, r));
});
