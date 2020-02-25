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

const libxmljs = require('libxmljs');

const isECHO10File = (filename) => filename.endsWith('cmr.xml');
const isUMMGFile = (filename) => filename.endsWith('cmr.json');

/**
 * generateAddress
 *
 * @param {string} env - the environment retrieved from configuration
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
  // TODO switch on file type
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
 * @param {string} metadata - the metadata
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

  return `providers/${providerId}/collections/${entryTitle}/granules/${nativeId}`;
}

/**
 * generateHyraxUrl
 *
 * @param {Object} event - the event
 * @param {string} metadata - the metadata
 * @returns {string} - the hyrax url
 */
function generateHyraxUrl(event, metadata) {
  const environment = get(event.config, 'environment', 'prod');
  const url = new URL(`${generateAddress(environment)}/${generatePath(event, metadata)}`);
  return (url.href);
}

/**
 * addHyraxUrlToUmmG
 *
 * @param {string} metadata - the orginal metadata
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrlToUmmG(metadata, hyraxUrl) {
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
  } catch (e) {
    throw new InvalidArgument('UMM-G metadata record is not a valid JSON document');
  }
  return JSON.stringify(metadataObject, null, 2);
}

/**
 * addHyraxUrlToEcho10
 *
 * @param {string} metadata - the orginal metadata
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrlToEcho10(metadata, hyraxUrl) {
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

/**
 * addHyraxUrl
 *
 * @param {string} metadata - the orginal metadata
 * @param {boolean} isUmmG - UMM-G or ECHO10 metadata
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrl(metadata, isUmmG, hyraxUrl) {
  let updatedMetadata = null;
  if (isUmmG === true) {
    updatedMetadata = addHyraxUrlToUmmG(metadata, hyraxUrl);
  } else {
    updatedMetadata = addHyraxUrlToEcho10(metadata, hyraxUrl);
  }
  return updatedMetadata;
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

  // Read in each metadata file - metadataObjectFromCMRFile 
  // Add OPeNDAP url
  // Validate via CMR
  // Write back out to S3 in the same location

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