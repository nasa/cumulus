'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const log = require('@cumulus/common/log');
const { InvalidArgument } = require('@cumulus/errors');

const {
  buildS3Uri,
  s3ObjectExists,
  s3PutObject
} = require('@cumulus/aws-client/S3');

const get = require('lodash.get');

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
 * Do the work
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} sample JSON object
 */
async function updateMetadata(event) {
  await throwErrorIfConfigured(event);

  var url = require('url');

  const host = generateHost(get(event.config, 'environment', 'prod'));
  const path = generatePath(event);
  var q = new URL(host + '/' + path);

  return {
    result: q.href
  };
}

/**
 * generateAddress
 *
 * @param {Object} env - the environment retrieved from configuration
 * @throws {InvalidArgument} if the env is not valid
 * @returns {String} - the corresponding OPeNDAP address
 */
function generateHost(env) {
  var validEnvs = ['prod', 'uat', 'sit'];
  if (validEnvs.includes(env)) {
    env = (env == 'prod' ? '' : env + '.');
  }
  else {
    // Throw an exception if it is not a valid environment
    throw new InvalidArgument(`Environment ${env} is not a valid environment.`);
  }
  return ('https://opendap.' + env + 'earthdata.nasa.gov');
}

/**
 * generatePath
 *
 * @param {Object} event - the event
 * @throws {Object} invalidArgumentException - if the env is not valid
 * @returns {String} - the OPeNDAP path
 */
function generatePath(event) {
  const config = event.config;
  const providerId = get(config, 'provider');
  // Check if providerId is defined
  if (typeof providerId === 'undefined') {
    throw new InvalidArgument(`Provider not supplied in configuration. Unable to construct path`);
  }
  const entryTitle = get(config, 'entryTitle');
  // Check if entryTitle is defined
  if (typeof entryTitle === 'undefined') {
    throw new InvalidArgument(`Entry Title not supplied in configuration. Unable to construct path`);
  }
  // TODO retrieve native ID from source metadata file.
  const metadata = ''
  const nativeId = 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4'
  const path = 'providers/' + providerId + '/collections/' + entryTitle + '/granules/' + nativeId;

  return path;
}

/**
 * generateNativeId
 *
 * @param {String} metadataContents - the metadata
 * @returns {String} - the native id
 */
function getNativeId(metadata) {
  
  var metadataObject = null;
  try {
    // Is this UMM-G or ECHO10?
    metadataObject = JSON.parse(metadata);
    // UMM-G: meta/native-id
    const nativeId = metadataObject.meta['native-id']
    return nativeId;
  } catch (e) {
    // ECHO10: Granule/DataGranule/ProducerGranuleId
    const parseString = require('xml2js').parseString;
    
    var nativeId = null;
    parseString(metadata, function (err, result) {
       nativeId = result.Granule.DataGranule[0].ProducerGranuleId[0];
    });
    return nativeId;
  }
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
exports.generateHost = generateHost; // exported to support testing
exports.generatePath = generatePath; // exported to support testing
exports.getNativeId = getNativeId; // exported to support testing