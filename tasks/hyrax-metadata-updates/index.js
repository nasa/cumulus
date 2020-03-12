'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { InvalidArgument } = require('@cumulus/errors');
const { promisify } = require('util');

const get = require('lodash.get');
const isUndefined = require('lodash.isundefined');
const cloneDeep = require('lodash.clonedeep');

const {
  CMR
} = require('@cumulus/cmr-client');

const {
  isECHO10File,
  isUMMGFile,
  isCMRFilename,
  generateEcho10XMLString
} = require('@cumulus/cmrjs/cmr-utils');


const { validateUMMG } = require('@cumulus/cmr-client/UmmUtils');
const validate = require('@cumulus/cmr-client/validate');
const { RecordDoesNotExist } = require('@cumulus/errors');

const {
  getS3Object,
  s3GetObjectTagging,
  s3PutObject,
  s3TagSetToQueryString,
  parseS3Uri
} = require('@cumulus/aws-client/S3');

const xml2js = require('xml2js');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

/**
 * generateAddress
 *
 * @throws {InvalidArgument} if the env is not valid
 * @returns {string} - the corresponding OPeNDAP address
 */
function generateAddress() {
  const env = process.env.CMR_ENVIRONMENT ? process.env.CMR_ENVIRONMENT.toLowerCase() : 'prod';

  let envSubstition;
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
 * @param {Object} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @returns {string} - the native id
 */
function getGranuleUr(metadata, isUmmG) {
  return isUmmG ? metadata.GranuleUR : metadata.Granule.GranuleUR;
}

/**
 * getEntryTitle
 *
 * @param {Object} config - comnfiguration
 * @param {Object} metadata - the granule metadata
 * @param {boolean} isUmmG - whether this is UMM-G or ECHO10 metadata
 * @returns {string} the entry title of the collection this granule belongs to
 */
async function getEntryTitle(config, metadata, isUmmG) {
  let shortName;
  let version;
  if (isUmmG === true) {
    shortName = metadata.CollectionReference.ShortName;
    version = metadata.CollectionReference.Version;
  } else {
    shortName = metadata.Granule.Collection.ShortName;
    version = metadata.Granule.Collection.VersionId;
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
  // Verify that we have a valid result. If we don't then something is badly wrong
  // and we should halt.
  // Either the code is faulty or the provider is trying to ingest granules
  // into a collection that doesn't exist
  if (result.length === 0 || isUndefined(result[0].dataset_id)) {
    throw new RecordDoesNotExist(`Unable to query parent collection entry title using short name ${shortName} and version ${version}`);
  }
  return result[0].dataset_id;
}

/**
 * generatePath
 *
 * @param {Object} config - the config
 * @param {Object} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @throws {Object} invalidArgumentException - if the env is not valid
 * @returns {string} - the OPeNDAP path
 */
async function generatePath(config, metadata, isUmmG) {
  const providerId = get(config.cmr, 'provider');
  // Check if providerId is defined
  if (isUndefined(providerId)) {
    throw new InvalidArgument('Provider not supplied in configuration. Unable to construct path');
  }
  const entryTitle = await getEntryTitle(config, metadata, isUmmG);
  return `providers/${providerId}/collections/${entryTitle}/granules/${getGranuleUr(metadata, isUmmG)}`;
}

/**
 * generateHyraxUrl
 *
 * @param {Object} config - the config
 * @param {Object} metadata - the dom
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
 * @param {Object} metadata - the metadata dom
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrlToUmmG(metadata, hyraxUrl) {
  const metadataCopy = cloneDeep(metadata);

  if (isUndefined(metadataCopy.RelatedUrls)) {
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
 * @param {Object} metadata - the metadata dom
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrlToEcho10(metadata, hyraxUrl) {
  const metadataCopy = cloneDeep(metadata);

  // xml2js will model a single child as an element rather than a list so
  // we have to defend against that by reconstructing OnlineResources as
  // a list from scratch
  delete metadataCopy.Granule.OnlineResources;

  const existingResourceUrls = get(metadata, 'Granule.OnlineResources.OnlineResource', []);
  const resourceUrls = Array.isArray(existingResourceUrls)
    ? existingResourceUrls
    : [existingResourceUrls];

  const url = {
    URL: hyraxUrl,
    Description: 'OPeNDAP request URL',
    Type: 'GET DATA : OPENDAP DATA'
  };
  resourceUrls.push(url);

  metadataCopy.Granule.OnlineResources = {
    OnlineResource: resourceUrls
  };

  return generateEcho10XMLString(metadataCopy.Granule);
}

/**
 * addHyraxUrl
 *
 * @param {Object} metadata - the original metadata dom
 * @param {boolean} isUmmG - UMM-G or ECHO10 metadata
 * @param {string} hyraxUrl - the hyrax url
 * @returns {string} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrl(metadata, isUmmG, hyraxUrl) {
  return isUmmG ? addHyraxUrlToUmmG(metadata, hyraxUrl) : addHyraxUrlToEcho10(metadata, hyraxUrl);
}

/**
 * getMetadataObject
 *
 * @param {Object} metadataFileName file name
 * @param {string} metadata - raw metadata
 * @returns {Object} metadata as a JS object and whether it is UMM-G
 */
async function getMetadataObject(metadataFileName, metadata) {
  let isUmmG = false;
  // Parse into DOM based on file extension
  let metadataObject;
  if (isUMMGFile(metadataFileName)) {
    metadataObject = JSON.parse(metadata);
    isUmmG = true;
  } else if (isECHO10File(metadataFileName)) {
    metadataObject = await (promisify(xml2js.parseString))(metadata, xmlParseOptions);
  } else {
    throw new InvalidArgument(`Metadata file ${metadataFileName} is in unknown format`);
  }
  return { metadataObject, isUmmG };
}

/**
 * updateSingleGranule
 *
 * @param {Object} config
 * @param {Object} granuleObject - granule files object
 */
async function updateSingleGranule(config, granuleObject) {
  // Read in the metadata file
  const metadataFile = granuleObject.files.find((f) => isCMRFilename(f.filename));
  // If there is no metadata file, error out.
  if (isUndefined(metadataFile)) {
    throw new RecordDoesNotExist('There is no recogizable CMR metadata file in this granule object (*.cmr.xml or *.cmr.json)');
  }
  const { Bucket, Key } = parseS3Uri(metadataFile.filename);
  const metadataResult = await getS3Object(Bucket, Key);

  const tags = await s3GetObjectTagging(Bucket, Key);

  // Extract the metadata file object
  const metadata = metadataResult.Body.toString();
  const { metadataObject, isUmmG } = await getMetadataObject(metadataFile.name, metadata);
  // Add OPeNDAP url
  const hyraxUrl = await generateHyraxUrl(config, metadataObject, isUmmG);
  const updatedMetadata = addHyraxUrl(metadataObject, isUmmG, hyraxUrl);
  // Validate updated metadata via CMR
  if (isUmmG) {
    await validateUMMG(JSON.parse(updatedMetadata), metadataFile.name, config.cmr.provider);
  } else {
    await validate('granule', updatedMetadata, metadataFile.name, config.cmr.provider);
  }
  // Write back out to S3 in the same location
  await s3PutObject({
    Bucket: Bucket,
    Key: Key,
    Body: updatedMetadata,
    ContentType: metadataResult.ContentType,
    Tagging: s3TagSetToQueryString(tags.TagSet)
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
exports.hyraxMetadataUpdate = hyraxMetadataUpdate;
