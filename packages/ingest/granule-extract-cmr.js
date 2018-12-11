'use strict';

const path = require('path');
const { promisify } = require('util');
const urljoin = require('url-join');
const xml2js = require('xml2js');

const {
  aws,
  errors,
  log
} = require('@cumulus/common');
const { xmlParseOptions } = require('@cumulus/cmrjs/utils');
const { CMR, getUrl } = require('@cumulus/cmrjs');

// TODO: mhs extract crypto to common.
// const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { DefaultProvider } = require('./crypto');

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
 * @param {string} bucket - the bucket name where public/private keys are stored
 * @param {string} stack - the deployment stack name
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publish(cmrFile, creds, bucket, stack) {
  let password;
  try {
    password = await DefaultProvider.decrypt(creds.password, undefined, bucket, stack);
  }
  catch (e) {
    log.error('Decrypting password failed, using unencrypted password', e);
    password = creds.password;
  }
  const cmr = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );

  const xml = cmrFile.metadata;
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
 * Gets body and tags of s3 metadata xml file
 *
 * @param {string} xmlFilePath - S3 URI to the xml metadata document
 * @returns {Object} - object containing Body and TagSet for S3 Object
 */
async function getMetadataBodyAndTags(xmlFilePath) {
  if (!xmlFilePath) {
    throw new errors.XmlMetaFileNotFound('XML Metadata file not provided');
  }
  const { Bucket, Key } = aws.parseS3Uri(xmlFilePath);
  const data = await aws.getS3Object(Bucket, Key);
  const tags = await aws.s3GetObjectTagging(Bucket, Key);
  return {
    Body: data.Body.toString(),
    TagSet: tags.TagSet
  };
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
 * returns a list of CMR xml files
 *
 * @param {Array} input - an array of s3 uris
 * @param {string} granuleIdExtraction - a regex for extracting granule IDs
 * @returns {Promise<Array>} promise resolves to an array of objects
 * that includes CMR xmls uris and granuleIds
 */
async function getCmrFiles(input, granuleIdExtraction) {
  const files = [];
  const expectedFormat = /.*\.cmr\.xml$/;

  await Promise.all(input.map(async (filename) => {
    if (filename && filename.match(expectedFormat)) {
      const metaResponse = await getMetadataBodyAndTags(filename);
      const metadataObject = await parseXmlString(metaResponse.Body);

      const cmrFileObject = {
        filename,
        metadata: metaResponse.Body,
        metadataObject,
        granuleId: getGranuleId(filename, granuleIdExtraction),
        s3Tags: metaResponse.TagSet
      };

      files.push(cmrFileObject);
    }
  }));

  return files;
}

async function postS3Object(destination, options) {
  await aws.promiseS3Upload(
    { Bucket: destination.bucket, Key: destination.key, Body: destination.body }
  );
  if (options) {
    const s3 = aws.s3();
    await s3.deleteObject(options).promise();
  }
}

/**
 * construct a list of online access urls
 *
 * @param {Array<Object>} files - array of file objects
 * @param {string} distEndpoint - distribution enpoint from config
 * @returns {Array<{URL: string, URLDescription: string}>}
 *   returns the list of online access url objects
 */
async function contructOnlineAccessUrls(files, distEndpoint) {
  const urls = [];

  const bucketsString = await aws.s3().getObject({
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/buckets.json`
  }).promise();
  const bucketsObject = JSON.parse(bucketsString.Body);

  // URLs are for public and protected files
  const bucketKeys = Object.keys(bucketsObject);
  files.forEach((file) => {
    const urlObj = {};
    const bucketkey = bucketKeys.find((bucketKey) =>
      file.bucket === bucketsObject[bucketKey].name);

    if (bucketsObject[bucketkey].type === 'protected') {
      const extension = urljoin(bucketsObject[bucketkey].name, `${file.filepath}`);
      urlObj.URL = urljoin(distEndpoint, extension);
      urlObj.URLDescription = 'File to download';
      urls.push(urlObj);
    }
    else if (bucketsObject[bucketkey].type === 'public') {
      urlObj.URL = `https://${bucketsObject[bucketkey].name}.s3.amazonaws.com/${file.filepath}`;
      urlObj.URLDescription = 'File to download';
      urls.push(urlObj);
    }
  });
  return urls;
}

/**
 * updates cmr xml file with updated file urls
 *
 * @param {string} granuleId - granuleId
 * @param {Object} cmrFile - cmr xml file to be updated
 * @param {Object[]} files - array of file objects
 * @param {string} distEndpoint - distribution enpoint from config
 * @param {boolean} published - indicate if publish is needed
 * @returns {Promise} returns promise to upload updated cmr file
 */
async function updateMetadata(granuleId, cmrFile, files, distEndpoint, published) {
  log.debug(`granules.updateMetadata granuleId ${granuleId}, xml file ${cmrFile.filename}`);

  const urls = await contructOnlineAccessUrls(files, distEndpoint);

  // add/replace the OnlineAccessUrls
  const metadata = await getXMLMetadataAsString(cmrFile.filename);
  const metadataObject = await parseXmlString(metadata);
  const metadataGranule = metadataObject.Granule;
  const updatedGranule = {};
  Object.keys(metadataGranule).forEach((key) => {
    if (key === 'OnlineResources' || key === 'Orderable') {
      updatedGranule.OnlineAccessURLs = {};
    }
    updatedGranule[key] = metadataGranule[key];
  });
  updatedGranule.OnlineAccessURLs.OnlineAccessURL = urls;
  metadataObject.Granule = updatedGranule;
  const builder = new xml2js.Builder();
  const xml = builder.buildObject(metadataObject);

  // post meta file to CMR
  const creds = {
    provider: process.env.cmr_provider,
    clientId: process.env.cmr_client_id,
    username: process.env.cmr_username,
    password: process.env.cmr_password
  };

  const cmrFileObject = {
    filename: cmrFile.filename,
    metadata: xml,
    granuleId: granuleId
  };
  if (published) await publish(cmrFileObject, creds, process.env.bucket, process.env.stackName);
  return postS3Object({ bucket: cmrFile.bucket, key: cmrFile.filepath, body: xml });
}

module.exports = {
  getGranuleId,
  getCmrFiles,
  publish,
  updateMetadata
};
