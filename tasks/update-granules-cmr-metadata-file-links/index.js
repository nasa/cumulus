'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash/get');
const keyBy = require('lodash/keyBy');

const { buildS3Uri } = require('@cumulus/aws-client/S3');
const { fetchDistributionBucketMap } = require('@cumulus/distribution-utils');

const BucketsConfig = require('@cumulus/common/BucketsConfig');

const {
  isCMRFile,
  granulesToCmrFileObjects,
  updateCMRMetadata,
} = require('@cumulus/cmrjs');

/**
 * Add ETags to file objects as some downstream functions expect this structure.
 *
 * @param {Object} granule - input granule object
 * @param {Object} etags - map of s3URIs and ETags
 * @returns {Object} - updated granule object
 */
const addEtagsToFileObjects = (granule, etags) => {
  granule.files.forEach((file) => {
    const fileURI = buildS3Uri(file.bucket, file.key);
    // eslint-disable-next-line no-param-reassign
    if (etags[fileURI]) file.etag = etags[fileURI];
  });
  return granule;
};

/**
 * Remove ETags to match output schema
 *
 * @param {Object} granule - output granule object
 * @returns {undefined}
 */
const removeEtagsFromFileObjects = (granule) => {
  granule.files.filter(isCMRFile).forEach((file) => {
    // eslint-disable-next-line no-param-reassign
    delete file.etag;
  });
};

/**
 * Update each of the CMR files' OnlineAccessURL fields to represent the new
 * file locations. This function assumes that there will only ever be a single CMR file per granule.
 *
 * @param {Array<Object>} cmrFiles       - array of objects that include CMR xmls uris and
 *                                         granuleIds
 * @param {Object} granulesObject        - an object of the granules where the key is the granuleId
 * @param {string} cmrGranuleUrlType .   - type of granule CMR url
 * @param {string} distEndpoint          - the api distribution endpoint
 * @param {Object} bucketTypes           - map of bucket names to bucket types
 * @param {Object} distributionBucketMap - mapping of bucket->distirubtion path values
 *                                         (e.g. { bucket: distribution path })
 * @returns {Promise<Object[]>} Array of updated CMR files with etags of newly updated files.
 *
 */
async function updateEachCmrFileAccessURLs(
  cmrFiles,
  granulesObject,
  cmrGranuleUrlType,
  distEndpoint,
  bucketTypes,
  distributionBucketMap
) {
  return await Promise.all(cmrFiles.map(async (cmrFile) => {
    const granuleId = cmrFile.granuleId;
    const granule = granulesObject[granuleId];
    return await updateCMRMetadata({
      granuleId,
      cmrFile: granule.files.find(isCMRFile),
      files: granule.files,
      distEndpoint,
      published: false,
      bucketTypes,
      cmrGranuleUrlType,
      distributionBucketMap,
    });
  }));
}

/**
 * Maps etag values from the specified granules' CMR files.
 *
 * @param {Object[]} cmrFiles - array of CMR file objects with `filename` and
 *    `etag` properties
 * @returns {Object} granule mapping identical to input granule mapping, but
 *    with CMR file objects updated with the `etag` values supplied via the
 *    array of CMR file objects, matched by `filename`
 */
function mapCmrFileEtags(cmrFiles) {
  return Object.fromEntries(
    cmrFiles.map(({ bucket, key, etag }) => [buildS3Uri(bucket, key), etag])
  );
}

async function updateGranulesCmrMetadataFileLinks(event) {
  const config = event.config;
  const bucketsConfig = new BucketsConfig(config.buckets);
  const bucketTypes = Object.fromEntries(Object.values(bucketsConfig.buckets)
    .map(({ name, type }) => [name, type]));

  const cmrGranuleUrlType = get(config, 'cmrGranuleUrlType', 'both');

  const incomingETags = event.config.etags;
  const granules = event.input.granules.map((g) => addEtagsToFileObjects(g, incomingETags));
  const cmrFiles = granulesToCmrFileObjects(granules);
  const granulesByGranuleId = keyBy(granules, 'granuleId');

  const distributionBucketMap = await fetchDistributionBucketMap();
  const updatedCmrFiles = await updateEachCmrFileAccessURLs(
    cmrFiles,
    granulesByGranuleId,
    cmrGranuleUrlType,
    config.distribution_endpoint,
    bucketTypes,
    distributionBucketMap
  );

  // Map etag info from granules' CMR files
  const updatedCmrETags = mapCmrFileEtags(updatedCmrFiles);
  const outputGranules = Object.values(granulesByGranuleId);
  outputGranules.forEach(removeEtagsFromFileObjects);
  return {
    granules: outputGranules,
    etags: { ...incomingETags, ...updatedCmrETags },
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
  return await cumulusMessageAdapter.runCumulusTask(
    updateGranulesCmrMetadataFileLinks,
    event, context
  );
}

exports.handler = handler;
exports.updateGranulesCmrMetadataFileLinks = updateGranulesCmrMetadataFileLinks;
