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
  CollectionPgModel,
  FilePgModel,
  getKnexClient,
  GranulePgModel,
  translateApiFiletoPostgresFile,
} = require('@cumulus/db');

const {
  getBucketsConfigKey,
  getDistributionBucketMapKey,
} = require('@cumulus/common/stack');


const { deconstructCollectionId } = require('./utils');
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

// TODO -- Docstring
async function updateGranuleFilesInDataStore(apiGranule, granulesModel, updatedFiles) {
  const dbClient = await getKnexClient();
  const filesPgModel = new FilePgModel();
  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();
  let postgresCumulusGranuleId;

  try {
    const { name, version } = deconstructCollectionId(apiGranule.collectionId);
    postgresCumulusGranuleId = await granulePgModel.getRecordCumulusId(dbClient, {
      granule_id: apiGranule.granuleId,
      collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
        dbClient,
        { name, version }
      ),
    });
  } catch (error) {
    if (error.name !== 'RecordDoesNotExist') {
      return granulesModel.update(
        { granuleId: apiGranule.granuleId },
        {
          files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
        }
      );
    }
    throw error;
  }

  return dbClient.transaction(async (trx) => {
    await filesPgModel.delete(trx, { granule_cumulus_id: postgresCumulusGranuleId });

    await Promise.all(updatedFiles.map((file) => {
      const translatedFile = translateApiFiletoPostgresFile(renameProperty('name', 'fileName', file));
      return filesPgModel.upsert(trx, {
        ...translatedFile,
        granule_cumulus_id: postgresCumulusGranuleId,
      });
    }));

    return granulesModel.update(
      { granuleId: apiGranule.granuleId },
      {
        files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
      }
    );
  });
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

  // TODO: moveGranuleFiles has a Promise.all with no rollback of any sort if a file move fails.
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
