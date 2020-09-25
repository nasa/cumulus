'use strict';

const { Transform } = require('json2csv');
const noop = require('lodash/noop');
const Stream = require('stream');
const Logger = require('@cumulus/logger');
const { promiseS3Upload } = require('@cumulus/aws-client/S3');
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

  const readable = new Stream.Readable({ objectMode: true });
  const pass = new Stream.PassThrough();
  readable._read = noop;
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
  const transformOpts = { objectMode: true };

  const json2csv = new Transform({ fields }, transformOpts);
  readable.pipe(json2csv).pipe(pass);

  while (nextGranule) {
    readable.push({
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
  readable.push(null);

  return promiseS3Upload({
    Bucket: systemBucket,
    Key: reportKey,
    Body: pass,
  });
}

exports.createGranuleInventoryReport = createGranuleInventoryReport;
