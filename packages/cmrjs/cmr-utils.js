'use strict';

const path = require('path');
const _get = require('lodash.get');
const _set = require('lodash.set');
const { promisify } = require('util');
const urljoin = require('url-join');
const xml2js = require('xml2js');

const {
  aws,
  BucketsConfig,
  errors,
  log
} = require('@cumulus/common');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const { omit } = require('@cumulus/common/util');

const { CMR } = require('./cmr');
const { getUrl, xmlParseOptions } = require('./utils');

function getS3KeyOfFile(file) {
  if (file.filename) return aws.parseS3Uri(file.filename).Key;
  if (file.filepath) return file.filepath;
  if (file.key) return file.key;
  throw new Error(`Unable to determine s3 key of file: ${JSON.stringify(file)}`);
}

function getS3UrlOfFile(file) {
  if (file.filename) return file.filename;
  if (file.bucket && file.filepath) return aws.buildS3Uri(file.bucket, file.filepath);
  if (file.bucket && file.key) return aws.buildS3Uri(file.bucket, file.key);
  throw new Error(`Unable to determine location of file: ${JSON.stringify(file)}`);
}

const isECHO10File = (filename) => filename.endsWith('cmr.xml');
const isUMMGFile = (filename) => filename.endsWith('cmr.json');
const isCMRFilename = (filename) => isECHO10File(filename) || isUMMGFile(filename);

/**
 * Returns True if this object can be determined to be a cmrMetadata object.
 *
 * @param {Object} fileobject
 * @returns {boolean} true if object references cmr metadata.
 */
function isCMRFile(fileobject) {
  const cmrfilename = fileobject.name || fileobject.filename || '';
  return isCMRFilename(cmrfilename);
}


/**
 * Instantiates a CMR instance for ingest of metadata
 *
 * @param {Object} creds - credentials needed to post to the CMR
 * @param {string} systemBucket - bucket containing crypto keys.
 * @param {string} stack - deployment stack name
 * @returns {CMR} CMR instance.
 */
async function getCMRInstance(creds, systemBucket, stack) {
  let password;
  try {
    password = await DefaultProvider.decrypt(creds.password, undefined, systemBucket, stack);
  }
  catch (error) {
    const reason = error.message || error.code || error.name;
    log.error('Decrypting password failed, using unencrypted password:', reason);
    password = creds.password;
  }
  const cmrInstance = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );
  return cmrInstance;
}

/**
 * function for posting cmr xml files from S3 to CMR
 *
 * @param {Object} cmrFile - an object representing the cmr file
 * @param {string} cmrFile.granuleId - the granuleId of the cmr xml File
 * @param {string} cmrFile.filename - the s3 uri to the cmr xml file
 * @param {string} cmrFile.metadata - granule xml document
 * @param {Object} creds - credentials needed to post to the CMR
 * @param {string} creds.provider - the name of the Provider used on the CMR side
 * @param {string} creds.clientId - the clientId used to generate CMR token
 * @param {string} creds.username - the CMR username
 * @param {string} creds.password - the encrypted CMR password
 * @param {string} systemBucket - the bucket name where public/private keys are stored
 * @param {string} stack - the deployment stack name
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publishECHO10XML2CMR(cmrFile, creds, systemBucket, stack) {
  const cmr = await getCMRInstance(creds, systemBucket, stack);

  const builder = new xml2js.Builder();
  const xml = builder.buildObject(cmrFile.metadataObject);
  const res = await cmr.ingestGranule(xml);
  const conceptId = res.result['concept-id'];

  log.info(`Published ${cmrFile.granuleId} to the CMR. conceptId: ${conceptId}`);

  return {
    granuleId: cmrFile.granuleId,
    filename: getS3UrlOfFile(cmrFile),
    conceptId,
    link: `${getUrl('search')}granules.json?concept_id=${res.result['concept-id']}`
  };
}


/**
 *
 * @param {Object} cmrPublishObject -
 * @param {string} cmrPublishObject.filename - the cmr filename
 * @param {Object} cmrPublishObject.metadataObject - the UMMG JSON cmr metadata
 * @param {Object} cmrPublishObject.granuleId - the metadata's granuleId
 * @param {Object} creds - credentials needed to post to CMR service
 * @param {string} systemBucket - bucket containing crypto keypair.
 * @param {string} stack - stack deployment name
 */
