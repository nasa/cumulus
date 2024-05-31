'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash/get');
const keyBy = require('lodash/keyBy');
const { getObjectSize } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

const { fetchDistributionBucketMap } = require('@cumulus/distribution-utils');

const BucketsConfig = require('@cumulus/common/BucketsConfig');

const {
  addEtagsToFileObjects,
  isCMRFile,
  granulesToCmrFileObjects,
  mapFileEtags,
  removeEtagsFromFileObjects,
  updateCMRMetadata,
} = require('@cumulus/cmrjs');

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

async function updateCmrFileInfo(cmrFiles, granulesByGranuleId) {
  for (const cmrFileObject of cmrFiles) {
    let cmrFile = await granulesByGranuleId[cmrFileObject.granuleId].files.find(isCMRFile);

    if (cmrFile) {
      delete cmrFile.checksum;
      delete cmrFile.checksumType
    }

    const bucket = cmrFileObject.bucket;
    const key = cmrFileObject.key;

    cmrFile.size = await getObjectSize({ s3: s3(), bucket, key });
  }
}

async function updateGranulesCmrMetadataFileLinks(event) {
  const config = event.config;
  const bucketsConfig = new BucketsConfig(config.buckets);
  const bucketTypes = Object.fromEntries(Object.values(bucketsConfig.buckets)
    .map(({ name, type }) => [name, type]));

  const cmrGranuleUrlType = get(config, 'cmrGranuleUrlType', 'both');

  const incomingETags = event.config.etags || {};
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

  await updateCmrFileInfo(cmrFiles, granulesByGranuleId);

  // Map etag info from granules' CMR files
  const updatedCmrETags = mapFileEtags(updatedCmrFiles);
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
