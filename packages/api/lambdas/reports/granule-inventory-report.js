'use strict';

const { Transform } = require('json2csv');
const noop = require('lodash/noop');
const Stream = require('stream');
const Logger = require('@cumulus/logger');
const { promiseS3Upload } = require('@cumulus/aws-client/S3');
const {
  getGranulesByApiPropertiesQuery,
  QuerySearchClient,
  translatePostgresGranuleResultToApiGranule,
} = require('@cumulus/db');
const log = new Logger({ sender: '@api/lambdas/granule-inventory-report' });

const { convertToDBGranuleSearchParams } = require('../../lib/reconciliationReport');

/**
 * Builds a CSV file of all granules in the Cumulus DB
 * @param {Object} recReportParams
 * @param {string} recReportParams.reportKey - s3 key to store report
 * @param {string} recReportParams.systemBucket - bucket to store report.
 * @returns {Promise<null>} - promise of a report written to s3.
 */
async function createGranuleInventoryReport(recReportParams) {
  log.info(
    `createGranuleInventoryReport parameters ${JSON.stringify(recReportParams)}`
  );

  const fields = [
    'granuleUr',
    'collectionId',
    'createdAt',
    'startDateTime',
    'endDateTime',
    'status',
    'updatedAt',
    'published',
    'provider',
  ];

  const { reportKey, systemBucket } = recReportParams;
  const searchParams = convertToDBGranuleSearchParams(recReportParams);

  const granulesSearchQuery = getGranulesByApiPropertiesQuery(
    recReportParams.knex,
    searchParams,
    ['collectionName', 'collectionVersion', 'granule_id']
  );
  const pgGranulesSearchClient = new QuerySearchClient(
    granulesSearchQuery,
    100 // arbitrary limit on how items are fetched at once
  );

  let nextGranule = await pgGranulesSearchClient.peek();

  const readable = new Stream.Readable({ objectMode: true });
  const pass = new Stream.PassThrough();
  readable._read = noop;
  const transformOpts = { objectMode: true };

  const json2csv = new Transform({ fields }, transformOpts);
  readable.pipe(json2csv).pipe(pass);

  const promisedObject = promiseS3Upload({
    params: {
      Bucket: systemBucket,
      Key: reportKey,
      Body: pass,
    },
  });

  try {
    while (nextGranule) {
      // eslint-disable-next-line no-await-in-loop
      const apiGranule = await translatePostgresGranuleResultToApiGranule(
        recReportParams.knex,
        nextGranule
      );
      readable.push({
        granuleUr: apiGranule.granuleId,
        collectionId: apiGranule.collectionId,
        createdAt: new Date(apiGranule.createdAt).toISOString(),
        startDateTime: apiGranule.beginningDateTime || '',
        endDateTime: apiGranule.endingDateTime || '',
        status: apiGranule.status,
        updatedAt: new Date(apiGranule.updatedAt).toISOString(),
        published: apiGranule.published,
        provider: apiGranule.provider,
      });
      await pgGranulesSearchClient.shift(); // eslint-disable-line no-await-in-loop
      nextGranule = await pgGranulesSearchClient.peek(); // eslint-disable-line no-await-in-loop
    }
    readable.push(null);

    return promisedObject;
  } catch (error) {
    log.error(`Error caught in createGranuleInventoryReport ${error}`);
    throw error;
  }
}

exports.createGranuleInventoryReport = createGranuleInventoryReport;
