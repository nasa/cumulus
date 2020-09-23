'use strict';

const { Transform } = require('json2csv');
const noop = require('lodash/noop');
const Stream = require('stream');
const router = require('express-promise-router')();
const { deprecate } = require('@cumulus/common/util');

const { Granule } = require('../models');

/**
 * Builds a CSV file of all granules in the Cumulus DB
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} the csv file of granules
 */
async function list(req, res) {
  deprecate(
    '@cumulus/endpoints/granule-csv/list',
    '2.0.5',
    '@cumulus/endpoints/reconciliationReport'
  );

  const granuleScanner = new Granule().granuleAttributeScan();
  let nextGranule = await granuleScanner.peek();

  const readable = new Stream.Readable({ objectMode: true });
  readable._read = noop;
  const fields = ['granuleUr', 'collectionId', 'createdAt', 'startDateTime', 'endDateTime', 'status', 'updatedAt', 'published'];
  const transformOpts = { objectMode: true };

  const json2csv = new Transform({ fields }, transformOpts);
  readable.pipe(json2csv).pipe(res);

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
}

router.get('/', list);

module.exports = router;
