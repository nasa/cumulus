'use strict';

const { Parser } = require('json2csv');
const router = require('express-promise-router')();

const { Granule } = require('../models');

/**
 * Builds a CSV file of all granules in the Cumulus DB
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} the csv file of granules
 */
async function list(req, res) {
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

  const fields = ['granuleUr', 'collectionId', 'createdAt', 'startDateTime', 'endDateTime', 'status', 'updatedAt', 'published'];
  const parser = new Parser({ fields });
  const csv = parser.parse(granulesArray);

  return res.send(csv);
}

router.get('/', list);

module.exports = router;
