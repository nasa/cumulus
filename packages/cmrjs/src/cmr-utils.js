'use strict';

const got = require('got');
const get = require('lodash/get');
const pick = require('lodash/pick');
const set = require('lodash/set');
const { promisify } = require('util');
const js2xmlParser = require('js2xmlparser');
const path = require('path');
const urljoin = require('url-join');
const xml2js = require('xml2js');
const {
  buildS3Uri,
  parseS3Uri,
  promiseS3Upload,
  s3GetObjectTagging,
  s3TagSetToQueryString,
  waitForObject,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const launchpad = require('@cumulus/launchpad-auth');
const log = require('@cumulus/common/log');
const omit = require('lodash/omit');
const errors = require('@cumulus/errors');
const { CMR, getSearchUrl, ummVersion } = require('@cumulus/cmr-client');

const {
  xmlParseOptions,
  ummVersionToMetadataFormat,
} = require('./utils');

function getS3KeyOfFile(file) {
  if (file.filename) return parseS3Uri(file.filename).Key;
  if (file.filepath) return file.filepath;
  if (file.key) return file.key;
  throw new Error(`Unable to determine s3 key of file: ${JSON.stringify(file)}`);
}

function getS3UrlOfFile(file) {
  if (file.filename) return file.filename;
  if (file.bucket && file.filepath) return buildS3Uri(file.bucket, file.filepath);
  if (file.bucket && file.key) return buildS3Uri(file.bucket, file.key);
  throw new Error(`Unable to determine location of file: ${JSON.stringify(file)}`);
}

function getFilename(file) {
  if (file.fileName) return file.fileName;
  if (file.name) return file.name;
  if (file.filename) return path.basename(file.filename);
  if (file.filepath) return path.basename(file.filepath);
  if (file.key) return path.basename(file.key);
  return undefined;
}

function getFileDescription(file) {
  const filename = getFilename(file);
  return filename ? `Download ${filename}` : 'File to download';
}

const isECHO10File = (filename) => filename.endsWith('cmr.xml');
const isUMMGFile = (filename) => filename.endsWith('cmr.json');
const isCMRFilename = (filename) => isECHO10File(filename) || isUMMGFile(filename);

const constructCmrConceptLink = (conceptId, extension) => `${getSearchUrl()}concepts/${conceptId}.${extension}`;

/**
 * Returns True if this object can be determined to be a cmrMetadata object.
 *
 * @param {Object} fileobject
 * @returns {boolean} true if object references cmr metadata.
 */
function isCMRFile(fileobject) {
  const cmrfilename = fileobject.key || fileobject.name || fileobject.filename || '';
  return isCMRFilename(cmrfilename);
}

/**
 * Extracts CMR file objects from the specified granule object.
 *
 * @param {Object} granule - granule object containing CMR files within its
 *    `files` property
 * @returns {Array<Object>} an array of CMR file objects, each with properties
 *    `granuleId`, `filename`, and possibly `etag` (if present on input)
 */
function granuleToCmrFileObject(granule) {
  return granule.files
    .filter(isCMRFile)
    .map((file) => ({
      // Include etag only if file has one
      ...pick(file, 'etag'),
      // handle both new-style and old-style files model
      filename: file.key ? buildS3Uri(file.bucket, file.key) : file.filename,
      granuleId: granule.granuleId,
    }));
}

/**
 * Reduce granule object array to CMR files array
 *
 * @param {Array<Object>} granules - granule objects array
 *
 * @returns {Array<Object>} - CMR file object array: { filename, granuleId }
 */
function granulesToCmrFileObjects(granules) {
  return granules.flatMap(granuleToCmrFileObject);
}

/**
 * Posts CMR XML files from S3 to CMR.
 *
 * @param {Object} cmrFile - an object representing the cmr file
 * @param {string} cmrFile.granuleId - the granuleId of the cmr xml File
 * @param {string} cmrFile.filename - the s3 uri to the cmr xml file
 * @param {string} cmrFile.metadata - granule xml document
 * @param {Object} cmrClient - a CMR instance
 * @param {string} revisionId - Optional CMR Revision ID
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publishECHO10XML2CMR(cmrFile, cmrClient, revisionId) {
  const builder = new xml2js.Builder();
  const xml = builder.buildObject(cmrFile.metadataObject);
  const res = await cmrClient.ingestGranule(xml, revisionId);
  const conceptId = res.result['concept-id'];
  let resultLog = `Published ${cmrFile.granuleId} to the CMR. conceptId: ${conceptId}`;

  if (revisionId) resultLog += `, revisionId: ${revisionId}`;
  log.info(resultLog);

  return {
    granuleId: cmrFile.granuleId,
    filename: getS3UrlOfFile(cmrFile),
    conceptId,
    metadataFormat: 'echo10',
    link: constructCmrConceptLink(conceptId, 'echo10'),
  };
}

/**
 * Posts CMR JSON files from S3 to CMR.
 *
 * @param {Object} cmrFile - an object representing the CMR file
 * @param {string} cmrFile.filename - the cmr filename
 * @param {Object} cmrFile.metadataObject - the UMMG JSON cmr metadata
 * @param {Object} cmrFile.granuleId - the metadata's granuleId
 * @param {Object} cmrClient - a CMR instance
 * @param {string} revisionId - Optional CMR Revision ID
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publishUMMGJSON2CMR(cmrFile, cmrClient, revisionId) {
  const granuleId = cmrFile.metadataObject.GranuleUR;
  const res = await cmrClient.ingestUMMGranule(cmrFile.metadataObject, revisionId);
  const conceptId = res['concept-id'];

  const filename = getS3UrlOfFile(cmrFile);
  const metadataFormat = ummVersionToMetadataFormat(ummVersion(cmrFile.metadataObject));
  const link = constructCmrConceptLink(conceptId, 'umm_json');
  let resultLog = `Published UMMG ${granuleId} to the CMR. conceptId: ${conceptId}`;

  if (revisionId) resultLog += `, revisionId: ${revisionId}`;
  log.info(resultLog);

  return {
    granuleId,
    filename,
    conceptId,
    metadataFormat,
    link,
  };
}

/**
 * Determines what type of metadata object and posts either ECHO10XML or UMMG
 * JSON data to CMR.
 *
 * @param {Object} cmrPublishObject -
 * @param {string} cmrPublishObject.filename - the cmr filename
 * @param {Object} cmrPublishObject.metadataObject - the UMMG JSON cmr metadata
 * @param {Object} cmrPublishObject.granuleId - the metadata's granuleId
 * @param {Object} creds - credentials needed to post to CMR service
 * @param {string} creds.provider - the name of the Provider used on the CMR side
 * @param {string} creds.clientId - the clientId used to generate CMR token
 * @param {string} creds.username - the CMR username, not used if creds.token is provided
 * @param {string} creds.password - the CMR password, not used if creds.token is provided
 * @param {string} creds.token - the CMR or Launchpad token,
 * @param {string} cmrRevisionId - Optional CMR Revision ID
 * if not provided, CMR username and password are used to get a cmr token
 */
async function publish2CMR(cmrPublishObject, creds, cmrRevisionId) {
  const cmrClient = new CMR(creds);

  // choose xml or json and do the things.
  if (isECHO10File(cmrPublishObject.filename)) {
    return publishECHO10XML2CMR(cmrPublishObject, cmrClient, cmrRevisionId);
  }
  if (isUMMGFile(cmrPublishObject.filename)) {
    return publishUMMGJSON2CMR(cmrPublishObject, cmrClient, cmrRevisionId);
  }

  throw new Error(`invalid cmrPublishObject passed to publis2CMR ${JSON.stringify(cmrPublishObject)}`);
}

/**
 * Returns the S3 object identified by the specified S3 URI and (optional)
 * entity tag, retrying up to 5 times, if necessary.
 *
 * @param {string} filename - S3 URI of the desired object
 * @param {string|undefined} [etag] - entity tag of the desired object (optional)
 * @returns {Promise} result of `AWS.S3.getObject()` as a Promise
 */
function getObjectByFilename(filename, etag) {
  const { Bucket, Key } = parseS3Uri(filename);

  const params = etag
    ? { Bucket, Key, IfMatch: etag }
    : { Bucket, Key };

  return waitForObject(s3(), params, { retries: 5 });
}

/**
 * Gets metadata for a CMR XML file from S3.
 *
 * @param {string} xmlFilePath - S3 URI to the XML metadata document
 * @param {string} [etag] - optional entity tag for the desired version of the
 *    CMR file
 * @returns {Promise<string>} stringified XML document downloaded from S3
 */
async function getXMLMetadataAsString(xmlFilePath, etag) {
  if (!xmlFilePath) {
    throw new errors.XmlMetaFileNotFound('XML Metadata file not provided');
  }
  const obj = await getObjectByFilename(xmlFilePath, etag);
  return obj.Body.toString();
}

/**
 * Parse an xml string
 *
 * @param {string} xml - xml to parse
 * @returns {Promise<Object>} promise resolves to object version of the xml
 */
async function parseXmlString(xml) {
  return promisify(xml2js.parseString)(xml, xmlParseOptions);
}

/**
 * Returns UMMG metadata object from CMR UMM-G JSON file in S3.
 *
 * @param {string} cmrFilename - S3 path to JSON file
 * @param {string} [etag] - optional entity tag for the desired version of the
 *    CMR file
 * @returns {Promise<Object>} CMR UMMG metadata object
 */
async function metadataObjectFromCMRJSONFile(cmrFilename, etag) {
  const obj = await getObjectByFilename(cmrFilename, etag);
  return JSON.parse(obj.Body.toString());
}

/**
 * Returns metadata object from CMR Echo10 XML file in S3.
 *
 * @param {string} cmrFilename - S3 path to XML file
 * @param {string} [etag] - optional entity tag for the desired version of the
 *    CMR file
 * @returns {Promise<Object>} CMR XML metadata object
 */
const metadataObjectFromCMRXMLFile = (cmrFilename, etag) =>
  getXMLMetadataAsString(cmrFilename, etag).then(parseXmlString);

/**
 * Returns CMR metadata object from a CMR ECHO-10 XML file or CMR UMMG JSON
 * file in S3.
 *
 * @param {string} cmrFilename - S3 path to CMR file
 * @param {string} [etag] - optional entity tag for the desired version of the
 *    CMR file
 * @returns {Promise<Object>} metadata object from the file
 * @throws {Error} if the specified filename does not represent an ECHO-10 XML
 *    file or a UMMG file
 * @see isECHO10File
 * @see isUMMGFile
 */
function metadataObjectFromCMRFile(cmrFilename, etag) {
  if (isECHO10File(cmrFilename)) {
    return metadataObjectFromCMRXMLFile(cmrFilename, etag);
  }
  if (isUMMGFile(cmrFilename)) {
    return metadataObjectFromCMRJSONFile(cmrFilename, etag);
  }
  throw new Error(
    `Cannot retrieve metadata: invalid CMR filename: ${cmrFilename}`
  );
}

/**
 * Build and return an S3 Credentials Object for adding to CMR onlineAccessUrls
 *
 * @param {string} s3CredsUrl - full url pointing to the s3 credential distribution api
 * @returns {Object} Object with attributes required for adding an onlineAccessUrl
 */
function getS3CredentialsObject(s3CredsUrl) {
  return {
    URL: s3CredsUrl,
    URLDescription: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
    Type: 'VIEW RELATED INFORMATION',
  };
}

/**
 * Returns UMM/ECHO10 resource type mapping for CNM file type
 *
 * @param {string} type - CNM resource type to convert to UMM/ECHO10 type
 * @returns {( string | undefined )} type - UMM/ECHO10 resource type
 */
function mapCNMTypeToCMRType(type) {
  const mapping = {
    ancillary: 'VIEW RELATED INFORMATION',
    data: 'GET DATA',
    browse: 'GET RELATED VISUALIZATION',
    linkage: 'EXTENDED METADATA',
    metadata: 'EXTENDED METADATA',
    qa: 'EXTENDED METADATA',
  };
  if (!mapping[type]) {
    log.warn(`CNM Type ${type} invalid for mapping to UMM/ECHO10 type value, using GET DATA instead`);
    return 'GET DATA';
  }
  return mapping[type];
}

async function generateFileUrl({
  file,
  distEndpoint,
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  if (cmrGranuleUrlType === 'distribution') {
    const bucketPath = distributionBucketMap[file.bucket];
    if (!bucketPath) {
      throw new errors.MissingBucketMap(`No distribution bucket mapping exists for ${file.bucket}`);
    }

    const urlPath = urljoin(bucketPath, getS3KeyOfFile(file));
    return urljoin(distEndpoint, urlPath);
  }

  if (cmrGranuleUrlType === 's3') {
    /* The check for file.filename is here
       for legacy compliance reasons due to model simplification in
       CUMULUS-1139 where filename was remapped to bucket and key*/
    if (file.filename) {
      return file.filename;
    }
    return buildS3Uri(file.bucket, file.key);
  }

  return undefined;
}

/**
 * Construct online access url for a given file.
 *
 * @param {Object} params - input parameters
 * @param {Object} params.file - file object
 * @param {string} params.distEndpoint - distribution endpoint from config
 * @param {Object} params.bucketTypes - map of bucket name to bucket type
 * @param {distributionBucketMap} params.distributionBucketMap - Object with bucket:tea-path mapping
 *                                                               for all distribution bucketss
 * @returns {(Object | undefined)} online access url object, undefined if no URL exists
 */
async function constructOnlineAccessUrl({
  file,
  distEndpoint,
  bucketTypes,
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  const bucketType = bucketTypes[file.bucket];
  const distributionApiBuckets = ['protected', 'public'];
  if (distributionApiBuckets.includes(bucketType)) {
    const fileUrl = await generateFileUrl({ file, distEndpoint, cmrGranuleUrlType, distributionBucketMap });
    if (fileUrl) {
      const fileDescription = getFileDescription(file);
      return {
        URL: fileUrl,
        URLDescription: fileDescription, // used by ECHO10
        Description: fileDescription, // used by UMMG
        Type: mapCNMTypeToCMRType(file.type), // used by UMMG
      };
    }
  }
  return undefined;
}

/**
 * Construct a list of online access urls.
 *
 * @param {Object} params - input parameters
 * @param {Array<Object>} params.files - array of file objects
 * @param {string} params.distEndpoint - distribution endpoint from config
 * @param {Object} params.bucketTypes - map of bucket name to bucket type
 * @param {distributionBucketMap} params.distributionBucketMap - Object with bucket:tea-path mapping
 *                                                               for all distribution bucketss
 * @returns {Promise<[{URL: string, URLDescription: string}]>} an array of
 *    online access url objects
 */
async function constructOnlineAccessUrls({
  files,
  distEndpoint,
  bucketTypes,
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  if (cmrGranuleUrlType === 'distribution' && !distEndpoint) {
    throw new Error('cmrGranuleUrlType is distribution, but no distribution endpoint is configured.');
  }

  const urlListPromises = files.map((file) => constructOnlineAccessUrl({
    file,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap,
  }));
  const urlList = await Promise.all(urlListPromises);
  return urlList.filter((urlObj) => urlObj);
}

/**
 * Construct a list of UMMG related urls
 *
 * @param {Object} params - input parameters
 * @param {Array<Object>} params.files - array of file objects
 * @param {string} params.distEndpoint - distribution endpoint from config
 * @param {Object} params.bucketTypes - map of bucket names to bucket types
 * @param {string} params.s3CredsEndpoint - Optional endpoint for acquiring temporary s3 creds
 * @param {Object} params.distributionBucketMap - Object with bucket:tea-path
 *    mapping for all distribution buckets
 * @returns {Promise<[{URL: string, string, Description: string, Type: string}]>}
 *   an array of online access url objects
 */
async function constructRelatedUrls({
  files,
  distEndpoint,
  bucketTypes,
  s3CredsEndpoint = 's3credentials',
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  const credsUrl = urljoin(distEndpoint, s3CredsEndpoint);
  const s3CredentialsObject = getS3CredentialsObject(credsUrl);
  const cmrUrlObjects = await constructOnlineAccessUrls({
    files,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap,
  });

  const relatedUrls = cmrUrlObjects.concat(s3CredentialsObject);
  return relatedUrls.map((urlObj) => omit(urlObj, 'URLDescription'));
}

/**
 * Create a list of URL objects that should not appear under onlineAccess in the CMR metadata.
 * @param {Array<Object>} files - array of updated file objects
 * @param {Object} bucketTypes - map of buckets name to bucket types
 * @returns {Array<Object>} array of files to be omitted in cmr's OnlineAccessURLs
 */
function onlineAccessURLsToRemove(files, bucketTypes) {
  const typesToKeep = ['public', 'protected'];

  return files.reduce(
    (acc, file) => {
      if (typesToKeep.includes(bucketTypes[file.bucket])) {
        return acc;
      }

      return [
        ...acc,
        { URL: getS3KeyOfFile(file) },
      ];
    },
    []
  );
}

/**
 * Returns a list of posible metadata file objects based on file.name extension.
 *
 * @param {Array<Object>} files - list of file objects that might be metadata files.
 * @param {string} files.name - file name
 * @param {string} files.bucket - current bucket of file
 * @param {string} files.filepath - current s3 key of file
 * @returns {Array<Object>} any metadata type file object.
 */
function getCmrFileObjs(files) {
  return files.filter((file) => isCMRFile(file));
}

/**
 * Merge lists of URL objects.
 *
 * @param {Array<Object>} original - Array of URL Objects representing the cmr file previous state
 * @param {Array<Object>} updated - Array of updated URL Objects representing moved/updated files
 * @param {Array<Object>} removed - Array of URL Objects to remove from OnlineAccess.
 * @returns {Array<Object>} list of updated an original URL objects representing the updated state.
 */
function mergeURLs(original, updated = [], removed = []) {
  const newURLBasenames = updated.map((url) => path.basename(url.URL));
  const removedBasenames = removed.map((url) => path.basename(url.URL));

  const unchangedOriginals = original.filter(
    (url) => !newURLBasenames.includes(path.basename(url.URL))
      && !removedBasenames.includes(path.basename(url.URL))
  );

  const updatedWithMergedOriginals = updated.map((url) => {
    const matchedOriginal = original.filter(
      (ourl) => path.basename(ourl.URL) === path.basename(url.URL)
    );
    if (matchedOriginal.length === 1) {
      // merge original urlObject into the updated urlObject,
      // preferring all metadata from original except the new url.URL
      // and description
      const updatedMetadata = {
        URL: url.URL,
      };
      if (url.Description) {
        updatedMetadata.Description = url.Description;
      }
      if (url.URLDescription) {
        updatedMetadata.URLDescription = url.URLDescription;
      }
      return {
        ...url,
        ...matchedOriginal[0],
        ...updatedMetadata,
      };
    }
    return url;
  });

  return [...unchangedOriginals, ...updatedWithMergedOriginals];
}

/**
 * Updates CMR JSON file with stringified 'metadataObject'
 *
 * @param {Object} metadataObject - JSON Object to stringify
 * @param {Object} cmrFile - cmr file object to write body to
 * @returns {Promise} returns promised promiseS3Upload response
 */
async function uploadUMMGJSONCMRFile(metadataObject, cmrFile) {
  const tags = await s3GetObjectTagging(cmrFile.bucket, getS3KeyOfFile(cmrFile));
  const tagsQueryString = s3TagSetToQueryString(tags.TagSet);
  return promiseS3Upload({
    Bucket: cmrFile.bucket,
    Key: getS3KeyOfFile(cmrFile),
    Body: JSON.stringify(metadataObject),
    Tagging: tagsQueryString,
    ContentType: 'application/json',
  });
}

/**
 * After files are moved, create new online access URLs and then update the S3
 * UMMG cmr.json file with this information.
 *
 * @param {Object} params - parameter object
 * @param {Object} params.cmrFile - cmr.json file whose contents will be updated.
 * @param {Array<Object>} params.files - array of moved file objects.
 * @param {string} params.distEndpoint - distribution endpoint form config.
 * @param {Object} params.bucketTypes - map of bucket names to bucket types
 * @param {Object} params.distributionBucketMap - Object with bucket:tea-path
 *    mapping for all distribution buckets
 * @returns {Promise<{ metadataObject: Object, etag: string}>} an object
 *    containing a `metadataObject` (the updated UMMG metadata object) and the
 *    `etag` of the uploaded CMR file
 */
async function updateUMMGMetadata({
  cmrFile,
  files,
  distEndpoint,
  bucketTypes,
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  const newURLs = await constructRelatedUrls({
    files,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap,
  });
  const removedURLs = onlineAccessURLsToRemove(files, bucketTypes);
  const filename = getS3UrlOfFile(cmrFile);
  const metadataObject = await metadataObjectFromCMRJSONFile(filename);

  const originalURLs = get(metadataObject, 'RelatedUrls', []);
  const mergedURLs = mergeURLs(originalURLs, newURLs, removedURLs);
  set(metadataObject, 'RelatedUrls', mergedURLs);

  const { ETag: etag } = await uploadUMMGJSONCMRFile(metadataObject, cmrFile);
  return { metadataObject, etag };
}

/**
 * Helper to build an CMR settings object, used to initialize CMR.
 *
 * @param {Object} cmrConfig - CMR configuration object
 * @param {string} cmrConfig.oauthProvider - Oauth provider: launchpad or earthdata
 * @param {string} cmrConfig.provider - the CMR provider
 * @param {string} cmrConfig.clientId - Client id for CMR requests
 * @param {string} cmrConfig.passphraseSecretName - Launchpad passphrase secret name
 * @param {string} cmrConfig.api - Launchpad api
 * @param {string} cmrConfig.certificate - Launchpad certificate
 * @param {string} cmrConfig.username - EDL username
 * @param {string} cmrConfig.passwordSecretName - CMR password secret name
 * @returns {Promise<Object>} object to create CMR instance - contains the
 *    provider, clientId, and either launchpad token or EDL username and
 *    password
*/
async function getCmrSettings(cmrConfig = {}) {
  const oauthProvider = cmrConfig.oauthProvider || process.env.cmr_oauth_provider;

  const cmrCredentials = {
    provider: cmrConfig.provider || process.env.cmr_provider,
    clientId: cmrConfig.clientId || process.env.cmr_client_id,
  };

  if (oauthProvider === 'launchpad') {
    const launchpadPassphraseSecretName = cmrConfig.passphraseSecretName
      || process.env.launchpad_passphrase_secret_name;
    const passphrase = await getSecretString(
      launchpadPassphraseSecretName
    );

    const config = {
      passphrase,
      api: cmrConfig.api || process.env.launchpad_api,
      certificate: cmrConfig.certificate || process.env.launchpad_certificate,
    };

    log.debug('cmrjs.getCreds getLaunchpadToken');
    const token = await launchpad.getLaunchpadToken(config);
    return {
      ...cmrCredentials,
      token,
    };
  }

  const passwordSecretName = cmrConfig.passwordSecretName
    || process.env.cmr_password_secret_name;
  const password = await getSecretString(
    passwordSecretName
  );

  return {
    ...cmrCredentials,
    password,
    username: cmrConfig.username || process.env.cmr_username,
  };
}

function generateEcho10XMLString(granule) {
  const mapping = new Map([]);
  Object.keys(granule).forEach((key) => {
    if (key === 'OnlineAccessURLs') {
      mapping.set(key, granule[key]);
      mapping.set('OnlineResources', granule.OnlineResources);
    } else if (key !== 'OnlineResources') {
      mapping.set(key, granule[key]);
    }
  });
  return js2xmlParser.parse('Granule', mapping);
}

/**
 * Updates CMR xml file with 'xml' string
 *
 * @param  {string} xml - XML to write to cmrFile
 * @param  {Object} cmrFile - cmr file object to write xml to
 * @returns {Promise} returns promised promiseS3Upload response
 */
async function uploadEcho10CMRFile(xml, cmrFile) {
  const tags = await s3GetObjectTagging(cmrFile.bucket, getS3KeyOfFile(cmrFile));
  const tagsQueryString = s3TagSetToQueryString(tags.TagSet);
  return promiseS3Upload({
    Bucket: cmrFile.bucket,
    Key: getS3KeyOfFile(cmrFile),
    Body: xml,
    Tagging: tagsQueryString,
    ContentType: 'application/xml',
  });
}
/**
 * Method takes an array of URL objects to update, an 'origin' array of original URLs
 * and a list of URLs to remove and returns an array of merged URL objectgs
 *
 * @param  {Array<Object>} URLlist - array of URL objects
 * @param  {Array<Object>} originalURLlist - array of URL objects
 * @param  {Array<Object>} removedURLs - array of URL objects
 * @param  {Array<Object>} URLTypes - array of UMM/Echo FileTypes to include
 * @param  {Array<Object>} URLlistFieldFilter - array of URL Object keys to omit
 * @returns {Array<Object>} array of merged URL objects, filtered
 */
function buildMergedEchoURLObject(URLlist = [], originalURLlist = [], removedURLs = [],
  URLTypes, URLlistFieldFilter) {
  let filteredURLObjectList = URLlist.filter((urlObj) => URLTypes.includes(urlObj.Type));
  filteredURLObjectList = filteredURLObjectList.map((urlObj) => omit(urlObj, URLlistFieldFilter));
  return mergeURLs(originalURLlist, filteredURLObjectList, removedURLs);
}

/**
 * After files are moved, creates new online access URLs and then updates
 * the S3 ECHO10 CMR XML file with this information.
 *
 * @param {Object} params - parameter object
 * @param {Object} params.cmrFile - cmr xml file object to be updated
 * @param {Array<Object>} params.files - array of file objects
 * @param {string} params.distEndpoint - distribution endpoint from config
 * @param {Object} params.bucketTypes - map of bucket names to bucket types
 * @param {Object} params.distributionBucketMap - Object with bucket:tea-path
 *    mapping for all distribution buckets
 * @returns {Promise<{ metadataObject: Object, etag: string}>} an object
 *    containing a `metadataObject` and the `etag` of the uploaded CMR file
 */
async function updateEcho10XMLMetadata({
  cmrFile,
  files,
  distEndpoint,
  bucketTypes,
  s3CredsEndpoint = 's3credentials',
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  // add/replace the OnlineAccessUrls
  const filename = getS3UrlOfFile(cmrFile);
  const metadataObject = await metadataObjectFromCMRXMLFile(filename);
  const metadataGranule = metadataObject.Granule;
  const updatedGranule = { ...metadataGranule };

  const originalOnlineAccessURLs = [].concat(get(metadataGranule,
    'OnlineAccessURLs.OnlineAccessURL', []));
  const originalOnlineResourceURLs = [].concat(get(metadataGranule,
    'OnlineResources.OnlineResource', []));
  const originalAssociatedBrowseURLs = [].concat(get(metadataGranule,
    'AssociatedBrowseImageUrls.ProviderBrowseUrl', []));

  const removedURLs = onlineAccessURLsToRemove(files, bucketTypes);
  const newURLs = await constructOnlineAccessUrls({
    files,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap,
  });
  newURLs.push(getS3CredentialsObject(urljoin(distEndpoint, s3CredsEndpoint)));

  const mergedOnlineResources = buildMergedEchoURLObject(newURLs, originalOnlineResourceURLs,
    removedURLs, ['EXTENDED METADATA', 'VIEW RELATED INFORMATION'], ['URLDescription']);
  const mergedOnlineAccessURLs = buildMergedEchoURLObject(newURLs, originalOnlineAccessURLs,
    removedURLs, ['GET DATA'], ['Type', 'Description']);
  const mergedAssociatedBrowse = buildMergedEchoURLObject(newURLs, originalAssociatedBrowseURLs,
    removedURLs, ['GET RELATED VISUALIZATION'], ['URLDescription', 'Type']);

  // Update the Granule with the updated/merged lists
  set(updatedGranule, 'OnlineAccessURLs.OnlineAccessURL', mergedOnlineAccessURLs);
  set(updatedGranule, 'OnlineResources.OnlineResource', mergedOnlineResources);
  set(updatedGranule, 'AssociatedBrowseImageUrls.ProviderBrowseUrl', mergedAssociatedBrowse);

  metadataObject.Granule = updatedGranule;
  const xml = generateEcho10XMLString(updatedGranule);
  const { ETag: etag } = await uploadEcho10CMRFile(xml, cmrFile);
  return { metadataObject, etag };
}

/**
 * Modifies cmr metadata file with file's URLs updated to their new locations.
 *
 * @param {Object} params - parameter object
 * @param {string} params.granuleId - granuleId
 * @param {Object} params.cmrFile - cmr xml file to be updated
 * @param {Array<Object>} params.files - array of file objects
 * @param {string} params.distEndpoint - distribution enpoint from config
 * @param {boolean} params.published - indicate if publish is needed
 * @param {Object} params.bucketTypes - map of bucket names to bucket types
 * @param {string} params.cmrGranuleUrlType - type of granule CMR url
 * @param {Object} params.distributionBucketMap - Object with bucket:tea-path
 *    mapping for all distribution buckets
 * @returns {Promise<Object>} CMR file object with the `etag` of the newly
 *    updated metadata file
 */
async function updateCMRMetadata({
  granuleId,
  cmrFile,
  files,
  distEndpoint,
  published,
  bucketTypes,
  cmrGranuleUrlType = 'distribution',
  distributionBucketMap,
}) {
  const filename = getS3UrlOfFile(cmrFile);

  log.debug(`cmrjs.updateCMRMetadata granuleId ${granuleId}, cmrMetadata file ${filename}`);

  const cmrCredentials = (published) ? await getCmrSettings() : {};
  const params = {
    cmrFile,
    files,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap,
  };

  let metadataObject;
  let etag;

  if (isECHO10File(filename)) {
    ({ metadataObject, etag } = await updateEcho10XMLMetadata(params));
  } else if (isUMMGFile(filename)) {
    ({ metadataObject, etag } = await updateUMMGMetadata(params));
  } else {
    throw new errors.CMRMetaFileNotFound(`Invalid CMR filetype: ${filename}`);
  }

  if (published) {
    // post metadata Object to CMR
    const cmrPublishObject = {
      filename,
      metadataObject,
      granuleId,
    };

    return { ...await publish2CMR(cmrPublishObject, cmrCredentials), etag };
  }

  return { ...cmrFile, etag };
}

/**
 * Update CMR Metadata record with the information contained in updatedFiles
 * @param {Object} params - parameter object
 * @param {string} params.granuleId - granuleId
 * @param {Object} params.updatedFiles - list of file objects that might have different
 *                  information from the cmr metadatafile and the CMR service.
 * @param {string} params.distEndpoint - distribution endpoint URL
 * @param {boolean} params.published - boolean true if the data should be published to
 *   the CMR service.
 * @param {distributionBucketMap} params.distributionBucketMap - Object with bucket:tea-path mapping
 *                                                               for all distribution buckets
 * @param {Object} params.bucketTypes - map of bucket names to bucket types
 */
async function reconcileCMRMetadata({
  granuleId,
  updatedFiles,
  distEndpoint,
  published,
  distributionBucketMap,
  bucketTypes,
}) {
  const cmrMetadataFiles = getCmrFileObjs(updatedFiles);
  if (cmrMetadataFiles.length === 1) {
    return updateCMRMetadata({
      granuleId,
      cmrFile: cmrMetadataFiles[0],
      files: updatedFiles,
      distEndpoint,
      published,
      distributionBucketMap,
      bucketTypes,
    });
  }
  if (cmrMetadataFiles.length > 1) {
    log.error('More than one cmr metadata file found.');
  }
  return Promise.resolve();
}

/**
 * Creates the query object to post to CMR that will return all collections
 * that match both the short_name and version of any of the result objects.
 * the final query should be like
 *  {"condition":
 *   { "or": [{ "and": [{"short_name": "sn1"}, {"version": "001"}] },
 *            { "and": [{"short_name": "sn2"}, {"version": "006"}] },
 *            { "and": [{"short_name": "sn3"}, {"version": "001"}] },
 *            .... ] } }
 *
 * @param {Array<Object>} results - objects with keys "short_name" and "version"
 * @returns {Object} - query object for a post to CMR that will return all of the collections that
 *                     match any of the results.
 */
function buildCMRQuery(results) {
  const query = { condition: { or: [] } };
  results.map((r) => query.condition.or.push(
    { and: [{ short_name: r.short_name }, { version: r.version }] }
  ));
  return query;
}

/**
 * Call CMR to get the collections for each of the results array's collections in a single call.
 *
 * @param {Array<Object>} results - pared results from a Cumulus collection search.
 * @returns {Promise<Object>} - resolves to the CMR return
 * containing the found collections that were searched by short_name and
 * version.
 */
async function getCollectionsByShortNameAndVersion(results) {
  const query = buildCMRQuery(results);
  const cmrClient = new CMR(await getCmrSettings());
  const headers = cmrClient.getReadHeaders({ token: await cmrClient.getToken() });

  const response = await got.post(
    `${getSearchUrl()}collections.json`,
    {
      json: query,
      responseType: 'json',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    }
  );
  return response.body;
}

/**
 * Extract temporal information from granule object
 *
 * @param {Object} granule - granule object
 * @returns {Object} - temporal information (beginningDateTime, endingDateTime, productionDateTime,
 * lastUpdateDateTime) of the granule if available
 */
async function getGranuleTemporalInfo(granule) {
  const cmrFile = granuleToCmrFileObject(granule);
  if (cmrFile.length === 0) return {};

  const cmrFilename = cmrFile[0].filename;
  if (isECHO10File(cmrFilename)) {
    const metadata = await metadataObjectFromCMRXMLFile(cmrFilename);
    const beginningDateTime = get(metadata.Granule, 'Temporal.RangeDateTime.BeginningDateTime');
    const endingDateTime = get(metadata.Granule, 'Temporal.RangeDateTime.EndingDateTime');
    const productionDateTime = get(metadata.Granule, 'DataGranule.ProductionDateTime');
    const lastUpdateDateTime = metadata.Granule.LastUpdate || metadata.Granule.InsertTime;
    return {
      beginningDateTime, endingDateTime, productionDateTime, lastUpdateDateTime,
    };
  }
  if (isUMMGFile(cmrFilename)) {
    const metadata = await metadataObjectFromCMRJSONFile(cmrFilename);
    const beginningDateTime = get(metadata, 'TemporalExtent.RangeDateTime.BeginningDateTime');
    const endingDateTime = get(metadata, 'TemporalExtent.RangeDateTime.EndingDateTime');
    const productionDateTime = get(metadata, 'DataGranule.ProductionDateTime');
    let updateDate = metadata.ProviderDates.filter((d) => d.Type === 'Update');
    if (updateDate.length === 0) {
      updateDate = metadata.ProviderDates.filter((d) => d.Type === 'Insert');
    }
    const lastUpdateDateTime = updateDate[0].Date;
    return {
      beginningDateTime, endingDateTime, productionDateTime, lastUpdateDateTime,
    };
  }
  return {};
}

module.exports = {
  constructCmrConceptLink,
  constructOnlineAccessUrl,
  constructOnlineAccessUrls,
  generateEcho10XMLString,
  generateFileUrl,
  getCmrSettings,
  getFileDescription,
  getFilename,
  getGranuleTemporalInfo,
  getCollectionsByShortNameAndVersion,
  granulesToCmrFileObjects,
  isCMRFile,
  isCMRFilename,
  isECHO10File,
  isUMMGFile,
  metadataObjectFromCMRFile,
  publish2CMR,
  reconcileCMRMetadata,
  updateCMRMetadata,
  uploadEcho10CMRFile,
  uploadUMMGJSONCMRFile,
};
