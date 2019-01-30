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

const { CMR } = require('./cmr');
const { getUrl, xmlParseOptions } = require('./utils');

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
  let password;
  try {
    password = await DefaultProvider.decrypt(creds.password, undefined, systemBucket, stack);
  }
  catch (error) {
    log.error('Decrypting password failed, using unencrypted password', error);
    password = creds.password;
  }
  const cmr = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );

  const builder = new xml2js.Builder();
  const xml = builder.buildObject(cmrFile.metadataObject);
  const res = await cmr.ingestGranule(xml);
  const conceptId = res.result['concept-id'];

  log.info(`Published ${cmrFile.granuleId} to the CMR. conceptId: ${conceptId}`);

  return {
    granuleId: cmrFile.granuleId,
    filename: cmrFile.filename,
    conceptId,
    link: `${getUrl('search')}granules.json?concept_id=${res.result['concept-id']}`
  };
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

const isECHO10File = (filename) => filename.endsWith('cmr.xml');
const isUMMGFile = (filename) => filename.endsWith('cmr.json');

/**
 * Returns True if this object can be determined to be a cmrMetadata object.
 *
 * @param {Object} fileobject
 * @returns {boolean} true if object references cmr metadata.
 */
function isCMRFile(fileobject) {
  const cmrfilename = fileobject.name || fileobject.filename || '';
  return isECHO10File(cmrfilename) || isUMMGFile(cmrfilename);
}

/**
 * return UMMG metadata object from CMR UMM-G json file
 * @param {string} cmrFilename - s3 path to json file
 * @returns {Object} CMR UMMG metadata object
 */
async function metadataObjectFromCMRJSONFile(cmrFilename) {
  const { Bucket, Key } = aws.parseS3Uri(cmrFilename);
  const obj = await aws.getS3Object(Bucket, Key);
  return JSON.parse(obj.Body.toString());
}

/**
 * return metadata object from cmr echo10 XML file.
 * @param {string} cmrFilename
 * @returns {Object} cmr xml metadata as object.
 */
async function metadataObjectFromCMRXMLFile(cmrFilename) {
  const metadata = await getXMLMetadataAsString(cmrFilename);
  return parseXmlString(metadata);
}

/**
 * returns a list of CMR xml file objects
 *
 * @param {Array} input - an Array of S3 uris
 * @param {string} granuleIdExtraction - a regex for extracting granule IDs
 * @returns {Promise<Array>} promise resolves to an array of objects
 * that includes CMR xmls uris and granuleIds
 */
