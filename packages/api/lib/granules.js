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
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
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
const translateGranule = async (
  granule,
  fileUtils = FileUtils
) => {
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
* Move granule 'file' S3 Objects and update Postgres/Dynamo/CMR metadata with new locations
*
* @param {Object} params                                - params object
* @param {Object} params.apiGranule                     - API 'granule' object to move
* @param {Object} params.granulesModel                  - DynamoDB granules model instance
* @param {Object} params.destinations                   - 'Destinations' API object ()
* @param {Object} params.granulePgModel                 - parameter override, used for unit testing
* @param {Object} params.collectionPgModel              - parameter override, used for unit testing
* @param {Object} params.filesPgModel                   - parameter override, used for unit testing
* @param {Object} params.esClient                       - parameter override, used for unit testing
* @param {Object} params.dbClient                       - parameter override, used for unit testing
* @returns {Promise<Object>} - Object containing an 'updated'
*  files object with current file key values and an error object containing a set of
*  Promise.allSettled errors
*/
async function moveGranuleFilesAndUpdateDatastore(params) {
  const {
    apiGranule,
    granulesModel,
    destinations,
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    filesPgModel = new FilePgModel(),
    dbClient = await getKnexClient(),
    esClient = await Search.es(),
  } = params;

  const { name, version } = deconstructCollectionId(apiGranule.collectionId);
  const postgresCumulusGranuleId = await granulePgModel.getRecordCumulusId(dbClient, {
    granule_id: apiGranule.granuleId,
    collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
      dbClient,
      { name, version }
    ),
  });
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
  await granulesModel.update(
    { granuleId: apiGranule.granuleId },
    {
      files: updatedFiles,
    }
  );

  await indexer.upsertGranule({
    esClient,
    updates: {
      ...apiGranule,
      files: updatedFiles,
    },
    index: process.env.ES_INDEX,
  });

  const filteredResults = moveResults.filter((r) => r.status === 'rejected');
  const moveGranuleErrors = filteredResults.map((error) => error.reason);

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
    ); const distributionBucketMap = await fetchDistributionBucketMap();

  const {
    updatedFiles,
    moveGranuleErrors,
  } = await moveGranuleFilesAndUpdateDatastore({ apiGranule, granulesModel, destinations });
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
    throw new Error(JSON.stringify({
      reason: 'Failed to move granule',
      granule: apiGranule,
      errors: moveGranuleErrors,
      granuleFilesRecords: updatedFiles,
    }));
  }
}

const SCROLL_SIZE = 500; // default size in Kibana

function getTotalHits(bodyHits) {
  if (bodyHits.total.value === 0) {
    return 0;
  }
  return bodyHits.total.value || bodyHits.total;
}

/**
 * Returns an array of granules from ElasticSearch query
 *
 * @param {Object} payload
 * @param {string} [payload.index] - ES index to query
 * @param {string} [payload.query] - ES query
 * @param {Object} [payload.source] - List of IDs to operate on
 * @param {Object} [payload.testBodyHits] - Optional body.hits for testing.
 *  Some ES such as Cloud Metrics returns `hits.total.value` rather than `hits.total`
 * @returns {Promise<Array<Object>>}
 */
async function granuleEsQuery({
  index,
  query,
  source,
  testBodyHits,
}) {
  const granules = [];
  const responseQueue = [];

  const client = await Search.es(undefined, true);
  const searchResponse = await client.search({
    index,
    scroll: '30s',
    size: SCROLL_SIZE,
    _source: source,
    body: query,
  });

  responseQueue.push(searchResponse);

  while (responseQueue.length) {
    const { body } = responseQueue.shift();
    const bodyHits = testBodyHits || body.hits;

    bodyHits.hits.forEach((hit) => {
      granules.push(hit._source);
    });

    const totalHits = getTotalHits(bodyHits);

    if (totalHits !== granules.length) {
      responseQueue.push(
        // eslint-disable-next-line no-await-in-loop
        await client.scroll({
          scrollId: body._scroll_id,
          scroll: '30s',
        })
      );
    }
  }
  return granules;
}

/**
 * Return a unique list of granule IDs based on the provided list or the response from the
 * query to ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @returns {Promise<Array<string>>}
 */
async function getGranuleIdsForPayload(payload) {
  const { ids, index, query } = payload;
  const granuleIds = ids || [];

  // query ElasticSearch if needed
  if (granuleIds.length === 0 && payload.query) {
    log.info('No granule ids detected. Searching for granules in Elasticsearch.');

    const granules = await granuleEsQuery({
      index,
      query,
      source: ['granuleId'],
    });

    granules.map((granule) => granuleIds.push(granule.granuleId));
  }

  // Remove duplicate Granule IDs
  // TODO: could we get unique IDs from the query directly?
  const uniqueGranuleIds = [...new Set(granuleIds)];
  return uniqueGranuleIds;
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
 * @returns {Promise<Array<Object>>}
 */
async function getGranulesForPayload(payload) {
  const { granules, index, query } = payload;
  const queryGranules = granules || [];

  // query ElasticSearch if needed
  if (!granules && query) {
    log.info('No granules detected. Searching for granules in ElasticSearch.');

    const esGranules = await granuleEsQuery({
      index,
      query,
      source: ['granuleId', 'collectionId'],
    });

    esGranules.map((granule) => queryGranules.push({
      granuleId: granule.granuleId,
      collectionId: granule.collectionId,
    }));
  }
  // Remove duplicate Granule IDs
  // TODO: could we get unique IDs from the query directly?
  const uniqueGranules = uniqWith(queryGranules, isEqual);
  return uniqueGranules;
}

module.exports = {
  moveGranule,
  translateGranule,
  getExecutionProcessingTimeInfo,
  getGranulesForPayload,
  getGranuleIdsForPayload,
  granuleEsQuery,
  moveGranuleFilesAndUpdateDatastore,
};
