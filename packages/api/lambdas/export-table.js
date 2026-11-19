//@ts-check

'use strict';

const noop = require('lodash/noop');
const Stream = require('stream');
const zlib = require('zlib');
const { Transform } = require('json2csv');

const Logger = require('@cumulus/logger');
const { promiseS3Upload, buildS3Uri } = require('@cumulus/aws-client/S3');
const S3ObjectStore = require('@cumulus/aws-client/S3ObjectStore');
const {
  getKnexClient,
  QuerySearchClient,
  GranuleSearch,
  ExecutionSearch,
  CollectionSearch,
  ProviderSearch,
  PdrSearch,
} = require('@cumulus/db');

const log = new Logger({ sender: '@api/lambdas/export-table' });

// Number of rows fetched per round-trip to Postgres while streaming the
// export. The ECS task running this lambda has no API Gateway/Lambda
// timeout, so this can be larger than the batch size used by
// request/response-bound report generation (e.g. the granule inventory
// report uses 100).
const PAGE_BATCH_SIZE = 500;

/**
 * Per-resource-type configuration: which Search class builds the query, and
 * which flat columns (as returned by that Search class's joined query) get
 * written out as CSV columns.
 *
 * Deliberately NOT using the translatePostgres*ToApi* functions here to avoid
 * the extra per-record DB queries (file lookups, execution lookups) that would turn
 * a 500K-row export into 500K+ extra round trips. Mapping the already
 * joined/selected row directly to CSV columns avoids that entirely.
 */
const RESOURCE_CONFIG = {
  granule: {
    SearchClass: GranuleSearch,
    fields: [
      'granule_id',
      'collectionName',
      'collectionVersion',
      'status',
      'providerName',
      'pdrName',
      'published',
      'duration',
      'created_at',
      'updated_at',
    ],
  },
  execution: {
    SearchClass: ExecutionSearch,
    fields: [
      'arn',
      'collectionName',
      'collectionVersion',
      'status',
      'workflow_name',
      'duration',
      'created_at',
      'updated_at',
    ],
  },
  collection: {
    SearchClass: CollectionSearch,
    fields: [
      'name',
      'version',
      'cmr_provider',
      'duplicate_handling',
      'report_to_ems',
      'created_at',
      'updated_at',
    ],
  },
  provider: {
    SearchClass: ProviderSearch,
    fields: [
      'name',
      'protocol',
      'host',
      'port',
      'global_connection_limit',
      'created_at',
      'updated_at',
    ],
  },
  pdr: {
    SearchClass: PdrSearch,
    fields: [
      'name',
      'collectionName',
      'collectionVersion',
      'providerName',
      'status',
      'progress',
      'duration',
      'created_at',
      'updated_at',
    ],
  },
};

/**
 * Stream every row matching `searchQuery` (paged via QuerySearchClient)
 * through a CSV transform and a gzip transform, uploading the result to S3.
 *
 * @param {object} params
 * @param {import('knex').Knex.QueryBuilder} params.searchQuery
 * @param {string[]} params.fields - CSV column names (also used as the row object keys)
 * @param {string} params.bucket - S3 bucket to upload to
 * @param {string} params.key - S3 key to upload to
 * @returns {Promise<{ rowCount: number }>}
 */
async function streamQueryToS3Csv({
  searchQuery, fields, bucket, key,
}) {
  const pager = new QuerySearchClient(searchQuery, PAGE_BATCH_SIZE);

  const readable = new Stream.Readable({ objectMode: true });
  readable._read = noop;
  const json2csv = new Transform({ fields }, { objectMode: true });
  const pass = new Stream.PassThrough();
  readable.pipe(json2csv).pipe(zlib.createGzip()).pipe(pass);

  const uploadPromise = promiseS3Upload({
    params: {
      Bucket: bucket,
      Key: key,
      Body: /** @type {any} */ (pass),
      ContentType: 'text/csv',
      ContentEncoding: 'gzip',
    },
  });

  let rowCount = 0;
  let nextRecord = await pager.peek();
  while (nextRecord) {
    const record = /** @type {any} */ (nextRecord);
    /** @type {Record<string, unknown>} */
    const row = {};
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i];
      row[field] = (record[field] !== undefined && record[field] !== null)
        ? record[field]
        : '';
    }
    readable.push(row);
    rowCount += 1;
    await pager.shift(); // eslint-disable-line no-await-in-loop
    nextRecord = await pager.peek(); // eslint-disable-line no-await-in-loop
  }
  readable.push(null);

  await uploadPromise;
  return { rowCount };
}

/**
 * Export table lambda handler.
 *
 * Builds the resource's search query (reusing the exact same filter
 * vocabulary as that resource's `GET` list endpoint, via
 * `BaseSearch.getSearchQuery`), streams the full matching result set to a
 * gzipped CSV in S3, and returns a presigned download URL. This return
 * value becomes the AsyncOperation record's `output` field.
 *
 * @param {object} payload
 * @param {'granule'|'execution'|'collection'|'provider'|'pdr'} payload.resourceType
 * @param {Record<string, string>} [payload.queryStringParameters]
 * @param {string} payload.asyncOperationId
 * @returns {Promise<{ presignedS3Url: string|null, rowCount: number }>}
 */
async function handler(payload) {
  const { resourceType, queryStringParameters = {}, asyncOperationId } = payload;

  const resourceConfig = RESOURCE_CONFIG[resourceType];
  if (!resourceConfig) {
    throw new Error(`Unsupported export resourceType: ${resourceType}. `
      + `Expected one of: ${Object.keys(RESOURCE_CONFIG).join(', ')}`);
  }

  const { SearchClass, fields } = resourceConfig;
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;
  if (!systemBucket) throw new Error('The system_bucket environment variable must be set');
  if (!stackName) throw new Error('The stackName environment variable must be set');

  const knex = await getKnexClient();

  // Force "no limit" (full result set) regardless of what the caller passed -
  // convertQueryStringToDbQueryParameters treats the literal string 'null'
  // (not JS null/undefined) as "remove the limit".
  const search = new SearchClass({
    queryStringParameters: { ...queryStringParameters, limit: 'null' },
  });
  const searchQuery = search.getSearchQuery(knex);

  const key = `${stackName}/exports/${resourceType}/${asyncOperationId}.csv.gz`;

  log.info(`Starting export of ${resourceType} records to s3://${systemBucket}/${key}`);

  const { rowCount } = await streamQueryToS3Csv({
    searchQuery, fields, bucket: systemBucket, key,
  });

  if (rowCount === 0) {
    log.info(`Export of ${resourceType} matched no records; skipping presigned URL generation`);
    return { presignedS3Url: null, rowCount: 0 };
  }

  const s3ObjectStoreClient = new S3ObjectStore();
  const s3ObjectUrl = buildS3Uri(systemBucket, key);
  const downloadFileName = `${resourceType}-export-${asyncOperationId}.csv.gz`;
  const presignedS3Url = await s3ObjectStoreClient.signGetObject(
    s3ObjectUrl,
    { ResponseContentDisposition: `attachment; filename="${downloadFileName}"` }
  );

  log.info(`Completed export of ${resourceType}: ${rowCount} rows written to s3://${systemBucket}/${key}`);

  return { presignedS3Url, rowCount };
}

module.exports = {
  handler,
  RESOURCE_CONFIG,
};
