'use strict';

const isEqual = require('lodash/isEqual');
const isNil = require('lodash/isNil');
const isNumber = require('lodash/isNumber');
const uniqWith = require('lodash/uniqWith');

const awsClients = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');
const s3Utils = require('@cumulus/aws-client/S3');
const CmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { deconstructCollectionId } = require('@cumulus/message/Collections');

const {
  generateMoveFileParams,
  moveGranuleFile,
  getNameOfFile,
} = require('@cumulus/ingest/granule');

const {
  CollectionPgModel,
  FilePgModel,
  getKnexClient,
  GranulePgModel,
} = require('@cumulus/db');
const { getEsClient } = require('@cumulus/es-client/search');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { fetchDistributionBucketMap } = require('@cumulus/distribution-utils');

const FileUtils = require('./FileUtils');

/**
 * translate an old-style granule file and numeric productVolume into the new schema
 *
 * @param {Object} granule - granule object to be translated
 * @param {Function} fileUtils - utility to convert files to new schema
 * @returns {Object} - translated granule object
 */
const translateGranule = async (granule, fileUtils = FileUtils) => {
  let { files, productVolume } = granule;
  if (!isNil(files)) {
    files = await fileUtils.buildDatabaseFiles({
      s3: awsClients.s3(),
      files: granule.files,
    });
  }
  if (!isNil(productVolume) && isNumber(productVolume)) {
    productVolume = productVolume.toString();
  }

  return {
    ...granule,
    ...(files && { files }),
    ...(productVolume && { productVolume }),
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

/**
 * Move granule 'file' S3 Objects and update Postgres/CMR metadata with new locations
 *
 * @param {Object} params                                - params object
 * @param {Object} params.apiGranule                     - API 'granule' object to move
 * @param {Object} params.granulesModel                  - DynamoDB granules model instance
 * @param {Object} params.destinations                   - 'Destinations' API object ()
 * @param {Object} params.granulePgModel                 - parameter override, used for unit testing
 * @param {Object} params.collectionPgModel              - parameter override, used for unit testing
 * @param {Object} params.filesPgModel                   - parameter override, used for unit testing
 * @param {Object} params.dbClient                       - parameter override, used for unit testing
 * @returns {Promise<Object>} - Object containing an 'updated'
 *  files object with current file key values and an error object containing a set of
 *  Promise.allSettled errors
 */
async function moveGranuleFilesAndUpdateDatastore(params) {
  const {
    apiGranule,
    destinations,
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    filesPgModel = new FilePgModel(),
    dbClient = await getKnexClient(),
  } = params;

  const { name, version } = deconstructCollectionId(apiGranule.collectionId);
  const postgresCumulusGranuleId = await granulePgModel.getRecordCumulusId(
    dbClient,
    {
      granule_id: apiGranule.granuleId,
      collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
        dbClient,
        { name, version }
      ),
    }
  );
  const updatedFiles = [];
  const moveFileParams = generateMoveFileParams(apiGranule.files, destinations);
  const moveFilePromises = moveFileParams.map(async (moveFileParam) => {
    const { file } = moveFileParam;
    try {
      await dbClient.transaction(async (trx) => {
        const updatedFile = await moveGranuleFile(
          moveFileParam,
          filesPgModel,
          trx,
          postgresCumulusGranuleId
        );
        updatedFiles.push(updatedFile);
      });
    } catch (error) {
      updatedFiles.push({ ...file, fileName: getNameOfFile(file) });
      log.error(`Failed to move file ${JSON.stringify(moveFileParam)} -- ${JSON.stringify(error.message)}`);
      error.message = `${JSON.stringify(moveFileParam)}: ${error.message}`;
      throw error;
    }
  });

  const moveResults = await Promise.allSettled(moveFilePromises);
  const filteredResults = moveResults.filter((r) => r.status === 'rejected');
  const moveGranuleErrors = filteredResults.map((error) => error.reason);

  return { updatedFiles, moveGranuleErrors };
}

/**
 * With the params for moving a granule, return the files that already exist at
 * the move location
 *
 * @param {Object} granule - the granule object
 * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
 * - list of destinations specified
 *    regex - regex for matching filepath of file to new destination
 *    bucket - aws bucket of the destination
 *    filepath - file path/directory on the bucket for the destination
 * @returns {Promise<Array<Object>>} - promise that resolves to a list of files
 * that already exist at the destination that they would be written to if they
 * were to be moved via the move granules call
 */
async function getFilesExistingAtLocation(granule, destinations) {
  const moveFileParams = generateMoveFileParams(granule.files, destinations);

  const fileExistsPromises = moveFileParams.map(async (moveFileParam) => {
    const { target, file } = moveFileParam;
    if (target) {
      const exists = await s3Utils.fileExists(target.Bucket, target.Key);

      if (exists) {
        return Promise.resolve(file);
      }
    }

    return Promise.resolve();
  });

  const existingFiles = await Promise.all(fileExistsPromises);

  return existingFiles.filter((file) => file);
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
async function moveGranule(apiGranule, destinations, distEndpoint) {
  log.info(`granules.move ${apiGranule.granuleId}`);

  const bucketsConfig = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    getBucketsConfigKey(process.env.stackName)
  );

  const bucketTypes = Object.values(bucketsConfig).reduce(
    (acc, { name, type }) => ({ ...acc, [name]: type }),
    {}
  );
  const distributionBucketMap = await fetchDistributionBucketMap();

  const {
    updatedFiles,
    moveGranuleErrors,
  } = await moveGranuleFilesAndUpdateDatastore({ apiGranule, destinations });

  await CmrUtils.reconcileCMRMetadata({
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
    throw new Error(
      JSON.stringify({
        reason: 'Failed to move granule',
        granule: apiGranule,
        errors: moveGranuleErrors,
        granuleFilesRecords: updatedFiles,
      })
    );
  }
}

/**
 * Return a unique list of granules based on the provided list or the response from the
 * query to ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {Object} [payload.granules] - Optional list of granules with granuleId and collectionId
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @returns {Array<ApiGranule>}
 */
const getGranulesForPayload = (payload) => {
  const { granules } = payload;
  const queryGranules = granules || [];

  // query ElasticSearch if needed
  if (queryGranules.length === 0) {
    log.info('No granules detected');
  }
  // Remove duplicate Granule IDs
  // TODO: could we get unique IDs from the query directly?
  const uniqueGranules = uniqWith(queryGranules, isEqual);
  return uniqueGranules;
};

module.exports = {
  getExecutionProcessingTimeInfo,
  getFilesExistingAtLocation,
  getGranulesForPayload,
  moveGranule,
  moveGranuleFilesAndUpdateDatastore,
  translateGranule,
};
