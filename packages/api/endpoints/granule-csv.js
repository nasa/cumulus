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
    const granuleUr = nextGranule.granuleId;
    const collectionId = nextGranule.collectionId;
    const createDate = new Date(nextGranule.createdAt);
    const startDate = nextGranule.beginningDateTime || '';
    const endDate = nextGranule.endingDateTime || '';

    granulesArray.push({
      granuleUr: granuleUr,
      collectionId: collectionId,
      createdAt: createDate.toISOString(),
      startDateTime: startDate,
      endDateTime: endDate
    });
    await granuleScanner.shift();
    nextGranule = await granuleScanner.peek();
  }

  const fields = ['granuleUr', 'collectionId', 'createdAt', 'startDateTime', 'endDateTime'];
  let csv;
  try {
    const parser = new Parser({ fields });
    csv = parser.parse(granulesArray);
  } catch (error) {
    throw error;
  }

  return res.send(csv);
}

router.get('/', list);

module.exports = router;
