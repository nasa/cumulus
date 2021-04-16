'use strict';

const isInteger = require('lodash/isInteger');
const isNil = require('lodash/isNil');
const partial = require('lodash/partial');

const awsClients = require('@cumulus/aws-client/services');
const s3Utils = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');

const {
  moveGranuleFiles,
} = require('@cumulus/ingest/granule');

const {
  FilePgModel,
  getKnexClient,
  GranulePgModel,
  translateApiFiletoPostgresFile,
} = require('@cumulus/db');

const {
  getBucketsConfigKey,
  getDistributionBucketMapKey,
} = require('@cumulus/common/stack');

const FileUtils = require('./FileUtils');

const translateGranule = async (
  granule,
  fileUtils = FileUtils
) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await fileUtils.buildDatabaseFiles({
      s3: awsClients.s3(),
      files: granule.files,
    }),
  };
};

const getExecutionProcessingTimeInfo = ({
  startDate,
  stopDate,
  now = new Date(),
}) => {
  const processingTimeInfo = {};
  if (startDate) {
    processingTimeInfo.processingStartDateTime = startDate.toISOString();
    processingTimeInfo.processingEndDateTime = stopDate
      ? stopDate.toISOString()
      : now.toISOString();
  }
  return processingTimeInfo;
};

/* eslint-disable camelcase */

const getGranuleTimeToPreprocess = ({
  sync_granule_duration = 0,
} = {}) => sync_granule_duration / 1000;

const getGranuleTimeToArchive = ({
  post_to_cmr_duration = 0,
} = {}) => post_to_cmr_duration / 1000;

/* eslint-enable camelcase */

/**
 * Calculate granule product volume, which is the sum of the file
 * sizes in bytes
 *
 * @param {Array<Object>} granuleFiles - array of granule files
 * @returns {Integer} - sum of granule file sizes in bytes
 */
function getGranuleProductVolume(granuleFiles = []) {
  return granuleFiles
    .map((f) => f.size)
    .filter(isInteger)
    .reduce((x, y) => x + y, 0);
}

const renameProperty = (from, to, obj) => {
  const newObj = { ...obj, [to]: obj[from] };
  delete newObj[from];
  return newObj;
};

// TODO: put this in api/lib?
async function updateGranuleFilesInDataStore(apiGranule, granulesModel, updatedFiles) {
  try {
    const dbClient = await getKnexClient();
    const filesPgModel = new FilePgModel();
    const granulePgModel = new GranulePgModel();

    const postgresGranules = await granulePgModel.search(dbClient, {
      granule_id: apiGranule.granuleId,
    });
    // If there's a granule record in Postgres
    if (postgresGranules.length === 1) {
      let granuleModelUpdate;
      const granuleCumulusId = postgresGranules[0].cumulus_id;
      if (!granuleCumulusId) {
        // This is bad as files have moved, but the DB write failed.   Yikes.
        throw new Error('Granule returned without granule_id, cannot proceed with database write');
      }
      await dbClient.transaction(async (trx) => {
        // Delete all files associated with this granuleCumulusId
        // Again, we've already moved the files.   Yikes.
        await filesPgModel.delete(trx, { granule_cumulus_id: granuleCumulusId });
        await Promise.all(updatedFiles.map((file) => {
          // Translate dynamo file to postgres file
          const translatedFile = translateApiFiletoPostgresFile(renameProperty('name', 'fileName', file));
          return filesPgModel.upsert(trx, { ...translatedFile, granule_cumulus_id: granuleCumulusId });
        }));
        // Call update, set files equal to updatedFiles in Dynamo
        granuleModelUpdate = granulesModel.update(
          { granuleId: apiGranule.granuleId },
          {
            files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
          }
        );
      });
      return granuleModelUpdate;
    }
    if (postgresGranules.length === 0) {
      // TODO abstract this
      return granulesModel.update(
        { granuleId: apiGranule.granuleId },
        {
          files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
        }
      );
    }
    throw new Error('Invalid return from postgres - multiple records matched granuleId search');
  } catch (error) {
    console.log(error);
    throw error;
  }
}

/**
 * Move a granule's files to destinations specified
 *
 * @param {Object} apiGranule - the granule record object
 * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
 *    - list of destinations specified
 *    regex - regex for matching filepath of file to new destination
 *    bucket - aws bucket of the destination
 *    filepath - file path/directory on the bucket for the destination
 * @param {string} distEndpoint - distribution endpoint URL
 * @param {Object} granulesModel - An instance of an API Granule granulesModel
 * @returns {Promise<undefined>} undefined
 */
async function moveGranule(apiGranule, destinations, distEndpoint, granulesModel) {
  log.info(`granules.move ${apiGranule.granuleId}`);

  const bucketsConfig = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    getBucketsConfigKey(process.env.stackName)
  );

  const bucketTypes = Object.values(bucketsConfig)
    .reduce(
      (acc, { name, type }) => ({ ...acc, [name]: type }),
      {}
    );

  const distributionBucketMap = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    getDistributionBucketMapKey(process.env.stackName)
  );

  // TODO: This is *terrible* -
  //  it has a Promise.all with no rollback of any sort if a file move fails.
  const updatedFiles = await moveGranuleFiles(apiGranule.files, destinations);
  await granulesModel.cmrUtils.reconcileCMRMetadata({
    granuleId: apiGranule.granuleId,
    updatedFiles,
    distEndpoint,
    published: apiGranule.published,
    distributionBucketMap,
    bucketTypes,
  });
  await updateGranuleFilesInDataStore(apiGranule, granulesModel, updatedFiles);
}

module.exports = {
  moveGranule,
  translateGranule,
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getGranuleProductVolume,
};
