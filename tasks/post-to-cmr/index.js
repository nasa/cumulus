/* eslint-disable no-param-reassign */

'use strict';

const path = require('path');
const get = require('lodash.get');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { getS3Object, parseS3Uri, promiseS3Upload } = require('@cumulus/common/aws');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { moveGranuleFile } = require('@cumulus/ingest/granule');
const urlPathTemplate = require('@cumulus/ingest/url-path-template');
const { CMR } = require('@cumulus/cmrjs');
const { xmlParseOptions } = require('@cumulus/cmrjs/utils');
const { XmlMetaFileNotFound } = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const xml2js = require('xml2js');

/**
 * Extract the granule ID from the a given s3 uri
 *
 * @param {string} uri - the s3 uri of the file
 * @param {string} regex - the regex for extracting the ID
 * @returns {string} the granule
 */
function getGranuleId(uri, regex) {
  const filename = path.basename(uri);
  const test = new RegExp(regex);
  const match = filename.match(test);

  if (match) {
    return match[1];
  }
  return match;
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
 * getMetadata
 *
 * @param {string} xmlFilePath - S3 URI to the xml metadata document
 * @returns {string} returns stringified xml document downloaded from S3
 */
async function getMetadata(xmlFilePath) {
  if (!xmlFilePath) {
    throw new XmlMetaFileNotFound('XML Metadata file not provided');
  }

  // GET the metadata text
  // Currently, only supports files that are stored on S3
  const parts = xmlFilePath.match(/^s3:\/\/(.+?)\/(.+)$/);
  const obj = await getS3Object(parts[1], parts[2]);
  return obj.Body.toString();
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
    if (filename.match(expectedFormat)) {
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
 * function for posting cmr xml files from S3 to CMR
 *
 * @param {Object} cmrFile - an object representing the cmr file
 * @param {string} cmrFile.granuleId - the granuleId of the cmr xml File
 * @param {string} cmrFile.filename - the s3 uri to the cmr xml file
 * @param {Object} creds - credentials needed to post to the CMR
 * @param {string} creds.provider - the name of the Provider used on the CMR side
 * @param {string} creds.clientId - the clientId used to generate CMR token
 * @param {string} creds.username - the CMR username
 * @param {string} creds.password - the encrypted CMR password
 * @param {string} bucket - the bucket name where public/private keys are stored
 * @param {string} stack - the deployment stack name
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publish(cmrFile, creds, bucket, stack) {
  let password;
  try {
    password = await DefaultProvider.decrypt(creds.password, undefined, bucket, stack);
  }
  catch (e) {
    log.error('Decrypting password failed, using unencrypted password');
    password = creds.password;
  }
  const cmr = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );

  const xml = cmrFile.metadata;
  const res = await cmr.ingestGranule(xml);
  const conceptId = res.result['concept-id'];

  log.info(`Published ${cmrFile.granuleId} to the CMR. conceptId: ${conceptId}`);

  return {
    granuleId: cmrFile.granuleId,
    filename: cmrFile.filename,
    conceptId,
    link: 'https://cmr.uat.earthdata.nasa.gov/search/granules.json' +
      `?concept_id=${res.result['concept-id']}`
  };
}

/**
 * Creates an object with all granule files
 * from the input array and the input_granules config
 *
 * @param {Array} input - the task input array
 * @param {Array} granules - an array of the granules
 * @param {string} regex - regex needed to extract granuleId from filenames
 * @returns {Object} an object that contains all granules
 * with the granuleId as the key of each granule
 */
function getAllGranules(input, granules, regex) {
  const granulesHash = {};
  const filesHash = {};

  // create hash list of the granules
  // and a hash list of files
  granules.forEach((g) => {
    granulesHash[g.granuleId] = g;
    g.files.forEach((f) => {
      filesHash[f.filename] = g.granuleId;
    });
  });

  // add input files to corresponding granules
  // the process involve getting granuleId of each file
  // match it against the granuleObj and adding the new files to the
  // file list
  input.forEach((f) => {
    if (!filesHash[f]) {
      const granuleId = getGranuleId(f, regex);
      const uriParsed = parseS3Uri(f);
      granulesHash[granuleId].files.push({
        filename: f,
        bucket: uriParsed.Bucket,
        name: path.basename(f)
      });
    }
  });

  return granulesHash;
}

/**
* Move all files in a collection of granules from staging location fo final location
*
* @param {Object} granulesObject - an object of the granules where the key is the granuleId
* @param {string} sourceBucket - source bucket location of files
* @returns {Promise} promise resolves when all files have been moved
**/
async function moveGranuleFiles(granulesObject, sourceBucket) {
  const moveFileRequests = [];

  Object.keys(granulesObject).forEach((granuleKey) => {
    const granule = granulesObject[granuleKey];
    granule.files.forEach((file) => {
      const source = {
        Bucket: sourceBucket,
        Key: `${file.fileStagingDir}/${file.name}`
      };

      const target = {
        Bucket: file.bucket,
        Key: file.filepath
      };

      moveFileRequests.push(moveGranuleFile(source, target));
    });
  });

  return Promise.all(moveFileRequests);
}

/**
* Update the granule metadata with the final location of files
*
* @param {Object} granulesObject - an object of the granules where the key is the granuleId
* @param {Object} collection - configuration object defining a collection
* of granules and their files
* @param {string} cmrFiles - array of objects that include CMR xmls uris and granuleIds
* @returns {Promise} promise resolves when all files have been moved
**/
function updateGranuleMetadata(granulesObject, collection, cmrFiles) {
  Object.keys(granulesObject).forEach((granuleId) => {
    granulesObject[granuleId].files.forEach((file) => {
      collection.files.forEach((fileConfig) => {
        const test = new RegExp(fileConfig.regex);
        const match = file.name.match(test);

        const cmrFile = cmrFiles.find((f) => f.granuleId === granuleId);
        if (match) {
          if (!file.url_path) {
            file.url_path = fileConfig.url_path || collection.url_path || '';
          }

          const urlPath = urlPathTemplate(file.url_path, {
            file: file,
            granule: granulesObject[granuleId],
            cmrMetadata: cmrFile ? cmrFile.metadataObject : {}
          });

          file.bucket = fileConfig.bucket;
          file.filepath = path.join(urlPath, file.name);
          file.filename = `s3://${path.join(file.bucket, file.filepath)}`;
        }
      });
    });
  });

  return granulesObject;
}

/**
* Update the online access url fields in CMR xml files
*
* @param {string} cmrFiles - array of objects that include CMR xmls uris and granuleIds
* @param {Object} granulesObject - an object of the granules where the key is the granuleId
* @returns {Promise} promise resolves when all files have been updated
**/
async function updateCmrFileAccessURls(cmrFiles, granulesObject) {
  for (const cmrFile of cmrFiles) {
    const onlineAccessUrls = cmrFile.metadataObject.Granule.OnlineAccessURLs;

    const urls = onlineAccessUrls.OnlineAccessURL.map((urlObj) => {
      const filename = path.basename(urlObj.URL);
      const granule = granulesObject[cmrFile.granuleId];
      const file = granule.files.find((f) => f.name === filename);
      urlObj.URL = file.filename;
      return urlObj;
    });

    cmrFile.metadataObject.Granule.OnlineAccessURLs.OnlineAccessURL = urls;
    const builder = new xml2js.Builder();
    const xml = builder.buildObject(cmrFile);
    const [, Bucket, Key] = cmrFile.filename.match(/^s3:\/\/(.+?)\/(.+)$/);
    await promiseS3Upload({ Bucket, Key, Body: xml });
  }
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
 * @param {string} event.config.granuleIdExtraction - regex needed to extract granuleId
 *                                                    from filenames
 * @param {Object} event.config.cmr - the cmr object containing user/pass and provider
 * @param {Array} event.config.input_granules - an array of granules
 * @param {Object} event.config.collection - configuration object defining a collection
 * of granules and their files
 * @param {boolean} [event.config.moveStagedFiles=true] - set to false to skip moving files
 * from staging to final bucket. Mostly useful for testing.
 * @param {Array} event.input - an array of s3 uris
 * @returns {Promise} returns the promise of an updated event object
 */
async function postToCMR(event) {
  // we have to post the meta-xml file of all output granules
  // first we check if there is an output file
  const config = get(event, 'config');
  const bucket = get(config, 'bucket'); // the name of the bucket with private/public keys
  const stack = get(config, 'stack'); // the name of the deployment stack
  const regex = get(config, 'granuleIdExtraction', '(.*)');
  const creds = get(config, 'cmr');
  const inputGranules = get(config, 'input_granules', {});
  const moveStagedFiles = get(config, 'moveStagedFiles', true);
  const collection = config.collection;
  const input = get(event, 'input', []);

  // get cmr files from staging location
  const cmrFiles = await getCmrFiles(input, regex);

  // create granules object for cumulus indexer
  let allGranules = getAllGranules(input, inputGranules, regex);

  // update granules object with final locations of files as `filename`
  allGranules = updateGranuleMetadata(allGranules, collection, cmrFiles);
  // allows us to disable moving the files
  if (moveStagedFiles) {
    // move files from staging location to final location
    await moveGranuleFiles(allGranules, bucket);

    // update cmr.xml files with correct online access urls
    updateCmrFileAccessURls(cmrFiles, allGranules, regex);
  }

  // post all meta files to CMR
  const publishRquests = cmrFiles.map((cmrFile) => publish(cmrFile, creds, bucket, stack));
  const results = await Promise.all(publishRquests);

  return {
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
  cumulusMessageAdapter.runCumulusTask(postToCMR, event, context, callback);
}

exports.handler = handler;

// use node index.js local to invoke this
justLocalRun(() => {
  const payload = require('@cumulus/test-data/cumulus_messages/post-to-cmr.json'); // eslint-disable-line global-require, max-len
  handler(payload, {}, (e, r) => console.log(e, r));
});