async function publishUMMGJSON2CMR(cmrPublishObject, creds, systemBucket, stack) {
  const cmr = await getCMRInstance(creds, systemBucket, stack);

  const granuleId = cmrPublishObject.metadataObject.GranuleUR;

  const res = await cmr.ingestUMMGranule(cmrPublishObject.metadataObject);
  const conceptId = res.result['concept-id'];

  log.info(`Published UMMG ${granuleId} to the CMR. conceptId: ${conceptId}`);

  return {
    granuleId,
    conceptId,
    link: `${getUrl('search')}granules.json?concept_id=${res.result['concept-id']}`
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
 * @param {string} systemBucket - bucket containing crypto keypair.
 * @param {string} stack - stack deployment name
 */
async function publish2CMR(cmrPublishObject, creds, systemBucket, stack) {
  // choose xml or json and do the things.
  if (isECHO10File(cmrPublishObject.filename)) {
    return publishECHO10XML2CMR(cmrPublishObject, creds, systemBucket, stack);
  }
  if (isUMMGFile(cmrPublishObject.filename)) {
    return publishUMMGJSON2CMR(cmrPublishObject, creds, systemBucket, stack);
  }
  throw new Error(`invalid cmrPublishObject passed to publis2CMR ${JSON.stringify(cmrPublishObject)}`);
}


// 2018-12-12 This doesn't belong in cmrjs, but should be resolved by
// https://bugs.earthdata.nasa.gov/browse/CUMULUS-1086
/**
 * Extract the granule ID from the a given s3 uri
 *
 * @param {string} uri - the s3 uri of the file
 * @param {string} regex - the regex for extracting the ID
 * @returns {string} the granule
 */
function getGranuleId(uri, regex) {
  const match = path.basename(uri).match(regex);
  if (match) return match[1];
  throw new Error(`Could not determine granule id of ${uri} using ${regex}`);
}

/**
 * Gets metadata for a cmr xml file from s3
 *
 * @param {string} xmlFilePath - S3 URI to the xml metadata document
 * @returns {string} returns stringified xml document downloaded from S3
 */
async function getXMLMetadataAsString(xmlFilePath) {
  if (!xmlFilePath) {
    throw new errors.XmlMetaFileNotFound('XML Metadata file not provided');
  }
  const { Bucket, Key } = aws.parseS3Uri(xmlFilePath);
  const obj = await aws.getS3Object(Bucket, Key);
  return obj.Body.toString();
}

/**
 * Parse an xml string
 *
 * @param {string} xml - xml to parse
 * @returns {Promise<Object>} promise resolves to object version of the xml
 */
async function parseXmlString(xml) {
  return (promisify(xml2js.parseString))(xml, xmlParseOptions);
}

/**
 * return UMMG metadata object from CMR UMM-G json file
 * @param {string} cmrFilename - s3 path to json file
 * @returns {Promise<Object>} CMR UMMG metadata object
 */
async function metadataObjectFromCMRJSONFile(cmrFilename) {
  const { Bucket, Key } = aws.parseS3Uri(cmrFilename);
  const obj = await aws.getS3Object(Bucket, Key);
  return JSON.parse(obj.Body.toString());
}

/**
 * return metadata object from cmr echo10 XML file.
 * @param {string} cmrFilename
 * @returns {Promise<Object>} cmr xml metadata as object.
 */
async function metadataObjectFromCMRXMLFile(cmrFilename) {
  const metadata = await getXMLMetadataAsString(cmrFilename);
  return parseXmlString(metadata);
}


/**
 * Return cmr metadata object from a CMR Echo10XML file or CMR UMMG File.
 * @param {string} cmrFilename - s3 path to cmr file
 * @returns {Promise<Object>} - metadata object from the file.
 */
async function metadataObjectFromCMRFile(cmrFilename) {
  if (isECHO10File(cmrFilename)) {
    return metadataObjectFromCMRXMLFile(cmrFilename);
  }
  if (isUMMGFile(cmrFilename)) {
    return metadataObjectFromCMRJSONFile(cmrFilename);
  }
  throw new Error(`cannot return metdata from invalid cmrFilename: ${cmrFilename}`);
}

/**
 * Returns a list of CMR ECHO10 xml or UMMG JSON file objects.
 *
 * @param {Array} input - an Array of S3 uris
 * @param {string} granuleIdExtraction - a regex for extracting granule IDs
 * @returns {Array} array of objects
 * that includes CMR xml/json URIs and granuleIds
 */
function getCmrFiles(input, granuleIdExtraction) {
  const files = [];

  input.forEach((filename) => {
    if (isCMRFilename(filename)) {
      const cmrFileObject = {
        filename,
        granuleId: getGranuleId(filename, granuleIdExtraction)
      };
      files.push(cmrFileObject);
    }
  });

  return files;
}

/**
 * Retrieve the stack's bucket configuration from s3 and return the bucket configuration object.
 *
 * @param {string} bucket - system bucket name.
 * @param {string} stackName - stack name.
 * @returns {Object} - stack's bucket configuration.
 */
async function bucketConfig(bucket, stackName) {
  const bucketsString = await aws.s3().getObject({
    Bucket: bucket,
    Key: `${stackName}/workflows/buckets.json`
  }).promise();
  return JSON.parse(bucketsString.Body);
}

/** Return the stack's buckets object read from from S3 */
async function bucketsConfigDefaults() {
  return bucketConfig(process.env.system_bucket, process.env.stackName);
}

/**
 * Construct a list of online access urls.
 *
 * @param {Array<Object>} files - array of file objects
 * @param {string} distEndpoint - distribution endpoint from config
 * @param {BucketsConfig} buckets -  Class instance
 * @returns {Array<{URL: string, URLDescription: string}>}
 *   returns the list of online access url objects
 */
function constructOnlineAccessUrls(files, distEndpoint, buckets) {
  const urls = [];

  files.forEach((file) => {
    const urlObj = {};
    const bucketType = buckets.type(file.bucket);
    if (bucketType === 'protected') {
      const extension = urljoin(file.bucket, getS3KeyOfFile(file));
      urlObj.URL = urljoin(distEndpoint, extension);
      urlObj.URLDescription = 'File to download';
      urlObj.Type = 'GET DATA';
      urls.push(urlObj);
    }
    else if (bucketType === 'public') {
      urlObj.URL = `https://${file.bucket}.s3.amazonaws.com/${getS3KeyOfFile(file)}`;
      urlObj.URLDescription = 'File to download';
      urlObj.Type = 'GET DATA';
      urls.push(urlObj);
    }
  });

  return urls;
}

/**
 * Create a list of URL objects that should not appear under onlineAccess in the CMR metadata.
 * @param {Array<Object>} files - array of updated file objects
 * @param {BucketsConfig} buckets - stack BucketConfig instance.
 * @returns {Array<Object>} array of files to be omitted in cmr's OnlineAccessURLs
 */
function onlineAccessURLsToRemove(files, buckets) {
  const urls = [];
  const typesToKeep = ['public', 'protected'];

  files.forEach((file) => {
    const bucketType = buckets.type(file.bucket);
    if (!typesToKeep.includes(bucketType)) {
      urls.push({ URL: getS3KeyOfFile(file) });
    }
  });
  return urls;
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
function mergeURLs(original, updated, removed = []) {
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
      return { ...url, ...matchedOriginal[0], ...{ URL: url.URL } };
    }
    return url;
  });

  return [...unchangedOriginals, ...updatedWithMergedOriginals];
}


