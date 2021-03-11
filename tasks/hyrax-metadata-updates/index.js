'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { InvalidArgument } = require('@cumulus/errors');
const { promisify } = require('util');

const assoc = require('lodash/fp/assoc');
const get = require('lodash/get');
const cloneDeep = require('lodash/cloneDeep');

const {
  CMR,
} = require('@cumulus/cmr-client');

const {
  isECHO10File,
  isUMMGFile,
  isCMRFile,
  generateEcho10XMLString,
  getCmrSettings,
} = require('@cumulus/cmrjs/cmr-utils');

const { validateUMMG } = require('@cumulus/cmr-client/UmmUtils');
const validate = require('@cumulus/cmr-client/validate');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { s3 } = require('@cumulus/aws-client/services');
const {
  s3GetObjectTagging,
  s3PutObject,
  s3TagSetToQueryString,
  parseS3Uri,
  waitForObject,
} = require('@cumulus/aws-client/S3');

const xml2js = require('xml2js');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false,
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
  return encodeURIComponent(isUmmG ? metadata.GranuleUR : metadata.Granule.GranuleUR);
}

/**
 * getCollectionEntry
 *
 * @param {Object} config - configuration
 * @param {Object} metadata - the granule metadata
 * @param {boolean} isUmmG - whether this is UMM-G or ECHO10 metadata
 * @returns {Promise<string>} the collection url entry of the collection this granule
 *    belongs to
 */
async function getCollectionEntry(config, metadata, isUmmG) {
  let shortName;
  let versionId;
  if (isUmmG === true) {
    shortName = metadata.CollectionReference.ShortName;
    versionId = metadata.CollectionReference.Version;
  } else {
    shortName = metadata.Granule.Collection.ShortName;
    versionId = metadata.Granule.Collection.VersionId;
  }

  const cmrSettings = await getCmrSettings({
    ...config.cmr,
    ...config.launchpad,
  });

  // Query CMR for collection and retrieve entry title
  const cmrInstance = new CMR(cmrSettings);

  const searchParams = {
    short_name: shortName,
    version: versionId,
  };

  const result = await cmrInstance.searchCollections(searchParams);
  // Verify that we have a valid result. If we don't then something is badly wrong and we
  // should halt. Either the code is faulty or the provider is trying to ingest granules
  // into a collection that doesn't exist
  const conceptId = get(result, '[0].id');
  shortName = get(result, '[0].short_name');
  versionId = get(result, '[0].version_id');
  if (conceptId === undefined) {
    throw new RecordDoesNotExist(`Unable to query parent collection using short name ${shortName} and version ${versionId}`);
  }

  return (config.addShortnameAndVersionIdToConceptId !== undefined
    && config.addShortnameAndVersionIdToConceptId === true)
    ? `${conceptId}/${shortName}.${versionId}` : conceptId;
}

/**
 * generatePath
 *
 * @param {Object} config - the config
 * @param {Object} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @throws {Object} invalidArgumentException - if the env is not valid
 * @returns {Promise<string>} the OPeNDAP path
 */
async function generatePath(config, metadata, isUmmG) {
  const providerId = get(config.cmr, 'provider');
  // Check if providerId is defined
  if (providerId === undefined) {
    throw new InvalidArgument('Provider not supplied in configuration. Unable to construct path');
  }
  const entryCollection = await getCollectionEntry(config, metadata, isUmmG);

  return `collections/${entryCollection}/granules/${getGranuleUr(metadata, isUmmG)}`;
}

/**
 * generateHyraxUrl
 *
 * @param {Object} config - the config
 * @param {Object} metadata - the dom
 * @param {boolean} isUmmG - UMM-G or ECHO10
 * @returns {Promise<string>} the hyrax url
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

  if (metadataCopy.RelatedUrls === undefined) {
    metadataCopy.RelatedUrls = [];
  }
  const url = {
    URL: hyraxUrl,
    Type: 'USE SERVICE API',
    Subtype: 'OPENDAP DATA',
    Description: 'OPeNDAP request URL',
  };
  metadataCopy.RelatedUrls.push(url);

  return JSON.stringify(metadataCopy, undefined, 2);
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
    Type: 'GET DATA : OPENDAP DATA',
  };
  resourceUrls.push(url);

  metadataCopy.Granule.OnlineResources = {
    OnlineResource: resourceUrls,
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
 * @callback GranuleUpdater
 * @param {Object} - granule object containing a metadata file to update
 * @returns {Object} shallow copy of the specified granule, but with its
 *    metadata file updated with its currenty entity tag (`etag`) after updating
 *    it in S3 with a hyrax URL
 */

/**
 * updateSingleGranule
 *
 * @param {Object} config - configuration object with CMR information
 * @returns {GranuleUpdater} a function for updating a granule's metadata file
 *    with a hyrax URL
 */
const updateGranule = (config) => async (granule) => {
  // Read in the metadata file
  const metadataFile = granule.files.find(isCMRFile);
  // If there is no metadata file, error out.
  if (metadataFile === undefined) {
    throw new RecordDoesNotExist(
      `No recognizable CMR metadata file (*.cmr.xml or *.cmr.json) for granule ${granule.granuleId}`
    );
  }
  const { Bucket, Key } = parseS3Uri(metadataFile.filename);
  const etag = metadataFile.etag;
  const params = etag ? { Bucket, Key, IfMatch: etag } : { Bucket, Key };
  const metadataResult = await waitForObject(s3(), params, { retries: 5 });

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
  const { ETag: newEtag } = await s3PutObject({
    Bucket,
    Key,
    Body: updatedMetadata,
    ContentType: metadataResult.ContentType,
    Tagging: s3TagSetToQueryString(tags.TagSet),
  });

  return {
    ...granule,
    files: granule.files.map(
      (file) => (file === metadataFile ? assoc('etag', newEtag, file) : file)
    ),
  };
};

/**
 * Update the metadata of each granule with an OPeNDAP data acquisition URL.
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} the granules
 */
async function hyraxMetadataUpdate({ config, input }) {
  return {
    granules: await Promise.all(input.granules.map(updateGranule(config))),
  };
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return cumulusMessageAdapter.runCumulusTask(hyraxMetadataUpdate, event, context);
}

exports.handler = handler;
exports.hyraxMetadataUpdate = hyraxMetadataUpdate;
