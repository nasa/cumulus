'use strict';

const { Parser } = require('json2csv');
const Logger = require('@cumulus/logger');
const { s3 } = require('@cumulus/aws-client/services');
const { Granule } = require('../../models');
const log = new Logger({ sender: '@api/lambdas/granule-inventory-report' });

/**
 * Builds a CSV file of all granules in the Cumulus DB
 * @param {Object} recReportParams
 * @param {string} recReportParams.reportKey - s3 key to store report
 * @param {string} recReportParams.systemBucket - bucket to store report.
 * @returns {Promise<null>} - promise of a report written to s3.
 */
async function createGranuleInventoryReport(recReportParams) {
  log.debug(
    `createGranuleInventoryReport parameters ${JSON.stringify(recReportParams)}`
  );

  const { reportKey, systemBucket } = recReportParams;

  const granuleScanner = new Granule().granuleAttributeScan();
  let nextGranule = await granuleScanner.peek();

  const granulesArray = [];
  while (nextGranule) {
    granulesArray.push({
      granuleUr: nextGranule.granuleId,
      collectionId: nextGranule.collectionId,
      createdAt: new Date(nextGranule.createdAt).toISOString(),
      startDateTime: nextGranule.beginningDateTime || '',
      endDateTime: nextGranule.endingDateTime || '',
      status: nextGranule.status,
      updatedAt: new Date(nextGranule.updatedAt).toISOString(),
      published: nextGranule.published,
    });
    await granuleScanner.shift(); // eslint-disable-line no-await-in-loop
    nextGranule = await granuleScanner.peek(); // eslint-disable-line no-await-in-loop
  }

  const fields = [
    'granuleUr',
    'collectionId',
    'createdAt',
    'startDateTime',
    'endDateTime',
    'status',
    'updatedAt',
    'published',
  ];
  const parser = new Parser({ fields });
  const csv = parser.parse(granulesArray);

  // Write the full report to S3
  return s3()
    .putObject({
      Bucket: systemBucket,
      Key: reportKey,
      Body: csv,
    })
    .promise();
}

exports.createGranuleInventoryReport = createGranuleInventoryReport;