function getCmrXMLFiles(input, granuleIdExtraction) {
  const files = [];

  input.forEach((filename) => {
    if (isECHO10File(filename)) {
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
 * returns a function that will remove the input key from an object passed to it.
 * @param {Object} key - key to remove from object
 * @returns {function} fucntion that will remove desired key from object.
 */
function stripKeyFromObject(key) {
  return function omit(object) {
    /* eslint-disable-next-line no-unused-vars */
    const { [key]: junk, ...objectWithoutKey } = object;
    return objectWithoutKey;
  };
}

/**
 * Construct a list of online access urls.
 *
 * @param {Array<Object>} files - array of file objects
 * @param {string} distEndpoint - distribution enpoint from config
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
      const extension = urljoin(file.bucket, `${file.filepath}`);
      urlObj.URL = urljoin(distEndpoint, extension);
      urlObj.URLDescription = 'File to download';
      urlObj.Type = 'GET DATA';
      urls.push(urlObj);
    }
    else if (bucketType === 'public') {
      urlObj.URL = `https://${file.bucket}.s3.amazonaws.com/${file.filepath}`;
      urlObj.URLDescription = 'File to download';
      urlObj.Type = 'GET DATA';
      urls.push(urlObj);
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
 * @returns {Array<Object>} list of updated an original URL objects representing the updated state.
 */
function mergeURLs(original, updated) {
  const updatedURLBasenames = updated.map((url) => path.basename(url.URL));

  const unchangedOriginals = original.filter(
    (url) => !updatedURLBasenames.includes(path.basename(url.URL))
  );
  const updatedWithMergedOriginals = updated.map((url) => {
    const matchedOriginal = original.filter(
      (ourl) => path.basename(ourl.URL) === path.basename(url.URL)
    );
    if (matchedOriginal.length === 1) {
      /* eslint-disable-next-line no-unused-vars  */
      const { URL: unused, ...matchWithoutURL } = { ...matchedOriginal[0] };
      return { ...url, ...matchWithoutURL };
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
  const isECHO10 = false;
  const newURLs = constructOnlineAccessUrls(files, distEndpoint, buckets, isECHO10);
  const metadataObject = await metadataObjectFromCMRJSONFile(cmrFile.filename);

  const originalURLs = _get(metadataObject, 'items[0].umm.RelatedUrls', []);
  const mergedURLs = mergeURLs(originalURLs, newURLs);
  _set(metadataObject, 'items[0].umm.RelatedUrls', mergedURLs);

  const tags = await aws.s3GetObjectTagging(cmrFile.bucket, cmrFile.filepath);
  const tagsQueryString = aws.s3TagSetToQueryString(tags.TagSet);
  await aws.promiseS3Upload({
    Bucket: cmrFile.bucket,
    Key: cmrFile.filepath,
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
  newURLs = newURLs.map(stripKeyFromObject('Type'));

  // add/replace the OnlineAccessUrls
  const metadataObject = await metadataObjectFromCMRXMLFile(cmrFile.filename);
  const metadataGranule = metadataObject.Granule;

  const updatedGranule = { ...metadataGranule };
  const originalURLs = _get(metadataGranule, 'OnlineAccessURLs.OnlineAccessURL', []);
  const mergedURLs = mergeURLs(originalURLs, newURLs);
  _set(updatedGranule, 'OnlineAccessURLs.OnlineAccessURL', mergedURLs);
  metadataObject.Granule = updatedGranule;

  const builder = new xml2js.Builder();
  const xml = builder.buildObject(metadataObject);

  const tags = await aws.s3GetObjectTagging(cmrFile.bucket, cmrFile.filepath);
  const tagsQueryString = aws.s3TagSetToQueryString(tags.TagSet);
  await aws.promiseS3Upload({
    Bucket: cmrFile.bucket, Key: cmrFile.filepath, Body: xml, Tagging: tagsQueryString
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
 * @returns {Promise} returns promise to publish metadata to CMR Service
 *                    or resolved promise if published === false.
 */
async function updateCMRMetadata(granuleId, cmrFile, files, distEndpoint, published) {
  log.debug(`cmrjs.updateCMRMetadata granuleId ${granuleId}, cmrMetadata file ${cmrFile.filename}`);

  if (isECHO10File(cmrFile.filename)) {
    const buckets = new BucketsConfig(await bucketsConfigDefaults());
    const theMetadata = await updateEcho10XMLMetadata(cmrFile, files, distEndpoint, buckets);
    if (published) {
      // post metadata Object to CMR
      const creds = getCreds();
      const cmrFileObject = {
        filename: cmrFile.filename,
        metadataObject: theMetadata,
        granuleId: granuleId
      };
      return publishECHO10XML2CMR(
        cmrFileObject,
        creds,
        process.env.system_bucket,
        process.env.stackName
      );
    }
    return Promise.resolve();
  }
  if (isUMMGFile(cmrFile.filename)) {
    const buckets = new BucketsConfig(await bucketsConfigDefaults());
    const ummgMetadata = await updateUMMGMetadata(cmrFile, files, distEndpoint, buckets);
    if (published) {
      const creds = getCreds();
      // return publishUMMGJSON2CMR(
      //   ummgMetadata,
      //   creds,
      //   process.env.system_bucket,
      //   process.env.stackName
      // );
      // do published thing.
    }
    return Promise.resolve();
  }
  throw new errors.CMRMetaFileNotFound('Invalid CMR filetype passed to updateCMRMetadata');
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
  getGranuleId,
  getCmrXMLFiles,
  isECHO10File,
  metadataObjectFromCMRJSONFile,
  metadataObjectFromCMRXMLFile,
  publishECHO10XML2CMR,
  reconcileCMRMetadata,
  updateCMRMetadata,
  updateEcho10XMLMetadata
};
