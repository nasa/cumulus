'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { InvalidArgument } = require('@cumulus/errors');
const { promisify } = require('util');

const cloneDeep = require('lodash/cloneDeep');
const curry = require('lodash/curry');
const get = require('lodash/get');
const isEqual = require('lodash/isEqual');
const isUndefined = require('lodash/isUndefined');
const keys = require('lodash/keys');
const omitBy = require('lodash/omitBy');
const some = require('lodash/some');

const {
  CMR,
} = require('@cumulus/cmr-client');

const {
  addEtagsToFileObjects,
  isECHO10Filename,
  isUMMGFilename,
  isCMRFile,
  generateEcho10XMLString,
  getCmrSettings,
  getFilename,
  getS3UrlOfFile,
  removeEtagsFromFileObjects,
} = require('@cumulus/cmrjs/cmr-utils');

const { validateUMMG } = require('@cumulus/cmr-client/UmmUtils');
const validate = require('@cumulus/cmr-client/validate');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { s3 } = require('@cumulus/aws-client/services');
const {
  s3GetObjectTagging,
  s3PutObject,
  s3TagSetToQueryString,
  waitForObject,
  getObjectStreamContents,
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
 * getCmrSearchParams
 *
 * @param {Object} options - Options
 * @param {string} options.datasetId - collection dataset ID
 * @param {string} options.shortName - collection short name (requires versionId)
 * @param {string} options.versionId - collection version (requires shortName)
 * @returns {Object} searchParams, keys are either ['dataset_id'] or ['short_name', 'version']
 * @returns {string} searchParams.dataset_id - collection dataset ID
 * @returns {string} searchParams.short_name - collection short name
 * @returns {string} searchParams.version - collection version
 */
function getCmrSearchParams({ datasetId, shortName, versionId }) {
  const searchParams = omitBy({
    dataset_id: datasetId,
    short_name: shortName,
    version: versionId,
  }, isUndefined);

  const validKeys = [['short_name', 'version'], ['dataset_id']];
  if (!some(validKeys, curry(isEqual)(keys(searchParams)))) {
    throw new Error(`Invalid list of keys for searchParams: ${keys(searchParams)}`);
  }

  return searchParams;
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
  let datasetId;
  let shortName;
  let versionId;
  if (isUmmG === true) {
    datasetId = metadata.CollectionReference.EntryTitle;
    shortName = metadata.CollectionReference.ShortName;
    versionId = metadata.CollectionReference.Version;
  } else {
    datasetId = metadata.Granule.Collection.DataSetId;
    shortName = metadata.Granule.Collection.ShortName;
    versionId = metadata.Granule.Collection.VersionId;
  }

  const cmrSettings = await getCmrSettings({
    ...config.cmr,
    ...config.launchpad,
  });

  // Query CMR for collection and retrieve entry title
  const cmrInstance = new CMR(cmrSettings);

  const searchParams = getCmrSearchParams({
    datasetId,
    shortName,
    versionId,
  });

  const result = await cmrInstance.searchCollections(searchParams);

  // Verify that we have a valid result. If we don't then something is badly wrong and we
  // should halt. Either the code is faulty or the provider is trying to ingest granules
  // into a collection that doesn't exist
  const conceptId = get(result, '[0].id');
  if (conceptId === undefined) {
    throw new RecordDoesNotExist(`Unable to query parent collection using: ${JSON.stringify(searchParams)}`);
  }

  if (searchParams.version !== undefined && config.addShortnameAndVersionIdToConceptId === true) {
    shortName = get(result, '[0].short_name');
    versionId = get(result, '[0].version_id');
    return `${conceptId}/${shortName}.${versionId}`;
  }
  return conceptId;
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

  for (const relatedUrl of metadataCopy.RelatedUrls) {
    if (isEqual(relatedUrl, url)) {
      return JSON.stringify(metadataCopy, undefined, 2);
    }
  }

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

  for (const resourceUrl of resourceUrls) {
    if (isEqual(resourceUrl, url)) {
      return generateEcho10XMLString(metadata.Granule);
    }
  }

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
  if (isUMMGFilename(metadataFileName)) {
    metadataObject = JSON.parse(metadata);
    isUmmG = true;
  } else if (isECHO10Filename(metadataFileName)) {
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
  const { etags = {} } = config;
  addEtagsToFileObjects(granule, etags);
  // Read in the metadata file
  const metadataFile = granule.files.find(isCMRFile);
  if (metadataFile === undefined) {
    if (config.skipMetadataCheck) return { granule, etags };
    throw new RecordDoesNotExist(
      `No recognizable CMR metadata file (*.cmr.xml or *.cmr.json) for granule ${granule.granuleId}. Set config.skipMetadataCheck to true to silence this error.`
    );
  }
  const { bucket: Bucket, key: Key } = metadataFile;
  const metadataFileName = getFilename(metadataFile);
  const etag = etags[getS3UrlOfFile(metadataFile)];
  const params = etag ? { Bucket, Key, IfMatch: etag } : { Bucket, Key };
  const metadataResult = await waitForObject(s3(), params, { retries: 5 });

  const tags = await s3GetObjectTagging(Bucket, Key);

  // Extract the metadata file object
  const metadata = await getObjectStreamContents(metadataResult.Body);
  const { metadataObject, isUmmG } = await getMetadataObject(metadataFileName, metadata);
  // Add OPeNDAP url
  const hyraxUrl = await generateHyraxUrl(config, metadataObject, isUmmG);
  const updatedMetadata = addHyraxUrl(metadataObject, isUmmG, hyraxUrl);
  // Validate updated metadata via CMR
  if (!config.skipMetadataValidation) {
    if (isUmmG) {
      await validateUMMG(JSON.parse(updatedMetadata), metadataFileName, config.cmr.provider);
    } else {
      await validate('granule', updatedMetadata, metadataFileName, config.cmr.provider);
    }
  }
  // Write back out to S3 in the same location
  const { ETag: newEtag } = await s3PutObject({
    Bucket,
    Key,
    Body: updatedMetadata,
    ContentType: metadataResult.ContentType,
    Tagging: s3TagSetToQueryString(tags.TagSet),
  });

  removeEtagsFromFileObjects(granule);
  return {
    granule,
    etags: {
      [getS3UrlOfFile(metadataFile)]: newEtag,
    },
  };
};

/**
 * Update the metadata of each granule with an OPeNDAP data acquisition URL.
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} the granules
 */
async function hyraxMetadataUpdate({ config, input }) {
  const outputs = await Promise.all(input.granules.map(updateGranule(config)));
  return {
    granules: outputs.map((o) => o.granule),
    etags: {
      ...outputs.reduce((etags, o) => ({ ...etags, ...(o.etags) }), config.etags),
    },
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
  return await cumulusMessageAdapter.runCumulusTask(hyraxMetadataUpdate, event, context);
}

exports.handler = handler;
exports.hyraxMetadataUpdate = hyraxMetadataUpdate;