/**
 * After files are moved, create new online access URLs and then update the S3
 * UMMG cmr.json file with this information.
 *
 * @param {Object} cmrFile cmr.json file whose contents will be updated.
 * @param {Array<Object>} files - array of moved file objects.
 * @param {string} distEndpoint - distribution endpoint form config.
 * @param {BucketsConfig} buckets - stack BucketConfig instance.
 * @returns {Promise} returns promised updated UMMG metadata object.
 */
async function updateUMMGMetadata(cmrFile, files, distEndpoint, buckets) {
  const newURLs = constructOnlineAccessUrls(files, distEndpoint, buckets);
  const removedURLs = onlineAccessURLsToRemove(files, buckets);
  const filename = getS3UrlOfFile(cmrFile);
  const metadataObject = await metadataObjectFromCMRJSONFile(filename);

  const originalURLs = _get(metadataObject, 'RelatedUrls', []);
  const mergedURLs = mergeURLs(originalURLs, newURLs, removedURLs);
  _set(metadataObject, 'RelatedUrls', mergedURLs);

  const tags = await aws.s3GetObjectTagging(cmrFile.bucket, getS3KeyOfFile(cmrFile));
  const tagsQueryString = aws.s3TagSetToQueryString(tags.TagSet);
  await aws.promiseS3Upload({
    Bucket: cmrFile.bucket,
    Key: getS3KeyOfFile(cmrFile),
    Body: JSON.stringify(metadataObject),
    Tagging: tagsQueryString
  });
  return metadataObject;
}

/** helper to build an CMR credential object
 * @returns {Object} object to create CMR instance.
*/
function getCreds() {
  return {
    provider: process.env.cmr_provider,
    clientId: process.env.cmr_client_id,
    username: process.env.cmr_username,
    password: process.env.cmr_password
  };
}


/**
 * After files are moved, this function creates new online access URLs and then updates
 * the S3 ECHO10 CMR XML file with this information.
 *
 * @param {Object} cmrFile - cmr xml file object to be updated
 * @param {Array<Object>} files - array of file objects
 * @param {string} distEndpoint - distribution endpoint from config
 * @param {BucketsConfig} buckets - stack BucketConfig instance
 * @returns {Promise} returns promised updated metadata object.
 */
