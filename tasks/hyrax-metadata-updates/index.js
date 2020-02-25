'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const log = require('@cumulus/common/log');
const { InvalidArgument } = require('@cumulus/errors');

const {
  s3ObjectExists,
  s3PutObject,
  deleteS3Object
} = require('@cumulus/aws-client/S3');

const get = require('lodash.get');
const _ = require('lodash/core');

const {
  isCMRFile,
  metadataObjectFromCMRFile,
  granulesToCmrFileObjects,
  updateCMRMetadata
} = require('@cumulus/cmrjs');

const BucketsConfig = require('@cumulus/common/BucketsConfig');

const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');

const libxmljs = require('libxmljs');

const isECHO10File = (filename) => filename.endsWith('cmr.xml');
const isUMMGFile = (filename) => filename.endsWith('cmr.json');

/**
 * Throw an error if hyrax-metadata-updates is configured to throw an error for
 * testing/example purposes. Set the pass on retry value to simulate
 * a task passing on a retry.
 *
 * @param {Object} event - input from the message adapter
 * @returns {undefined} none
 */
async function throwErrorIfConfigured(event) {
  const execution = event.config.execution;
  const retryFilename = `${execution}_retry.txt`;
  const bucket = event.config.bucket;

  let isRetry = false;

  if (event.config.passOnRetry) {
    isRetry = await s3ObjectExists({
      Bucket: bucket,
      Key: retryFilename
    });
  }

  if (event.config.passOnRetry && isRetry) {
    log.debug('Detected retry');

    // Delete file
    await deleteS3Object(bucket, retryFilename);
  } else if (event.config.fail) {
    if (event.config.passOnRetry) {
      await s3PutObject({
        Bucket: bucket,
        Key: retryFilename,
        Body: ''
      });
    }

    throw new Error('Step configured to force fail');
  }
}

/**
 * generateAddress
 *
 * @param {Object} env - the environment retrieved from configuration
 * @throws {InvalidArgument} if the env is not valid
 * @returns {string} - the corresponding OPeNDAP address
 */
function generateAddress(env) {
  const validEnvs = ['prod', 'uat', 'sit'];
  let envSubstition = env;
  if (validEnvs.includes(env)) {
    envSubstition = (env === 'prod' ? '' : `${env}.`);
  }
  else {
    // Throw an exception if it is not a valid environment
    throw new InvalidArgument(`Environment ${env} is not a valid environment.`);
  }
  return (`https://opendap.${envSubstition}earthdata.nasa.gov`);
}

/**
 * generateNativeId
 *
 * @param {string} metadata - the metadata
 * @returns {string} - the native id
 */
function getNativeId(metadata) {
  let metadataObject = null;
  try {
    // Is this UMM-G or ECHO10?
    metadataObject = JSON.parse(metadata);
    // UMM-G: meta/native-id
    const nativeId = metadataObject.meta['native-id'];
    return nativeId;
  } catch (e) {
    // ECHO10: Granule/DataGranule/ProducerGranuleId
    const xmlDoc = libxmljs.parseXml(metadata);
    const nativeIdNode = xmlDoc.get('/Granule/GranuleUR');

    return nativeIdNode.text();
  }
}


/**
 * generatePath
 *
 * @param {Object} event - the event
 * @param {Object} metadata - the metadata
 * @throws {Object} invalidArgumentException - if the env is not valid
 * @returns {string} - the OPeNDAP path
 */
function generatePath(event, metadata) {
  const providerId = get(event.config, 'provider');
  // Check if providerId is defined
  if (_.isUndefined(providerId)) {
    throw new InvalidArgument('Provider not supplied in configuration. Unable to construct path');
  }
  const entryTitle = get(event.config, 'entryTitle');
  // Check if entryTitle is defined
  if (_.isUndefined(entryTitle)) {
    throw new InvalidArgument('Entry Title not supplied in configuration. Unable to construct path');
  }
  const nativeId = getNativeId(metadata);
  const path = `providers/${providerId}/collections/${entryTitle}/granules/${nativeId}`;

  return path;
}

