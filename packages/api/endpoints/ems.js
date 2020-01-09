'use strict';

const pick = require('lodash.pick');
const router = require('express-promise-router')();
const { lambda } = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');

/**
 * Creates a new report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const typeToLambda = {
    metadata: process.env.EmsProductMetadataReport,
    ingest: process.env.EmsIngestReport,
    distribution: process.env.EmsDistributionReport
  };

  const reportType = req.body.reportType;
  if (!Object.keys(typeToLambda).includes(reportType)) {
    return res.boom.badRequest(`Must specify reportType as one of ${Object.keys(typeToLambda).join(',')}`);
  }

  log.info(`ems.post invoke ${typeToLambda[reportType]}`);

  const invocationType = req.body.invocationType || 'Event';
  const inputPayload = pick(req.body, ['startTime', 'endTime', 'collectionId']);
  const result = await lambda().invoke({
    FunctionName: typeToLambda[reportType],
    Payload: JSON.stringify(inputPayload),
    InvocationType: invocationType
  }).promise();

  const response = (invocationType === 'Event')
    ? { message: 'Reports are being generated', status: result.StatusCode }
    : { message: 'Reports generated', reports: JSON.parse(result.Payload) };
  return res.send(response);
}

router.post('/', post);

module.exports = router;
