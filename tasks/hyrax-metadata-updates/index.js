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

const BucketsConfig = require('@cumulus/common/BucketsConfig');

const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');

/**
 * Throw an error if hyrax-metadata-updates is configured to throw an error for
 * testing/example purposes. Set the pass on retry value to simulate
 * a task passing on a retry.
 *
 * @param {Object} event - input from the message adapter
 * @returns {undefined} none
 */
async function throwErrorIfConfigured(event) {
  const execution = event.config.execution;
  const retryFilename = `${execution}_retry.txt`;
  const bucket = event.config.bucket;

  let isRetry = false;

  if (event.config.passOnRetry) {
    isRetry = await s3ObjectExists({
      Bucket: bucket,
      Key: retryFilename
    });
  }

  if (event.config.passOnRetry && isRetry) {
    log.debug('Detected retry');

    // Delete file
    await deleteS3Object(bucket, retryFilename);
  } else if (event.config.fail) {
    if (event.config.passOnRetry) {
      await s3PutObject({
        Bucket: bucket,
        Key: retryFilename,
        Body: ''
      });
    }

    throw new Error('Step configured to force fail');
  }
}

/**
 * generateAddress
 *
 * @param {Object} env - the environment retrieved from configuration
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
 * generatePath
 *
 * @param {Object} event - the event
 * @throws {Object} invalidArgumentException - if the env is not valid
 * @returns {string} - the OPeNDAP path
 */
function generatePath(event) {
  const config = event.config;
  const providerId = get(config, 'provider');
  // Check if providerId is defined
  if (_.isUndefined(providerId)) {
    throw new InvalidArgument('Provider not supplied in configuration. Unable to construct path');
  }
  const entryTitle = get(config, 'entryTitle');
  // Check if entryTitle is defined
  if (_.isUndefined(entryTitle)) {
    throw new InvalidArgument('Entry Title not supplied in configuration. Unable to construct path');
  }
  // TODO retrieve source metadata file from event
  const metadata = ''
  const nativeId = 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4';
  const path = `providers/${providerId}/collections/${entryTitle}/granules/${nativeId}`;

  return path;
}
/**
 * Do the work
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} sample JSON object
 */
async function updateMetadata(event) {
  await throwErrorIfConfigured(event);

  const address = generateAddress(get(event.config, 'environment', 'prod'));
  const path = generatePath(event);
  const q = new URL(`${address}/${path}`);

  return {
    result: q.href
  };
}

/**
 * generateNativeId
 *
 * @param {string} metadata - the metadata
 * @returns {string} - the native id
 */
function getNativeId(metadata) {

  let metadataObject = null;
  try {
    // Is this UMM-G or ECHO10?
    metadataObject = JSON.parse(metadata);
    // UMM-G: meta/native-id
    const nativeId = metadataObject.meta['native-id']
    return nativeId;
  } catch (e) {
    // ECHO10: Granule/DataGranule/ProducerGranuleId
    const parseString = require('xml2js').parseString;

    let nativeId = null;
    parseString(metadata, (_err, result) => {
      nativeId = result.Granule.GranuleUR[0];
    });
    return nativeId;
  }
}

/**
 * addHyraxUrl
 *
 * @param {String} metadata - the orginal metadata
 * @param {URL} hyraxUrl - the hyrax url
 * @returns {String} - the updated metadata containing a Hyrax URL
 */
function addHyraxUrl(metadata, hyraxUrl) {

  let metadataObject = null;
  try {
    // Is this UMM-G or ECHO10?
    metadataObject = JSON.parse(metadata);
    // UMM-G: meta/native-id
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
  } catch (e) {}
  return JSON.stringify(metadataObject, null, 2);
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
exports.updateMetadata = updateMetadata; // exported to support testing
exports.generateAddress = generateAddress; // exported to support testing
exports.generatePath = generatePath; // exported to support testing
exports.getNativeId = getNativeId; // exported to support testing
exports.addHyraxUrl = addHyraxUrl; // exported to support testing