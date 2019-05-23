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
  const granuleModel = new Granule();
  const allDbGranules = await granuleModel.scan();
  const fields = ['granuleUr', 'collectionId', 'startDateTime', 'endDateTime'];
  const granuleArray = [];
  allDbGranules.Items.forEach((granule) => {
    const granuleUr = granule.granuleId;
    const collectionId = granule.collectionId;
    // Only granules in cmr will only have beginningDateTime/endingDateTime
    const startDate = granule.beginningDateTime || '';
    const endDate = granule.endingDateTime || '';

    const granuleObject = {
      granuleUr: granuleUr,
      collectionId: collectionId,
      startDateTime: startDate,
      endDateTime: endDate
    };
    granuleArray.push(granuleObject);
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