/**
 * generateHyraxUrl
 *
 * @param {Object} event - the event
 * @param {Object} metadata - the metadata
 * @returns {string} - the hyrax url
 */
function generateHyraxUrl(event, metadata) {
  const environment = get(event.config, 'environment', 'prod');
  const url = new URL(`${generateAddress(environment)}/${generatePath(event, metadata)}`);
  return (url.href);
}

/**
 * addHyraxUrl
 *
 * @param {string} metadata - the orginal metadata
 * @param {URL} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrl(metadata, hyraxUrl) {
  let metadataObject = null;
  try {
    // Is this UMM-G or ECHO10?
    metadataObject = JSON.parse(metadata);
    if (_.isUndefined(metadataObject.umm.RelatedUrls)) {
      metadataObject.umm.RelatedUrls = [];
    }
    const url = {
      URL: hyraxUrl,
      Type: 'GET DATA',
      Subtype: 'OPENDAP DATA',
      Description: 'OPeNDAP request URL'
    };
    metadataObject.umm.RelatedUrls.push(url);
    return JSON.stringify(metadataObject, null, 2);
  } catch (e) {
    const xmlDoc = libxmljs.parseXmlString(metadata);

    let urlsNode = xmlDoc.get('/Granule/OnlineResources');
    if (_.isUndefined(urlsNode)) {
      const onlineAccessURLs = xmlDoc.get('/Granule/OnlineAccessURLs');
      urlsNode = new libxmljs.Element(xmlDoc, 'OnlineResources');
      onlineAccessURLs.addNextSibling(urlsNode);
    }
    urlsNode.node('OnlineResource').node('url', hyraxUrl).node('Description', 'OPeNDAP request URL').node('Type', 'GET DATA : OPENDAP DATA');

    return xmlDoc.toString();
  }
}

/**
 * Update each of the CMR files' OnlineAccessURL fields to represent the new
 * file locations.
 *
 * @param {Array<Object>} cmrFiles - array of objects that include CMR xmls uris and granuleIds
 * @param {Object} granulesObject - an object of the granules where the key is the granuleId
 * @param {string} cmrGranuleUrlType - type of granule CMR url
 * @param {string} distEndpoint - the api distribution endpoint
 * @param {BucketsConfig} bucketsConfig - BucketsConfig instance
 * @returns {Promise} promise resolves when all files have been updated
 **/
/* async function updateEachCmrFileAccessURLs(
  cmrFiles,
  granulesObject,
  cmrGranuleUrlType,
  distEndpoint,
  bucketsConfig
) {
  return Promise.all(cmrFiles.map(async (cmrFile) => {
    const granuleId = cmrFile.granuleId;
    const granule = granulesObject[granuleId];
    const updatedCmrFile = granule.files.find(isCMRFile);
    return updateCMRMetadata({
      granuleId,
      cmrFile: updatedCmrFile,
      files: granule.files,
      distEndpoint,
      published: false, // Do the publish in publish-to-cmr step
      inBuckets: bucketsConfig,
      cmrGranuleUrlType
    });
  }));
} */

/**
 * Do the work
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} the granules
 */
async function hyraxMetadataUpdate(event) {
  const granulesInput = event.input.granules;
  const cmrFiles = granulesToCmrFileObjects(granulesInput);
  
  // Update each metadata file with OPeNDAP url and write it back out to S3 in the same location.

  return {
    granules: granulesInput
  };
}

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(hyraxMetadataUpdate, event, context, callback);
}

exports.handler = handler;
exports.hyraxMetadataUpdate = hyraxMetadataUpdate; // exported to support testing
exports.generateAddress = generateAddress; // exported to support testing
exports.generatePath = generatePath; // exported to support testing
exports.getNativeId = getNativeId; // exported to support testing
exports.addHyraxUrl = addHyraxUrl; // exported to support testing
exports.generateHyraxUrl = generateHyraxUrl; // exported to support testing