async function updateEcho10XMLMetadata(cmrFile, files, distEndpoint, buckets) {
  let newURLs = constructOnlineAccessUrls(files, distEndpoint, buckets);
  newURLs = newURLs.map((urlObj) => omit(urlObj, 'Type'));
  const removedURLs = onlineAccessURLsToRemove(files, buckets);

  // add/replace the OnlineAccessUrls
  const filename = getS3UrlOfFile(cmrFile);
  const metadataObject = await metadataObjectFromCMRXMLFile(filename);
  const metadataGranule = metadataObject.Granule;

  const updatedGranule = { ...metadataGranule };
  let originalURLs = _get(metadataGranule, 'OnlineAccessURLs.OnlineAccessURL', []);

  // If there is only one OnlineAccessURL in the file, it comes back as an object and not an array
  if (!Array.isArray(originalURLs)) {
    originalURLs = [originalURLs];
  }

  const mergedURLs = mergeURLs(originalURLs, newURLs, removedURLs);
  _set(updatedGranule, 'OnlineAccessURLs.OnlineAccessURL', mergedURLs);
  metadataObject.Granule = updatedGranule;

  const builder = new xml2js.Builder();
  const xml = builder.buildObject(metadataObject);

  const tags = await aws.s3GetObjectTagging(cmrFile.bucket, getS3KeyOfFile(cmrFile));
  const tagsQueryString = aws.s3TagSetToQueryString(tags.TagSet);
  await aws.promiseS3Upload({
    Bucket: cmrFile.bucket, Key: getS3KeyOfFile(cmrFile), Body: xml, Tagging: tagsQueryString
  });
  return metadataObject;
}

/**
 * Modifies cmr metadata file with file's URLs updated to their new locations.
 *
 * @param {string} granuleId - granuleId
 * @param {Object} cmrFile - cmr xml file to be updated
 * @param {Array<Object>} files - array of file objects
 * @param {string} distEndpoint - distribution enpoint from config
 * @param {boolean} published - indicate if publish is needed
 * @param {BucketsConfig} inBuckets - BucketsConfig instance if available, will
 *                                    default one build with s3 stored config.
 * @returns {Promise} returns promise to publish metadata to CMR Service
 *                    or resolved promise if published === false.
 */
async function updateCMRMetadata(
  granuleId,
  cmrFile,
  files,
  distEndpoint,
  published,
  inBuckets = null
) {
  const filename = getS3UrlOfFile(cmrFile);

  log.debug(`cmrjs.updateCMRMetadata granuleId ${granuleId}, cmrMetadata file ${filename}`);
  const buckets = inBuckets || new BucketsConfig(await bucketsConfigDefaults());
  const cmrCredentials = (published) ? getCreds() : {};
  let theMetadata;

  if (isECHO10File(filename)) {
    theMetadata = await updateEcho10XMLMetadata(cmrFile, files, distEndpoint, buckets);
  }
  else if (isUMMGFile(filename)) {
    theMetadata = await updateUMMGMetadata(cmrFile, files, distEndpoint, buckets);
  }
  else {
    throw new errors.CMRMetaFileNotFound('Invalid CMR filetype passed to updateCMRMetadata');
  }

  if (published) {
    // post metadata Object to CMR
    const cmrPublishObject = {
      filename,
      metadataObject: theMetadata,
      granuleId: granuleId
    };
    return publish2CMR(
      cmrPublishObject,
      cmrCredentials,
      process.env.system_bucket,
      process.env.stackName
    );
  }
  return Promise.resolve();
}

/**
 * Update CMR Metadata record with the information contained in updatedFiles
 * @param {string} granuleId - granuleId
 * @param {Object} updatedFiles - list of file objects that might have different
 *                  information from the cmr metadatafile and the CMR service.
 * @param {string} distEndpoint - distribution endpoint URL
 * @param {boolean} published - boolean true if the data should be published to the CMR service.
 */
async function reconcileCMRMetadata(granuleId, updatedFiles, distEndpoint, published) {
  const cmrMetadataFiles = getCmrFileObjs(updatedFiles);
  if (cmrMetadataFiles.length === 1) {
    return updateCMRMetadata(granuleId, cmrMetadataFiles[0], updatedFiles, distEndpoint, published);
  }
  if (cmrMetadataFiles.length > 1) {
    log.error('More than one cmr metadata file found.');
  }
  return Promise.resolve();
}


module.exports = {
  getCmrFiles,
  getGranuleId,
  isCMRFile,
  metadataObjectFromCMRFile,
  publish2CMR,
  reconcileCMRMetadata,
  updateCMRMetadata
};
