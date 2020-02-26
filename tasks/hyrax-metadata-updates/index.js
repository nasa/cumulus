'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { InvalidArgument } = require('@cumulus/errors');

const get = require('lodash.get');
const _ = require('lodash/core');

const { CMR } = require('@cumulus/cmr-client');
//const { CMRUtil } = require('@cumulus/cmr-util');

const libxmljs = require('libxmljs');

/**
 * generateAddress
 *
 * @throws {InvalidArgument} if the env is not valid
 * @returns {string} - the corresponding OPeNDAP address
 */
function generateAddress() {
  let env = process.env.CMR_ENVIRONMENT;

  if (_.isUndefined(env)) {
    env = 'prod';
  } else {
    env = env.toLowerCase();
  }
  const validEnvs = ['prod', 'ops', 'uat', 'sit'];
  let envSubstition = env;
  if (validEnvs.includes(env)) {
    envSubstition = ((env === 'prod' || env === 'ops') ? '' : `${env}.`);
  } else {
    // Throw an exception if it is not a valid environment
    throw new InvalidArgument(`Environment ${env} is not a valid environment.`);
  }
  return (`https://opendap.${envSubstition}earthdata.nasa.gov`);
}

/**
 * getGranuleUr
 *
 * @param {string} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @returns {string} - the native id
 */
function getGranuleUr(metadata, isUmmG) {
  let nativeId = null;
  if (isUmmG === true) {
    try {
      nativeId = metadata.umm.GranuleUR;
    } catch (e) {
      throw new InvalidArgument('UMM-G metadata record is not a valid JSON document');
    }
  } else {
    const nativeIdNode = metadata.get('/Granule/GranuleUR');
    nativeId = nativeIdNode.text();
  }
  return nativeId;
}

/**
 * getEntryTitle
 *
 * @param {Object} config - comnfiguration
 * @param {string} metadata - the granule metadata
 * @param {boolean} isUmmG - whether this is UMM-G or ECHO10 metadata
 * @returns {string} the entry title of the collection this granule belongs to
 */
async function getEntryTitle(config, metadata, isUmmG) {
  let shortName = null;
  let version = null;
  if (isUmmG === true) {
    try {
      shortName = metadata.umm.CollectionReference.ShortName;
      version = metadata.umm.CollectionReference.Version;
    } catch (e) {
      throw new InvalidArgument('UMM-G metadata record is not a valid JSON document');
    }
  } else {
    shortName = metadata.get('/Granule/Collection/ShortName').text();
    version = metadata.get('/Granule/Collection/VersionId').text();
  }
  // Query CMR for collection and retrieve entry title
  const cmrInstance = new CMR({
    provider: config.cmr.provider,
    username: config.cmr.username,
    password: config.cmr.passwordSecretName
  });

  const searchParams = {
    short_name: shortName,
    version: version
  };

  const result = await cmrInstance.searchCollections(searchParams);
  return result[0].dataset_id;
}

/**
 * generatePath
 *
 * @param {Object} config - the config
 * @param {string} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @throws {Object} invalidArgumentException - if the env is not valid
 * @returns {string} - the OPeNDAP path
 */
function generatePath(config, metadata, isUmmG) {
  const providerId = get(config.cmr, 'provider');
  // Check if providerId is defined
  if (_.isUndefined(providerId)) {
    throw new InvalidArgument('Provider not supplied in configuration. Unable to construct path');
  }
  const entryTitle = get(config, 'entryTitle');
  // Check if entryTitle is defined
  if (_.isUndefined(entryTitle)) {
    throw new InvalidArgument('Entry Title not supplied in configuration. Unable to construct path');
  }
  const nativeId = getGranuleUr(metadata, isUmmG);

  return `providers/${providerId}/collections/${entryTitle}/granules/${nativeId}`;
}

/**
 * generateHyraxUrl
 *
 * @param {Object} config - the config
 * @param {string} metadata - the metadata
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @returns {string} - the hyrax url
 */
function generateHyraxUrl(config, metadata, isUmmG) {
  const url = new URL(`${generateAddress()}/${generatePath(config, metadata, isUmmG)}`);
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
  const xmlDoc = libxmljs.parseXml(metadata);

  let urlsNode = xmlDoc.get('/Granule/OnlineResources');
  if (_.isUndefined(urlsNode)) {
    const onlineAccessURLs = xmlDoc.get('/Granule/OnlineAccessURLs');
    urlsNode = new libxmljs.Element(xmlDoc, 'OnlineResources');
    onlineAccessURLs.addNextSibling(urlsNode);
  }
  urlsNode.node('OnlineResource')
    .node('url', hyraxUrl)
    .parent()
    .node('Description', 'OPeNDAP request URL')
    .parent()
    .node('Type', 'GET DATA : OPENDAP DATA');

  return xmlDoc.toString({ format: true });
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
 * updateSingleGranule
 *
 * @param {Object} config
 * @param {Object} granuleMetadataFile - input granule
 */
/* async function updateSingleGranule(config, granuleMetadataFile) {
  const cmrfilename = granuleMetadataFile.key || granuleMetadataFile.name || granuleMetadataFile.filename || '';
  // Read in the metadata file
  const metadata = null;
  let isUmmG = false;
  // Parse into DOM based on file extension
  let dom = null;
  if (CMRUtil.isUMMGFile(cmrfilename)) {
    dom = libxmljs.parseXml(metadata);
    isUmmG = true;
  } else if (CMRUtil.isECHO10File(cmrfilename)) {
    dom = JSON.parse(metadata);
  }

  // Add OPeNDAP url
  const hyraxUrl = generateHyraxUrl(event, dom, isUmmG);
  const updatedMetadata = addHyraxUrl(dom, isUmmG, hyraxUrl);
  // Validate via CMR
  // Write back out to S3 in the same location
} */

/**
 * Do the work
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} the granules
 */
async function hyraxMetadataUpdate(event) {
  const granulesInput = event.input.granules;
  // isCMRFilename
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
exports.getNativeId = getGranuleUr; // exported to support testing
exports.addHyraxUrl = addHyraxUrl; // exported to support testing
exports.generateHyraxUrl = generateHyraxUrl; // exported to support testing
exports.getEntryTitle = getEntryTitle; // exported to support testing