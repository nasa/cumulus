'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { InvalidArgument } = require('@cumulus/errors');

const get = require('lodash.get');
const _ = require('lodash/core');
const cloneDeep = require('lodash.clonedeep');

const {
  CMR
} = require('@cumulus/cmr-client');

const { validateUMMG } = require('@cumulus/cmr-client/UmmUtils');
const validate = require('@cumulus/cmr-client/validate');
const ValidationError = require('@cumulus/cmr-client/ValidationError');

const {
  getS3Object,
  s3PutObject,
  buildS3Uri,
  parseS3Uri
} = require('@cumulus/aws-client/S3');

const libxmljs = require('libxmljs');

/**
 * generateAddress
 *
 * @throws {InvalidArgument} if the env is not valid
 * @returns {string} - the corresponding OPeNDAP address
 */
function generateAddress() {
  const env = process.env.CMR_ENVIRONMENT ? process.env.CMR_ENVIRONMENT.toLowerCase() : 'prod';

  let envSubstition = env;
  if (['prod', 'ops', 'uat', 'sit'].includes(env)) {
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
    nativeId = metadata.GranuleUR;
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
    shortName = metadata.CollectionReference.ShortName;
    version = metadata.CollectionReference.Version;
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
async function generatePath(config, metadata, isUmmG) {
  const providerId = get(config.cmr, 'provider');
  // Check if providerId is defined
  if (_.isUndefined(providerId)) {
    throw new InvalidArgument('Provider not supplied in configuration. Unable to construct path');
  }
  const entryTitle = await getEntryTitle(config, metadata, isUmmG);
  return `providers/${providerId}/collections/${entryTitle}/granules/${getGranuleUr(metadata, isUmmG)}`;
}

/**
 * generateHyraxUrl
 *
 * @param {Object} config - the config
 * @param {string} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @returns {string} - the hyrax url
 */
async function generateHyraxUrl(config, metadata, isUmmG) {
  const path = await generatePath(config, metadata, isUmmG);
  const url = new URL(`${generateAddress()}/${path}`);
  return (url.href);
}

/**
 * addHyraxUrlToUmmG
 *
 * @param {string} metadata - the metadata dom
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrlToUmmG(metadata, hyraxUrl) {
  const metadataCopy = cloneDeep(metadata);

  if (_.isUndefined(metadataCopy.RelatedUrls)) {
    metadataCopy.RelatedUrls = [];
  }
  const url = {
    URL: hyraxUrl,
    Type: 'GET DATA',
    Subtype: 'OPENDAP DATA',
    Description: 'OPeNDAP request URL'
  };
  metadataCopy.RelatedUrls.push(url);

  return JSON.stringify(metadataCopy, null, 2);
}

/**
 * addHyraxUrlToEcho10
 *
 * @param {string} metadata - the metadata dom
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrlToEcho10(metadata, hyraxUrl) {
  let urlsNode = metadata.get('/Granule/OnlineResources');
  if (_.isUndefined(urlsNode)) {
    const onlineAccessURLs = metadata.get('/Granule/OnlineAccessURLs');
    urlsNode = new libxmljs.Element(metadata, 'OnlineResources');
    onlineAccessURLs.addNextSibling(urlsNode);
  }
  urlsNode.node('OnlineResource')
    .node('URL', hyraxUrl)
    .parent()
    .node('Description', 'OPeNDAP request URL')
    .parent()
    .node('Type', 'GET DATA : OPENDAP DATA');

  return metadata.toString({ format: true });
}

/**
 * addHyraxUrl
 *
 * @param {string} metadata - the original metadata dom
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

// TODO: these are not exported from cmr-utils.js yet
const isECHO10File = (filename) => filename.endsWith('cmr.xml');
const isUMMGFile = (filename) => filename.endsWith('cmr.json');

/**
 * createDom
 *
 * @param {Object} metadataFileName file name
 * @param {Object} metadata - raw metadata
 * @returns {Object} document object model and whether it is UMM-G
 */
function createDom(metadataFileName, metadata) {
  let isUmmG = false;
  // Parse into DOM based on file extension
  let dom = null;
  if (isUMMGFile(metadataFileName)) {
    dom = JSON.parse(metadata);
    isUmmG = true;
  } else if (isECHO10File(metadataFileName)) {
    dom = libxmljs.parseXml(metadata);
  } else {
    throw new InvalidArgument(`Metadata file ${metadataFileName} is in unknown format`);
  }
  return { dom, isUmmG };
}

/**
 * updateSingleGranule
 *
 * @param {Object} config
 * @param {Object} granuleObject - granule files object
 * @returns {Object} metadata
 */
async function updateSingleGranule(config, granuleObject) {
  // Read in the metadata file
  const metadataFile = granuleObject.files.find((f) => f.type === 'metadata');
  const bucket = `${metadataFile.bucket}/${metadataFile.fileStagingDir}`;
  const metadataResult = await getS3Object(bucket, metadataFile.name);
  // Extract the metadata file object
  const metadata = metadataResult.Body.toString();
  const { dom, isUmmG } = createDom(metadataFile.name, metadata);
  // Add OPeNDAP url
  const hyraxUrl = await generateHyraxUrl(config, dom, isUmmG);
  const updatedMetadata = addHyraxUrl(dom, isUmmG, hyraxUrl);
  // Validate updated metadata via CMR
  try {
    if (isUmmG) {
      await validateUMMG(JSON.parse(updatedMetadata), metadataFile.name, config.cmr.provider);
    } else {
      const result = await validate('granule', updatedMetadata, metadataFile.name, config.cmr.provider);
      if (!result) {
        throw new ValidationError(`Validation of metadata for ${metadataFile.name} failed`);
      }
    }
  } catch (e) {
    throw new ValidationError(`Validation of metadata for ${metadataFile.name} failed`);
  }

  // Write back out to S3 in the same location
  await s3PutObject({
    Bucket: bucket,
    Key: metadataFile.name,
    Body: updatedMetadata
  });
}

/**
 * Update the metadata of each granule with an OPeNDAP data acquisition URL.
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} the granules
 */
async function hyraxMetadataUpdate(event) {
  const granulesInput = event.input.granules;

  await Promise.all(
    granulesInput.map((granuleObject) => updateSingleGranule(event.config, granuleObject))
  );
  // We don't create anything, we just update existing metadata. So we return what we got.
  return {
    granules: event.input.granules
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
exports.updateSingleGranule = updateSingleGranule; // export to support testing
