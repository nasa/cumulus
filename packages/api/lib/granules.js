'use strict';

const isInteger = require('lodash/isInteger');
const isNil = require('lodash/isNil');
const partial = require('lodash/partial');

const awsClients = require('@cumulus/aws-client/services');
const s3Utils = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');

const {
  generateMoveFileParams,
  moveGranuleFiles,
  moveGranuleFile,
} = require('@cumulus/ingest/granule');

const {
  CollectionPgModel,
  FilePgModel,
  getKnexClient,
  GranulePgModel,
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
async function moveGranuleFilesAndUpdateDatastore(params) {
  const {
    apiGranule,
    granulesModel,
    destinations,
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    moveGranuleFilesFunction = moveGranuleFiles,
    filesPgModel = new FilePgModel(),
    dbClient = await getKnexClient(),
  } = params;
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
    // If the granule or associated record hasn't been migrated yet
    // run the 'original' dynamo update
    log.info(`Granule ${JSON.stringify(apiGranule)} has not been migrated yet, updating DynamoDb records only`);
    if (error.name === 'RecordDoesNotExist') {
      const updatedFiles = await moveGranuleFilesFunction(apiGranule.files, destinations);
      await granulesModel.update(
        { granuleId: apiGranule.granuleId },
        {
          files: updatedFiles.map(partial(renameProperty, 'name', 'fileName')),
        }
      );
      return { updatedFiles, moveGranuleErrors: [] };
    }
    throw error;
  }

  const updatedFiles = [];
  const moveFileParams = generateMoveFileParams(apiGranule.files, destinations);
  const moveFilePromises = moveFileParams.map(async (moveFileParam) => {
    const { file } = moveFileParam;
    try {
      // Update the datastores, then move files
      await dbClient.transaction(async (trx) => {
        const updatedFile = await moveGranuleFile(
          moveFileParam,
          filesPgModel,
          trx,
          postgresCumulusGranuleId
        );
        updatedFiles.push(renameProperty('name', 'fileName', updatedFile));
      });
      // Add updated file to postgresDatabase
    } catch (error) {
      updatedFiles.push(file);
      log.error(`Failed to move file ${JSON.stringify(file)} -- ${JSON.stringify(error.message)}`);
      throw error;
    }
  });

  const moveResults = await Promise.allSettled(moveFilePromises);
  await granulesModel.update(
    { granuleId: apiGranule.granuleId },
    {
      files: updatedFiles,
    }
  );
  const moveGranuleErrors = moveResults.filter((r) => r.reason);
  return { updatedFiles, moveGranuleErrors };
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

  const {
    updatedFiles,
    moveGranuleErrors,
  } = await moveGranuleFilesAndUpdateDatastore({ apiGranule, granulesModel, destinations });
  await granulesModel.cmrUtils.reconcileCMRMetadata({
    granuleId: apiGranule.granuleId,
    updatedFiles,
    distEndpoint,
    published: apiGranule.published,
    distributionBucketMap,
    bucketTypes,
  });
  if (moveGranuleErrors.length > 0) {
    log.error(`Granule ${JSON.stringify(apiGranule)} failed to move.`);
    log.error(JSON.stringify(moveGranuleErrors));
    throw new Error(`Failed to move granule: ${JSON.stringify(apiGranule)}. Errors: ${JSON.stringify(moveGranuleErrors)}.  Granule Files final state: ${JSON.stringify(updatedFiles)}`);
  }
}

module.exports = {
  moveGranule,
  translateGranule,
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getGranuleProductVolume,
  moveGranuleFilesAndUpdateDatastore,
};
