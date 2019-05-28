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
  await granuleScanner.fetchItems();
  const allDbGranules = granuleScanner.items.filter(n => n);

  const fields = ['granuleUr', 'collectionId', 'createdAt', 'startDateTime', 'endDateTime'];
  const granuleArray = allDbGranules.map((granule) => {
    const granuleUr = granule.granuleId;
    const collectionId = granule.collectionId;
    const createDate = new Date(granule.createdAt);
    const startDate = granule.beginningDateTime || '';
    const endDate = granule.endingDateTime || '';

    return {
      granuleUr: granuleUr,
      collectionId: collectionId,
      createdAt: createDate.toISOString(),
      startDateTime: startDate,
      endDateTime: endDate
    };
  });
  let csv;
  try {
    const parser = new Parser({ fields });
    csv = parser.parse(granuleArray);
  } catch (error) {
    throw error;
  }

  return res.send(csv);
}

router.get('/', list);

module.exports = router;
