'use strict';

const isEqual = require('lodash/isEqual');
const isNil = require('lodash/isNil');
const isNumber = require('lodash/isNumber');
const uniqWith = require('lodash/uniqWith');

const readline = require('readline');

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
  ReconciliationReportPgModel,
} = require('@cumulus/db');
const { getEsClient } = require('@cumulus/es-client/search');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { fetchDistributionBucketMap } = require('@cumulus/distribution-utils');

const { errorify, RecordDoesNotExist } = require('@cumulus/errors');
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
    log.error(errorify(moveGranuleErrors));
    throw new Error(
      errorify({
        reason: 'Failed to move granule',
        granule: apiGranule,
        errors: moveGranuleErrors,
        granuleFilesRecords: updatedFiles,
      })
    );
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
 * Returns an array of granules from an ElasticSearch query
 *
 * @param {Object} payload
 * @param {string} [payload.index] - ES index to query (Cloud Metrics)
 * @param {string} [payload.query] - ES query
 * @param {Object} [payload.source] - List of IDs to operate on
 * @param {Object} [payload.testBodyHits] - Optional body.hits for testing.
 *  Some ES such as Cloud Metrics returns `hits.total.value` rather than `hits.total`
 * @returns {Promise<Array<Object>>}
 */
async function granuleEsQuery({ index, query, source, testBodyHits }) {
  const granules = [];
  const responseQueue = [];

  const esClient = await getEsClient(undefined, true);
  const searchResponse = await esClient.client.search({
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
        await esClient.client.scroll({
          scrollId: body._scroll_id,
          scroll: '30s',
        })
      );
    }
  }
  return granules;
}

/**
 * Reads a comma-separated granule inventory report or text file from S3
 * where each record starts with granuleId, and yields granuleIds in batches.
 *
 * The S3 object is expected to be a line-delimited file where:
 * - The first line may be a header starting with "granuleUr".
 * - Each subsequent line contains a granuleId as the first column
 *
 * @param {Object} params
 * @param {string} params.s3Uri - S3 URI pointing to the granules file
 * @param {number} [params.batchSize=100] - Number of granuleIds to include per batch
 * @yields {Array<string>} A batch of granuleIds
 * @throws {Error} If the S3 object does not exist
 */
async function* getGranulesFromS3InBatches({
  s3Uri,
  batchSize = 100,
}) {
  const parsed = s3Utils.parseS3Uri(s3Uri);
  const exists = await s3Utils.fileExists(parsed.Bucket, parsed.Key);
  if (!exists) {
    const msg = `Granules file does not exist ${s3Uri}`;
    log.error(msg);
    throw new Error(msg);
  }
  const response = await s3Utils.getObject(awsClients.s3(), parsed);

  const rl = readline.createInterface({
    input: response.Body,
    crlfDelay: Infinity,
  });

  let batch = [];
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;
    const trimmed = line.trim();

    if (trimmed) {
      const isHeader = (lineNumber === 1) && (trimmed.startsWith('"granuleUr"'));

      if (!isHeader) {
        const [granuleId] = trimmed.split(',');

        if (granuleId) {
          batch.push(granuleId.replace(/^"+|"+$/g, ''));
        }
      }

      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}

/**
 * Resolves a reconciliation report name to its S3 location.
 *
 * Looks up the report record in PostgreSQL and returns the associated
 * S3 location, if it exists.
 *
 * @param {string} reportName - Name of the reconciliation report
 * @returns {Promise<string|undefined>} The S3 location of the report, or undefined if not found
 * @throws {Error} Rethrows unexpected database errors
 */
async function resolveReportToS3Location(reportName) {
  const reconciliationReportPgModel = new ReconciliationReportPgModel();
  const knex = await getKnexClient();
  let pgReport;
  try {
    pgReport = await reconciliationReportPgModel.get(knex, { name: reportName });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(
        `granule inventory report ${reportName} does not exist`
      );
    } else {
      throw error;
    }
  }
  return pgReport?.location;
}

/**
 * Returns granuleIds based on the provided payload.
 *
 * Granules may be resolved from:
 * - A direct S3 URI
 * - A granule inventory report name (resolved to S3)
 * - An explicit list of granuleIds
 * - An ElasticSearch (Cloud Metrics) query
 *
 * Results are yielded as batches when sourced from S3, or as a single
 * deduplicated list otherwise.
 *
 * @param {Object} payload
 * @param {number} [payload.batchSize] - Batch size for yielded granuleIds
 * @param {Array<string>} [payload.granules] - Optional list of granuleIds
 * @param {Object} [payload.query] - Optional ElasticSearch query (Cloud Metrics)
 * @param {string} [payload.index] - ElasticSearch index (required if query is provided)
 * @param {string} [payload.s3GranuleIdInputFile] - S3 URI of an input file where each record
 *   starts with a granuleId and may include additional fields.
 * @param {string} [payload.granuleInventoryReportName] - Logical name of a granule inventory
 *   report. The name is resolved via the database to obtain the report’s S3 URI.
 * @yields {Array<string>} A list or batch of granuleIds
 */
async function* getGranulesForPayload(payload) {
  const {
    batchSize, granules, index, query, s3GranuleIdInputFile, granuleInventoryReportName,
  } = payload;

  // Direct S3 reference
  if (s3GranuleIdInputFile) {
    yield* getGranulesFromS3InBatches({ s3Uri: s3GranuleIdInputFile, batchSize });
    return;
  }

  // Report-based S3 lookup
  if (granuleInventoryReportName) {
    const report = await resolveReportToS3Location(granuleInventoryReportName);
    yield* getGranulesFromS3InBatches({ s3Uri: report, batchSize });
    return;
  }

  const queryGranules = granules || [];
  // query ElasticSearch (Cloud Metrics) if needed
  if (queryGranules.length === 0 && query) {
    log.info('No granules detected. Searching for granules in ElasticSearch.');

    const esGranules = await granuleEsQuery({
      index,
      query,
      source: ['granuleId', 'collectionId'],
    });

    esGranules.map((granule) =>
      queryGranules.push(granule.granuleId));
  }
  // Remove duplicate Granule IDs
  // TODO: could we get unique IDs from the query directly?
  const uniqueGranules = uniqWith(queryGranules, isEqual);
  yield uniqueGranules;
}

module.exports = {
  getExecutionProcessingTimeInfo,
  getFilesExistingAtLocation,
  getGranulesForPayload,
  moveGranule,
  granuleEsQuery,
  moveGranuleFilesAndUpdateDatastore,
  translateGranule,
};
