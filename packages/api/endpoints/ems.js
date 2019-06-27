'use strict';

const router = require('express-promise-router')();
const { invoke } = require('@cumulus/ingest/aws');

/**
 * Creates a new report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    reportType,
    startTime,
    endTime,
    collectionId
  } = req.body;

  const typeToLambda = {
    metadata: process.env.EmsProductMetadataReport,
    ingest: process.env.EmsIngestReport,
    distribution: process.env.EmsDistributionReport
  };

  const inputPayload = { startTime, endTime, collectionId };
  const results = await invoke(typeToLambda[reportType], inputPayload);

  return res.send({ message: 'Reports are being generated', results });
}

router.post('/', post);

module.exports = router;
